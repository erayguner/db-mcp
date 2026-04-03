import { z } from 'zod';
import { createRemoteJWKSet, jwtVerify, JWTPayload } from 'jose';
import { logger } from '../utils/logger.js';

export const OIDCConfigSchema = z.object({
  issuer: z.string().url().refine(
    (url) => url.startsWith('https://'),
    { message: 'Issuer must use HTTPS' }
  ),
  audience: z.string().min(1),
  jwksUri: z.string().url().optional(),
  requiredScopes: z.array(z.string()).default([]),
  clockToleranceSec: z.number().min(0).max(300).default(30),
});

export type OIDCConfig = z.infer<typeof OIDCConfigSchema>;

export interface AuthenticatedPrincipal {
  subject: string;
  email: string;
  issuer: string;
  audience: string;
  scopes: string[];
  claims: JWTPayload;
  authenticatedAt: Date;
}

export class OIDCAuthenticationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 401
  ) {
    super(message);
    this.name = 'OIDCAuthenticationError';
  }
}

export class OIDCAuthenticator {
  private config: OIDCConfig;
  private jwks: ReturnType<typeof createRemoteJWKSet>;

  constructor(config: OIDCConfig) {
    this.config = OIDCConfigSchema.parse(config);
    const jwksUrl = this.config.jwksUri || `${this.config.issuer}/.well-known/jwks.json`;
    this.jwks = createRemoteJWKSet(new URL(jwksUrl));
    logger.info('OIDC authenticator initialized', {
      issuer: this.config.issuer,
      audience: this.config.audience,
    });
  }

  async authenticate(token: string): Promise<AuthenticatedPrincipal> {
    if (!token) {
      throw new OIDCAuthenticationError('No token provided', 'MISSING_TOKEN');
    }
    const jwt = token.startsWith('Bearer ') ? token.slice(7) : token;
    try {
      const { payload } = await jwtVerify(jwt, this.jwks, {
        issuer: this.config.issuer,
        audience: this.config.audience,
        clockTolerance: this.config.clockToleranceSec,
      });
      const tokenScopes = typeof payload.scope === 'string' ? payload.scope.split(' ') : [];
      for (const required of this.config.requiredScopes) {
        if (!tokenScopes.includes(required)) {
          throw new OIDCAuthenticationError(`Missing required scope: ${required}`, 'INSUFFICIENT_SCOPE', 403);
        }
      }
      return {
        subject: payload.sub || '',
        email: (payload.email as string) || '',
        issuer: payload.iss || '',
        audience: typeof payload.aud === 'string' ? payload.aud : Array.isArray(payload.aud) ? payload.aud[0] : '',
        scopes: tokenScopes,
        claims: payload,
        authenticatedAt: new Date(),
      };
    } catch (error) {
      if (error instanceof OIDCAuthenticationError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new OIDCAuthenticationError(`Token verification failed: ${message}`, 'INVALID_TOKEN');
    }
  }
}
