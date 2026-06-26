import { jest } from '@jest/globals';
import { loadFeature, defineFeature } from 'jest-cucumber';
import {
  OIDCAuthenticator,
  OIDCAuthenticationError,
  type AuthenticatedPrincipal,
} from '../../src/auth/oidc-authenticator.js';
import { AuthMiddleware, type AuthResult } from '../../src/auth/auth-middleware.js';
import { WIFAuthenticator } from '../../src/auth/wif-authenticator.js';

const feature = loadFeature('./authorization.feature', { loadRelativePath: true });

function nowSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** Build an unsigned JWT (header.payload.sig). WIF validates claims locally before GCP verifies the signature. */
function makeJwt(payload: Record<string, unknown>): string {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${enc({ alg: 'none', typ: 'JWT' })}.${enc(payload)}.sig`;
}

function makePrincipal(email: string): AuthenticatedPrincipal {
  return {
    subject: `sub-${email}`,
    email,
    issuer: 'https://accounts.google.com',
    audience: 'mcp-server',
    scopes: [],
    claims: {},
    authenticatedAt: new Date(),
  };
}

function makeWif(overrides: Record<string, unknown> = {}): WIFAuthenticator {
  return new WIFAuthenticator({
    projectId: 'test-project',
    workloadIdentityPoolId: 'my-pool',
    workloadIdentityProviderId: 'my-provider',
    serviceAccountEmail: 'sa@test-project.iam.gserviceaccount.com',
    ...overrides,
  });
}

defineFeature(feature, (test) => {
  let oidc: OIDCAuthenticator;
  let middleware: AuthMiddleware;
  let wif: WIFAuthenticator;
  let authResult: AuthResult;
  let caught: unknown;

  const buildMiddleware = (requireAuth: boolean) =>
    new AuthMiddleware({
      oidc: { issuer: 'https://accounts.google.com', audience: 'mcp-server' },
      requireAuth,
    } as never);

  test('A request with no token is rejected', ({ given, when, then }) => {
    given(
      /^an OIDC authenticator for issuer "(.*)" and audience "(.*)"$/,
      (issuer, audience) => {
        oidc = new OIDCAuthenticator({ issuer, audience } as never);
      }
    );
    when('an empty bearer token is authenticated', async () => {
      try {
        await oidc.authenticate('');
      } catch (e) {
        caught = e;
      }
    });
    then(/^OIDC authentication fails with code "(.*)"$/, (code) => {
      expect(caught).toBeInstanceOf(OIDCAuthenticationError);
      expect((caught as OIDCAuthenticationError).code).toBe(code);
    });
  });

  test('An OIDC authenticator refuses a non-HTTPS issuer', ({ when, then }) => {
    when(/^an OIDC authenticator is configured with issuer "(.*)"$/, (issuer) => {
      try {
        oidc = new OIDCAuthenticator({ issuer, audience: 'mcp-server' } as never);
      } catch (e) {
        caught = e;
      }
    });
    then('configuration fails because the issuer must use HTTPS', () => {
      expect(caught).toBeDefined();
      expect(String((caught as Error).message)).toMatch(/HTTPS/i);
    });
  });

  test('A valid bearer token authenticates through the middleware', ({
    given,
    and,
    when,
    then,
  }) => {
    given('an auth middleware that requires authentication', () => {
      middleware = buildMiddleware(true);
    });
    and(/^the underlying authenticator accepts tokens as "(.*)"$/, (email) => {
      (middleware as unknown as { authenticator: unknown }).authenticator = {
        authenticate: jest.fn(async () => makePrincipal(email)),
      };
    });
    when(/^a request with authorization header "(.*)" is processed$/, async (header) => {
      authResult = await middleware.authenticate({ authorization: header });
    });
    then(/^the request is authenticated as "(.*)"$/, (email) => {
      expect(authResult.authenticated).toBe(true);
      expect(authResult.principal?.email).toBe(email);
    });
  });

  test('An invalid bearer token is rejected by the middleware', ({ given, and, when, then }) => {
    given('an auth middleware that requires authentication', () => {
      middleware = buildMiddleware(true);
    });
    and('the underlying authenticator rejects tokens as invalid', () => {
      (middleware as unknown as { authenticator: unknown }).authenticator = {
        authenticate: jest.fn(async () => {
          throw new OIDCAuthenticationError('bad token', 'INVALID_TOKEN');
        }),
      };
    });
    when(/^a request with authorization header "(.*)" is processed$/, async (header) => {
      authResult = await middleware.authenticate({ authorization: header });
    });
    then('the request is not authenticated', () => {
      expect(authResult.authenticated).toBe(false);
    });
    and(/^the auth error code is "(.*)"$/, (code) => {
      expect(authResult.errorCode).toBe(code);
    });
  });

  test('A missing token is rejected when auth is required', ({ given, when, then, and }) => {
    given('an auth middleware that requires authentication', () => {
      middleware = buildMiddleware(true);
    });
    when('a request with no authorization header is processed', async () => {
      authResult = await middleware.authenticate({});
    });
    then('the request is not authenticated', () => {
      expect(authResult.authenticated).toBe(false);
    });
    and(/^the auth error code is "(.*)"$/, (code) => {
      expect(authResult.errorCode).toBe(code);
    });
  });

  test('A missing token is allowed when auth is not required', ({ given, when, then }) => {
    given('an auth middleware that does not require authentication', () => {
      middleware = buildMiddleware(false);
    });
    when('a request with no authorization header is processed', async () => {
      authResult = await middleware.authenticate({});
    });
    then('the request is authenticated', () => {
      expect(authResult.authenticated).toBe(true);
    });
  });

  test('WIF rejects an expired OIDC token', ({ given, when, then }) => {
    given(/^a WIF authenticator for project "(.*)"$/, () => {
      wif = makeWif();
    });
    when('an expired OIDC token is exchanged', async () => {
      const token = makeJwt({
        sub: 'u',
        iss: 'https://accounts.google.com',
        aud: 'mcp-server',
        exp: nowSec() - 100,
        iat: nowSec() - 200,
      });
      try {
        await wif.authenticate(token);
      } catch (e) {
        caught = e;
      }
    });
    then(/^the WIF exchange fails mentioning "(.*)"$/, (text) => {
      expect(String((caught as Error).message)).toContain(text);
    });
  });

  test('WIF rejects a token from an untrusted issuer', ({ given, when, then }) => {
    given(/^a WIF authenticator that only trusts issuer "(.*)"$/, (issuer) => {
      wif = makeWif({ allowedIssuers: [issuer] });
    });
    when(/^an OIDC token from issuer "(.*)" is exchanged$/, async (issuer) => {
      const token = makeJwt({
        sub: 'u',
        iss: issuer,
        aud: 'mcp-server',
        exp: nowSec() + 3600,
        iat: nowSec(),
      });
      try {
        await wif.authenticate(token);
      } catch (e) {
        caught = e;
      }
    });
    then(/^the WIF exchange fails mentioning "(.*)"$/, (text) => {
      expect(String((caught as Error).message)).toContain(text);
    });
  });

  test('WIF rejects a token with an unverified email', ({ given, when, then }) => {
    given('a WIF authenticator that requires verified email', () => {
      wif = makeWif({ requireEmailVerification: true });
    });
    when('an OIDC token with an unverified email is exchanged', async () => {
      const token = makeJwt({
        sub: 'u',
        iss: 'https://accounts.google.com',
        aud: 'mcp-server',
        email: 'user@example.com',
        email_verified: false,
        exp: nowSec() + 3600,
        iat: nowSec(),
      });
      try {
        await wif.authenticate(token);
      } catch (e) {
        caught = e;
      }
    });
    then(/^the WIF exchange fails mentioning "(.*)"$/, (text) => {
      expect(String((caught as Error).message)).toContain(text);
    });
  });

  test('WIF refuses impersonation when it is disabled', ({ given, when, then }) => {
    given('a WIF authenticator with impersonation disabled', () => {
      wif = makeWif({ allowImpersonation: false });
    });
    when(/^impersonation of "(.*)" is attempted$/, async (target) => {
      const token = makeJwt({
        sub: 'u',
        iss: 'https://accounts.google.com',
        aud: 'mcp-server',
        exp: nowSec() + 3600,
        iat: nowSec(),
      });
      try {
        await wif.authenticateAndImpersonate(token, target);
      } catch (e) {
        caught = e;
      }
    });
    then(/^the WIF exchange fails mentioning "(.*)"$/, (text) => {
      expect(String((caught as Error).message)).toContain(text);
    });
  });

  test('WIF builds the correct federation resource names', ({ given, then, and }) => {
    given(
      /^a WIF authenticator for project "(.*)" with pool "(.*)" and provider "(.*)"$/,
      (projectId, pool, provider) => {
        wif = makeWif({
          projectId,
          workloadIdentityPoolId: pool,
          workloadIdentityProviderId: provider,
        });
      }
    );
    then(/^the pool resource name is "(.*)"$/, (expected) => {
      expect(wif.getPoolResourceName()).toBe(expected);
    });
    and(/^the provider resource name ends with "(.*)"$/, (suffix) => {
      expect(wif.getProviderResourceName().endsWith(suffix)).toBe(true);
    });
  });
});
