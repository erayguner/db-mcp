// tests/unit/auth/oidc-authenticator.test.ts
import { describe, it, expect } from '@jest/globals';
import { OIDCConfigSchema } from '../../../src/auth/oidc-authenticator.js';

describe('OIDCAuthenticator', () => {
  describe('OIDCConfigSchema', () => {
    it('validates a complete OIDC config', () => {
      const config = {
        issuer: 'https://accounts.google.com',
        audience: 'my-mcp-server',
        jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
        requiredScopes: ['bigquery.readonly'],
        clockToleranceSec: 30,
      };
      const result = OIDCConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('rejects config without issuer', () => {
      const config = { audience: 'my-server' };
      const result = OIDCConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('rejects non-HTTPS issuer', () => {
      const config = {
        issuer: 'http://insecure-issuer.com',
        audience: 'my-server',
      };
      const result = OIDCConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('defaults clockToleranceSec to 30', () => {
      const config = {
        issuer: 'https://accounts.google.com',
        audience: 'my-server',
      };
      const result = OIDCConfigSchema.parse(config);
      expect(result.clockToleranceSec).toBe(30);
    });
  });
});
