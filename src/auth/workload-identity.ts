import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';
import { logger } from '../utils/logger.js';

/**
 * Workload Identity Federation Token Exchange
 * Exchanges external OIDC tokens for GCP access tokens
 */

export const WIFConfigSchema = z.object({
  projectId: z.string(),
  workloadIdentityPoolId: z.string(),
  workloadIdentityProviderId: z.string(),
  serviceAccountEmail: z.string(),
  tokenLifetime: z.number().default(3600), // 1 hour
});

export type WIFConfig = z.infer<typeof WIFConfigSchema>;

export class WorkloadIdentityFederation {
  private auth: GoogleAuth;
  private config: WIFConfig;
  private tokenCache: Map<string, { token: string; expiresAt: number }> = new Map();

  constructor(config: WIFConfig) {
    this.config = WIFConfigSchema.parse(config);
    
    // Initialize Google Auth with Workload Identity Federation
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    logger.info('Workload Identity Federation initialized', {
      projectId: this.config.projectId,
      poolId: this.config.workloadIdentityPoolId,
    });
  }

  /**
   * Exchange external OIDC token for GCP access token
   */
  async exchangeToken(oidcToken: string): Promise<string> {
    const cacheKey = this.hashToken(oidcToken);
    
    // Check cache
    const cached = this.tokenCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) {
      logger.debug('Using cached WIF token');
      return cached.token;
    }

    try {
      // Get federated token
      const client = await this.auth.getClient();
      const accessToken = await client.getAccessToken();

      if (!accessToken.token) {
        throw new Error('Failed to obtain access token from WIF');
      }

      // Cache token (with 5 minute buffer before expiration)
      const expiresAt = Date.now() + (this.config.tokenLifetime - 300) * 1000;
      this.tokenCache.set(cacheKey, {
        token: accessToken.token,
        expiresAt,
      });

      logger.info('WIF token exchange successful', {
        expiresIn: this.config.tokenLifetime,
      });

      return accessToken.token;
    } catch (error) {
      logger.error('WIF token exchange failed', { error });
      throw new Error(`Workload Identity Federation token exchange failed: ${error}`);
    }
  }

  /**
   * Get identity pool resource name
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
   * Impersonate service account
   */
  async impersonateServiceAccount(accessToken: string): Promise<string> {
    try {
      const url = `https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${this.config.serviceAccountEmail}:generateAccessToken`;

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          scope: ['https://www.googleapis.com/auth/cloud-platform'],
          lifetime: `${this.config.tokenLifetime}s`,
        }),
      });

      if (!response.ok) {
        throw new Error(`Service account impersonation failed: ${response.statusText}`);
      }

      const data = await response.json() as { accessToken: string; expireTime: string };

      logger.info('Service account impersonation successful', {
        serviceAccount: this.config.serviceAccountEmail,
      });

      return data.accessToken;
    } catch (error) {
      logger.error('Service account impersonation failed', { error });
      throw error;
    }
  }

  /**
   * Clear token cache
   */
  clearCache(): void {
    this.tokenCache.clear();
    logger.debug('WIF token cache cleared');
  }

  /**
   * Hash token for cache key (simple hash for demo)
   */
  private hashToken(token: string): string {
    return Buffer.from(token.substring(0, 50)).toString('base64');
  }
}
