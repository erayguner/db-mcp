import { GoogleAuth, JWT, OAuth2Client, Compute, ExternalAccountClient } from 'google-auth-library';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { recordError } from '../telemetry/metrics.js';
import { recordException, setSpanAttributes } from '../telemetry/tracing.js';

/**
 * Enterprise Credential Manager
 *
 * Comprehensive credential management with:
 * - Token refresh and rotation
 * - Credential caching with TTL
 * - Multiple authentication methods (WIF, Service Account, OAuth2)
 * - Secure credential storage
 * - Health checks and validation
 * - Automatic token renewal
 */

// ==========================================
// Configuration & Types
// ==========================================

/**
 * Response from getAccessToken() method
 * (Not exported from google-auth-library, so we define it here)
 */
interface GetAccessTokenResponse {
  token?: string | null;
  res?: unknown;
}

export const CredentialConfigSchema = z.object({
  // Authentication method
  authMethod: z.enum(['wif', 'service_account', 'oauth2', 'compute']).default('wif'),

  // Workload Identity Federation
  wifConfig: z.object({
    projectId: z.string(),
    poolId: z.string(),
    providerId: z.string(),
    serviceAccountEmail: z.string(),
    tokenLifetime: z.number().default(3600),
  }).optional(),

  // Service Account
  serviceAccountKeyPath: z.string().optional(),
  serviceAccountEmail: z.string().optional(),

  // OAuth2
  oauth2Config: z.object({
    clientId: z.string(),
    clientSecret: z.string(),
    redirectUri: z.string(),
  }).optional(),

  // Token management
  tokenRefreshBuffer: z.number().default(300), // 5 minutes before expiry
  maxTokenAge: z.number().default(3600), // 1 hour
  enableTokenCache: z.boolean().default(true),

  // Security
  enableEncryption: z.boolean().default(false),
  encryptionKey: z.string().optional(),

  // Scopes
  scopes: z.array(z.string()).default([
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/bigquery',
  ]),
});

export type CredentialConfig = z.infer<typeof CredentialConfigSchema>;

export interface TokenInfo {
  accessToken: string;
  expiresAt: number;
  tokenType: string;
  scopes: string[];
  principal: string;
}

export interface CredentialHealth {
  healthy: boolean;
  authMethod: string;
  principal?: string;
  tokenValid: boolean;
  expiresIn?: number;
  lastRefresh?: Date;
  errors: string[];
}

// ==========================================
// Type Guards
// ==========================================

/**
 * Type guard to check if client has getAccessToken method
 */
function hasGetAccessToken(
  client: unknown
): client is { getAccessToken(): Promise<GetAccessTokenResponse> } {
  return (
    typeof client === 'object' &&
    client !== null &&
    'getAccessToken' in client &&
    typeof (client as Record<string, unknown>).getAccessToken === 'function'
  );
}

// ==========================================
// Token Cache
// ==========================================

class TokenCache {
  private tokens = new Map<string, TokenInfo>();
  private enabled: boolean;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(enabled: boolean) {
    this.enabled = enabled;

    // Cleanup expired tokens every minute — unref to not block shutdown
    if (enabled) {
      this.cleanupTimer = setInterval(() => this.cleanup(), 60000);
      if (typeof this.cleanupTimer.unref === 'function') this.cleanupTimer.unref();
    }
  }

  /**
   * Get cached token if valid
   */
  get(key: string, bufferSeconds: number = 300): TokenInfo | null {
    if (!this.enabled) return null;

    const token = this.tokens.get(key);
    if (!token) return null;

    // Check if token is expired or about to expire
    const now = Date.now();
    const expiresWithBuffer = token.expiresAt - (bufferSeconds * 1000);

    if (now >= expiresWithBuffer) {
      this.tokens.delete(key);
      logger.debug('Token expired or about to expire', { key });
      return null;
    }

    logger.debug('Token cache hit', {
      key,
      expiresIn: Math.floor((token.expiresAt - now) / 1000)
    });
    return token;
  }

  /**
   * Store token in cache
   */
  set(key: string, token: TokenInfo): void {
    if (!this.enabled) return;

    this.tokens.set(key, token);
    logger.debug('Token cached', {
      key,
      expiresAt: new Date(token.expiresAt).toISOString()
    });
  }

  /**
   * Invalidate specific token or all tokens
   */
  invalidate(key?: string): void {
    if (key) {
      this.tokens.delete(key);
      logger.info('Token invalidated', { key });
    } else {
      this.tokens.clear();
      logger.info('All tokens invalidated');
    }
  }

  /**
   * Cleanup expired tokens
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, token] of this.tokens.entries()) {
      if (now >= token.expiresAt) {
        this.tokens.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('Cleaned up expired tokens', { removed });
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      enabled: this.enabled,
      size: this.tokens.size,
      tokens: Array.from(this.tokens.entries()).map(([key, token]) => ({
        key,
        principal: token.principal,
        expiresAt: new Date(token.expiresAt).toISOString(),
        expiresIn: Math.floor((token.expiresAt - Date.now()) / 1000),
      })),
    };
  }
}

// ==========================================
// Main Credential Manager
// ==========================================

export class CredentialManager {
  private config: CredentialConfig;
  private auth: GoogleAuth;
  private tokenCache: TokenCache;
  private currentClient?: JWT | OAuth2Client | Compute | ExternalAccountClient;
  private lastRefresh?: Date;

  constructor(config: Partial<CredentialConfig> = {}) {
    this.config = CredentialConfigSchema.parse(config);
    this.tokenCache = new TokenCache(this.config.enableTokenCache);

    // Initialize Google Auth based on method
    this.auth = this.initializeAuth();

    logger.info('Credential manager initialized', {
      authMethod: this.config.authMethod,
      scopes: this.config.scopes,
      tokenCacheEnabled: this.config.enableTokenCache,
    });
  }

  /**
   * Initialize authentication client based on method
   */
  private initializeAuth(): GoogleAuth {
    const authConfig: {
      scopes: string[];
      keyFilename?: string;
    } = {
      scopes: this.config.scopes,
    };

    switch (this.config.authMethod) {
      case 'wif':
        if (!this.config.wifConfig) {
          throw new Error('WIF configuration required for workload identity');
        }
        // WIF configuration is handled by GoogleAuth automatically
        break;

      case 'service_account':
        if (this.config.serviceAccountKeyPath) {
          authConfig.keyFilename = this.config.serviceAccountKeyPath;
        }
        break;

      case 'oauth2':
        if (!this.config.oauth2Config) {
          throw new Error('OAuth2 configuration required');
        }
        // OAuth2 is handled separately
        break;

      case 'compute':
        // Compute Engine uses metadata server
        break;

      default: {
        const method: never = this.config.authMethod;
        throw new Error(`Unsupported auth method: ${String(method)}`);
      }
    }

    return new GoogleAuth(authConfig);
  }

  /**
   * Get access token (with automatic refresh)
   */
  async getAccessToken(): Promise<TokenInfo> {
    const cacheKey = `access_token:${this.config.authMethod}`;

    // Check cache first
    const cached = this.tokenCache.get(cacheKey, this.config.tokenRefreshBuffer);
    if (cached) {
      return cached;
    }

    try {
      // Get fresh token
      const client = await this.getClient();

      // Type guard for getAccessToken method
      if (!hasGetAccessToken(client)) {
        throw new Error('Auth client does not support getAccessToken');
      }

      // Get access token with proper typing
      const tokenResponse: GetAccessTokenResponse = await client.getAccessToken();

      // Extract token from response
      const token = tokenResponse.token;

      if (!token) {
        throw new Error('Failed to obtain access token');
      }

      // Calculate expiration
      const expiresIn = this.config.maxTokenAge;
      const expiresAt = Date.now() + (expiresIn * 1000);

      // Get principal
      const principal = await this.getPrincipal();

      const tokenInfo: TokenInfo = {
        accessToken: token,
        expiresAt,
        tokenType: 'Bearer',
        scopes: this.config.scopes,
        principal,
      };

      // Cache token
      this.tokenCache.set(cacheKey, tokenInfo);
      this.lastRefresh = new Date();

      setSpanAttributes({
        'auth.method': this.config.authMethod,
        'auth.principal': principal,
        'auth.token_expires_in': expiresIn,
      });

      logger.info('Access token obtained', {
        authMethod: this.config.authMethod,
        principal,
        expiresIn,
      });

      return tokenInfo;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to obtain access token', {
        error: err.message,
        authMethod: this.config.authMethod
      });
      recordError('token_acquisition_failed');
      recordException(err);
      throw new Error(`Token acquisition failed: ${err.message}`);
    }
  }

  /**
   * Get authenticated client
   */
  async getClient(): Promise<JWT | OAuth2Client | Compute | ExternalAccountClient> {
    if (this.currentClient) {
      // Check if token is still valid
      try {
        if (hasGetAccessToken(this.currentClient)) {
          await this.currentClient.getAccessToken();
          return this.currentClient;
        }
        // Client doesn't support getAccessToken, refresh
        logger.debug('Current client does not support getAccessToken, refreshing');
      } catch (_error) {
        // Token expired or invalid, refresh
        logger.debug('Current client invalid, refreshing');
      }
    }

    try {
      const client = await this.auth.getClient();
      this.currentClient = client as JWT | OAuth2Client | Compute | ExternalAccountClient;
      logger.debug('Auth client initialized', {
        type: this.currentClient?.constructor.name,
      });
      return this.currentClient;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to get auth client', { error: err.message });
      recordException(err);
      throw err;
    }
  }

  /**
   * Get principal (service account email or user)
   */
  async getPrincipal(): Promise<string> {
    try {
      const client = await this.getClient();

      // Service Account JWT
      if (client instanceof JWT && client.email) {
        return client.email;
      }

      // Compute Engine
      if (client instanceof Compute) {
        const projectId = await this.auth.getProjectId();
        return `compute:${projectId}`;
      }

      // External Account (WIF)
      if (client instanceof ExternalAccountClient) {
        if (this.config.wifConfig?.serviceAccountEmail) {
          return this.config.wifConfig.serviceAccountEmail;
        }
        const projectId = await this.auth.getProjectId();
        return `wif:${projectId}`;
      }

      // OAuth2
      if (client instanceof OAuth2Client) {
        return 'oauth2:user';
      }

      // Fallback
      const projectId = await this.auth.getProjectId();
      return `unknown:${projectId}`;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.warn('Failed to get principal', { error: err.message });
      return 'unknown';
    }
  }

  /**
   * Refresh token manually
   */
  async refreshToken(): Promise<TokenInfo> {
    logger.info('Manual token refresh requested');
    this.tokenCache.invalidate();
    return this.getAccessToken();
  }

  /**
   * Validate current credentials
   */
  async validateCredentials(): Promise<CredentialHealth> {
    const errors: string[] = [];
    let tokenValid = false;
    let expiresIn: number | undefined;
    let principal: string | undefined;

    try {
      // Try to get access token
      const tokenInfo = await this.getAccessToken();
      tokenValid = true;
      expiresIn = Math.floor((tokenInfo.expiresAt - Date.now()) / 1000);
      principal = tokenInfo.principal;

      if (expiresIn < 0) {
        errors.push('Token is expired');
        tokenValid = false;
      } else if (expiresIn < 300) {
        errors.push('Token expires soon (< 5 minutes)');
      }
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      errors.push(`Token validation failed: ${err.message}`);
      tokenValid = false;
    }

    const healthy = errors.length === 0 && tokenValid;

    const health: CredentialHealth = {
      healthy,
      authMethod: this.config.authMethod,
      principal,
      tokenValid,
      expiresIn,
      lastRefresh: this.lastRefresh,
      errors,
    };

    if (!healthy) {
      logger.warn('Credential health check failed', health);
      recordError('credential_health_check_failed');
    }

    return health;
  }

  /**
   * Impersonate service account (for WIF)
   */
  async impersonateServiceAccount(
    targetServiceAccount: string,
    lifetime: number = 3600
  ): Promise<TokenInfo> {
    if (this.config.authMethod !== 'wif') {
      throw new Error('Service account impersonation only available with WIF');
    }

    try {
      // Get WIF access token
      const wifToken = await this.getAccessToken();

      // Call IAM Credentials API
      const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${targetServiceAccount}:generateAccessToken`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${wifToken.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope: this.config.scopes,
          lifetime: `${lifetime}s`,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Impersonation failed: ${response.status} ${errorText}`);
      }

      const data = await response.json() as {
        accessToken: string;
        expireTime: string
      };

      const expiresAt = new Date(data.expireTime).getTime();

      const tokenInfo: TokenInfo = {
        accessToken: data.accessToken,
        expiresAt,
        tokenType: 'Bearer',
        scopes: this.config.scopes,
        principal: targetServiceAccount,
      };

      logger.info('Service account impersonation successful', {
        targetServiceAccount,
        expiresIn: Math.floor((expiresAt - Date.now()) / 1000),
      });

      setSpanAttributes({
        'auth.impersonation': true,
        'auth.target_principal': targetServiceAccount,
      });

      return tokenInfo;
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Service account impersonation failed', {
        error: err.message,
        targetServiceAccount
      });
      recordError('impersonation_failed');
      recordException(err);
      throw err;
    }
  }

  /**
   * Invalidate cached tokens
   */
  invalidateCache(key?: string): void {
    this.tokenCache.invalidate(key);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.tokenCache.getStats();
  }

  /**
   * Get credential info
   */
  getCredentialInfo() {
    return {
      authMethod: this.config.authMethod,
      scopes: this.config.scopes,
      tokenCacheEnabled: this.config.enableTokenCache,
      lastRefresh: this.lastRefresh,
      cacheStats: this.tokenCache.getStats(),
    };
  }

  /**
   * Enable automatic token refresh
   */
  enableAutoRefresh(intervalSeconds: number = 1800): () => void {
    const interval = setInterval(async () => {
      try {
        logger.debug('Auto-refreshing token');
        await this.refreshToken();
      } catch (error) {
        logger.error('Auto-refresh failed', { error });
        recordError('auto_refresh_failed');
      }
    }, intervalSeconds * 1000);

    logger.info('Auto-refresh enabled', { intervalSeconds });

    // Return cleanup function
    return () => {
      clearInterval(interval);
      logger.info('Auto-refresh disabled');
    };
  }

  /**
   * Get project ID
   */
  async getProjectId(): Promise<string> {
    try {
      return await this.auth.getProjectId();
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to get project ID', { error: err.message });
      throw err;
    }
  }
}
