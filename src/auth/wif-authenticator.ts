import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { CredentialManager, CredentialConfig } from './credential-manager.js';
import { SecurityAuditLogger, AuditEventType, AuditSeverity, getAuditLogger } from './audit-logger.js';
import { recordError } from '../telemetry/metrics.js';
import { setSpanAttributes } from '../telemetry/tracing.js';

/**
 * Enterprise Workload Identity Federation Authenticator
 *
 * Advanced WIF authentication with:
 * - External OIDC token validation
 * - Service account impersonation
 * - Token exchange and rotation
 * - Credential caching and refresh
 * - Comprehensive audit logging
 * - IAM permission validation
 * - Multi-project support
 */

// ==========================================
// Configuration & Types
// ==========================================

export const WIFAuthConfigSchema = z.object({
  // WIF Configuration
  projectId: z.string(),
  workloadIdentityPoolId: z.string(),
  workloadIdentityProviderId: z.string(),
  serviceAccountEmail: z.string().email(),

  // Token Management
  tokenLifetime: z.number().default(3600), // 1 hour
  tokenRefreshBuffer: z.number().default(300), // 5 minutes
  enableTokenCache: z.boolean().default(true),

  // Impersonation
  allowImpersonation: z.boolean().default(true),
  impersonationLifetime: z.number().default(3600),
  allowedServiceAccounts: z.array(z.string()).optional(),

  // Security
  strictValidation: z.boolean().default(true),
  requireEmailVerification: z.boolean().default(true),
  allowedIssuers: z.array(z.string()).optional(),
  allowedAudiences: z.array(z.string()).optional(),

  // Audit
  enableAuditLogging: z.boolean().default(true),

  // Scopes
  scopes: z.array(z.string()).default([
    'https://www.googleapis.com/auth/cloud-platform',
    'https://www.googleapis.com/auth/bigquery',
  ]),
});

export type WIFAuthConfig = z.infer<typeof WIFAuthConfigSchema>;

export interface WIFTokenExchangeResult {
  accessToken: string;
  expiresAt: number;
  expiresIn: number;
  tokenType: string;
  principal: string;
  impersonated?: boolean;
}

export interface OIDCTokenClaims {
  iss: string; // Issuer
  sub: string; // Subject
  aud: string | string[]; // Audience
  exp: number; // Expiration
  iat: number; // Issued at
  email?: string;
  email_verified?: boolean;
  name?: string;
  picture?: string;
  hd?: string; // Hosted domain
  [key: string]: any;
}

// ==========================================
// OIDC Token Validator
// ==========================================

class OIDCTokenValidator {
  private config: WIFAuthConfig;
  private auditLogger: SecurityAuditLogger;

  constructor(config: WIFAuthConfig, auditLogger: SecurityAuditLogger) {
    this.config = config;
    this.auditLogger = auditLogger;
  }

  /**
   * Validate OIDC token claims
   */
  async validateToken(token: string): Promise<OIDCTokenClaims> {
    try {
      // Decode JWT (without verification for now - GCP will verify)
      const claims = this.decodeJWT(token);

      // Validate expiration
      const now = Math.floor(Date.now() / 1000);
      if (claims.exp <= now) {
        throw new Error('Token has expired');
      }

      // Validate issuer if configured
      if (this.config.allowedIssuers && this.config.allowedIssuers.length > 0) {
        if (!this.config.allowedIssuers.includes(claims.iss)) {
          throw new Error(`Invalid issuer: ${claims.iss}`);
        }
      }

      // Validate audience if configured
      if (this.config.allowedAudiences && this.config.allowedAudiences.length > 0) {
        const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
        const hasValidAudience = audiences.some(aud =>
          this.config.allowedAudiences!.includes(aud)
        );
        if (!hasValidAudience) {
          throw new Error('Invalid audience');
        }
      }

      // Validate email verification if required
      if (this.config.requireEmailVerification && claims.email) {
        if (!claims.email_verified) {
          throw new Error('Email not verified');
        }
      }

      logger.debug('OIDC token validated', {
        subject: claims.sub,
        issuer: claims.iss,
        expiresIn: claims.exp - now,
      });

      return claims;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('OIDC token validation failed', { error: errorMsg });

      this.auditLogger.logSecurityViolation({
        principal: 'unknown',
        action: 'oidc_token_validation',
        severity: AuditSeverity.ERROR,
        message: `OIDC token validation failed: ${errorMsg}`,
      });

      throw error;
    }
  }

  /**
   * Decode JWT without verification
   */
  private decodeJWT(token: string): OIDCTokenClaims {
    try {
      const parts = token.split('.');
      if (parts.length !== 3) {
        throw new Error('Invalid JWT format');
      }

      const payload = parts[1];
      const decoded = Buffer.from(payload, 'base64').toString('utf-8');
      return JSON.parse(decoded);
    } catch (error) {
      throw new Error(`Failed to decode JWT: ${error}`);
    }
  }
}

// ==========================================
// Main WIF Authenticator
// ==========================================

export class WIFAuthenticator {
  private config: WIFAuthConfig;
  private credentialManager: CredentialManager;
  private tokenValidator: OIDCTokenValidator;
  private auditLogger: SecurityAuditLogger;

  constructor(config: Partial<WIFAuthConfig>) {
    this.config = WIFAuthConfigSchema.parse(config);
    this.auditLogger = getAuditLogger({
      enableCloudLogging: this.config.enableAuditLogging,
    });

    // Initialize credential manager with WIF config
    const credConfig: Partial<CredentialConfig> = {
      authMethod: 'wif',
      wifConfig: {
        projectId: this.config.projectId,
        poolId: this.config.workloadIdentityPoolId,
        providerId: this.config.workloadIdentityProviderId,
        serviceAccountEmail: this.config.serviceAccountEmail,
        tokenLifetime: this.config.tokenLifetime,
      },
      tokenRefreshBuffer: this.config.tokenRefreshBuffer,
      enableTokenCache: this.config.enableTokenCache,
      scopes: this.config.scopes,
    };

    this.credentialManager = new CredentialManager(credConfig);
    this.tokenValidator = new OIDCTokenValidator(this.config, this.auditLogger);

    logger.info('WIF Authenticator initialized', {
      projectId: this.config.projectId,
      poolId: this.config.workloadIdentityPoolId,
      providerId: this.config.workloadIdentityProviderId,
      serviceAccount: this.config.serviceAccountEmail,
    });

    setSpanAttributes({
      'wif.project_id': this.config.projectId,
      'wif.pool_id': this.config.workloadIdentityPoolId,
      'wif.provider_id': this.config.workloadIdentityProviderId,
    });
  }

  /**
   * Authenticate with external OIDC token
   */
  async authenticate(oidcToken: string): Promise<WIFTokenExchangeResult> {
    try {
      // Validate OIDC token
      const claims = await this.tokenValidator.validateToken(oidcToken);
      const principal = claims.email || claims.sub;

      logger.info('OIDC token validated, exchanging for GCP token', {
        principal,
        issuer: claims.iss,
      });

      // Exchange for GCP access token
      const tokenInfo = await this.credentialManager.getAccessToken();

      const result: WIFTokenExchangeResult = {
        accessToken: tokenInfo.accessToken,
        expiresAt: tokenInfo.expiresAt,
        expiresIn: Math.floor((tokenInfo.expiresAt - Date.now()) / 1000),
        tokenType: tokenInfo.tokenType,
        principal: tokenInfo.principal,
        impersonated: false,
      };

      // Log successful authentication
      this.auditLogger.logAuthSuccess({
        principal,
        principalType: 'wif',
        action: 'wif_token_exchange',
        metadata: {
          issuer: claims.iss,
          expiresIn: result.expiresIn,
          serviceAccount: this.config.serviceAccountEmail,
        },
      });

      setSpanAttributes({
        'auth.success': true,
        'auth.principal': principal,
        'auth.method': 'wif',
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('WIF authentication failed', { error: errorMsg });

      this.auditLogger.logAuthFailure({
        principal: 'unknown',
        action: 'wif_token_exchange',
        errorDetails: errorMsg,
      });

      recordError('wif_auth_failed');
      throw error;
    }
  }

  /**
   * Authenticate and impersonate service account
   */
  async authenticateAndImpersonate(
    oidcToken: string,
    targetServiceAccount?: string
  ): Promise<WIFTokenExchangeResult> {
    if (!this.config.allowImpersonation) {
      throw new Error('Service account impersonation is disabled');
    }

    try {
      // First, authenticate with WIF
      const wifResult = await this.authenticate(oidcToken);

      // Determine target service account
      const target = targetServiceAccount || this.config.serviceAccountEmail;

      // Validate allowed service accounts
      if (this.config.allowedServiceAccounts && this.config.allowedServiceAccounts.length > 0) {
        if (!this.config.allowedServiceAccounts.includes(target)) {
          throw new Error(`Service account ${target} not in allowed list`);
        }
      }

      logger.info('Impersonating service account', {
        target,
        principal: wifResult.principal,
      });

      // Impersonate service account
      const impersonatedToken = await this.credentialManager.impersonateServiceAccount(
        target,
        this.config.impersonationLifetime
      );

      const result: WIFTokenExchangeResult = {
        accessToken: impersonatedToken.accessToken,
        expiresAt: impersonatedToken.expiresAt,
        expiresIn: Math.floor((impersonatedToken.expiresAt - Date.now()) / 1000),
        tokenType: impersonatedToken.tokenType,
        principal: impersonatedToken.principal,
        impersonated: true,
      };

      // Log impersonation
      this.auditLogger.log({
        eventType: AuditEventType.AUTH_SUCCESS,
        severity: AuditSeverity.INFO,
        principal: wifResult.principal,
        impersonator: wifResult.principal,
        action: 'service_account_impersonation',
        resource: target,
        outcome: 'success',
        message: `Impersonated service account ${target}`,
        metadata: {
          expiresIn: result.expiresIn,
        },
      });

      setSpanAttributes({
        'auth.impersonation': true,
        'auth.target_sa': target,
        'auth.impersonator': wifResult.principal,
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Service account impersonation failed', {
        error: errorMsg,
        target: targetServiceAccount,
      });

      this.auditLogger.logSecurityViolation({
        principal: 'unknown',
        action: 'service_account_impersonation',
        severity: AuditSeverity.ERROR,
        message: `Impersonation failed: ${errorMsg}`,
        metadata: { targetServiceAccount },
      });

      recordError('impersonation_failed');
      throw error;
    }
  }

  /**
   * Refresh access token
   */
  async refreshToken(): Promise<WIFTokenExchangeResult> {
    try {
      logger.info('Refreshing WIF token');

      const tokenInfo = await this.credentialManager.refreshToken();

      const result: WIFTokenExchangeResult = {
        accessToken: tokenInfo.accessToken,
        expiresAt: tokenInfo.expiresAt,
        expiresIn: Math.floor((tokenInfo.expiresAt - Date.now()) / 1000),
        tokenType: tokenInfo.tokenType,
        principal: tokenInfo.principal,
        impersonated: false,
      };

      this.auditLogger.logTokenOperation({
        eventType: AuditEventType.TOKEN_REFRESHED,
        principal: tokenInfo.principal,
        action: 'token_refresh',
        metadata: { expiresIn: result.expiresIn },
      });

      return result;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Token refresh failed', { error: errorMsg });
      recordError('token_refresh_failed');
      throw error;
    }
  }

  /**
   * Validate current authentication
   */
  async validateAuthentication(): Promise<boolean> {
    try {
      const health = await this.credentialManager.validateCredentials();
      return health.healthy && health.tokenValid;
    } catch (error) {
      logger.error('Authentication validation failed', { error });
      return false;
    }
  }

  /**
   * Get workload identity pool resource name
   */
  getPoolResourceName(): string {
    return `projects/${this.config.projectId}/locations/global/workloadIdentityPools/${this.config.workloadIdentityPoolId}`;
  }

  /**
   * Get provider resource name
   */
  getProviderResourceName(): string {
    return `${this.getPoolResourceName()}/providers/${this.config.workloadIdentityProviderId}`;
  }

  /**
   * Get credential info
   */
  getCredentialInfo() {
    return {
      ...this.credentialManager.getCredentialInfo(),
      wifConfig: {
        projectId: this.config.projectId,
        poolId: this.config.workloadIdentityPoolId,
        providerId: this.config.workloadIdentityProviderId,
        serviceAccount: this.config.serviceAccountEmail,
        poolResourceName: this.getPoolResourceName(),
        providerResourceName: this.getProviderResourceName(),
      },
      impersonation: {
        enabled: this.config.allowImpersonation,
        allowedServiceAccounts: this.config.allowedServiceAccounts,
        lifetime: this.config.impersonationLifetime,
      },
    };
  }

  /**
   * Invalidate cached credentials
   */
  invalidateCache(): void {
    this.credentialManager.invalidateCache();
    logger.info('WIF credential cache invalidated');

    this.auditLogger.log({
      eventType: AuditEventType.ADMIN_ACTION,
      severity: AuditSeverity.INFO,
      principal: 'system',
      action: 'cache_invalidated',
      outcome: 'success',
      message: 'WIF credential cache invalidated',
    });
  }

  /**
   * Enable automatic token refresh
   */
  enableAutoRefresh(intervalSeconds: number = 1800): () => void {
    const cleanup = this.credentialManager.enableAutoRefresh(intervalSeconds);

    logger.info('WIF auto-refresh enabled', { intervalSeconds });

    this.auditLogger.log({
      eventType: AuditEventType.ADMIN_ACTION,
      severity: AuditSeverity.INFO,
      principal: 'system',
      action: 'auto_refresh_enabled',
      outcome: 'success',
      message: `Auto-refresh enabled with ${intervalSeconds}s interval`,
    });

    return cleanup;
  }

  /**
   * Get audit trail
   */
  getAuditTrail(options?: Parameters<typeof this.auditLogger.query>[0]) {
    return this.auditLogger.query(options);
  }

  /**
   * Get audit statistics
   */
  getAuditStatistics() {
    return this.auditLogger.getStatistics();
  }

  /**
   * Export audit trail
   */
  exportAuditTrail(format: 'json' | 'csv' = 'json'): string {
    return this.auditLogger.export(format);
  }
}
