import { z } from 'zod';
import {
  OIDCAuthenticator,
  OIDCConfigSchema,
  AuthenticatedPrincipal,
  OIDCAuthenticationError,
} from './oidc-authenticator.js';
import { logger } from '../utils/logger.js';
import { recordAuthAttempt } from '../telemetry/metrics.js';

export const AuthMiddlewareConfigSchema = z.object({
  oidc: OIDCConfigSchema,
  bypassTools: z.array(z.string()).default([]),
  requireAuth: z.boolean().default(true),
});

export type AuthMiddlewareConfig = z.infer<typeof AuthMiddlewareConfigSchema>;

export interface AuthResult {
  authenticated: boolean;
  principal?: AuthenticatedPrincipal;
  error?: string;
  errorCode?: string;
}

export class AuthMiddleware {
  private authenticator: OIDCAuthenticator;
  private config: AuthMiddlewareConfig;

  constructor(config: AuthMiddlewareConfig) {
    this.config = AuthMiddlewareConfigSchema.parse(config);
    this.authenticator = new OIDCAuthenticator(this.config.oidc);
  }

  async authenticate(headers: Record<string, string | undefined>): Promise<AuthResult> {
    const token = headers.authorization || headers.Authorization;

    if (!token) {
      if (!this.config.requireAuth) {
        return { authenticated: true };
      }
      recordAuthAttempt('bearer', false);
      return {
        authenticated: false,
        error: 'No authorization token provided',
        errorCode: 'MISSING_TOKEN',
      };
    }

    try {
      const principal = await this.authenticator.authenticate(token);
      recordAuthAttempt('bearer', true);
      return { authenticated: true, principal };
    } catch (error) {
      recordAuthAttempt('bearer', false);
      if (error instanceof OIDCAuthenticationError) {
        return {
          authenticated: false,
          error: error.message,
          errorCode: error.code,
        };
      }
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Unexpected auth error', { error: message });
      return {
        authenticated: false,
        error: 'Authentication failed',
        errorCode: 'AUTH_ERROR',
      };
    }
  }

  isToolBypassed(toolName: string): boolean {
    return this.config.bypassTools.includes(toolName);
  }
}
