import { WIFAuthConfigSchema } from '../../src/auth/wif-authenticator.js';
import { createWIFAuthenticator } from '../../src/auth/index.js';

/**
 * Regression guard for an authentication-bypass-shaped defect.
 *
 * `OIDCTokenValidator.validateToken` used to only base64-decode the JWT
 * payload, with a comment claiming "GCP will verify". That was false:
 * `WIFAuthenticator.authenticate()` calls `credentialManager.getAccessToken()`
 * with NO arguments, so the caller's token is never forwarded to GCP or STS and
 * no downstream verification ever happens.
 *
 * A forged, unsigned JWT with a future `exp` and an allowed `iss`/`aud` would
 * therefore authenticate successfully, return a real GCP access token minted
 * from the server's own credentials, and write an audit record attributing the
 * action to an attacker-chosen principal.
 */
const BASE_CONFIG = {
  projectId: 'p',
  workloadIdentityPoolId: 'pool',
  workloadIdentityProviderId: 'provider',
  serviceAccountEmail: 'sa@p.iam.gserviceaccount.com',
};

/** An unsigned JWT with attacker-chosen claims and a far-future expiry. */
function forgeToken(claims: Record<string, unknown>): string {
  const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(claims)}.`;
}

describe('WIF OIDC token verification', () => {
  it('refuses to construct without a JWKS endpoint', () => {
    // Failing closed at construction is what makes the bypass unreachable: a
    // caller cannot accidentally get an authenticator that skips verification.
    expect(() => createWIFAuthenticator(WIFAuthConfigSchema.parse(BASE_CONFIG))).toThrow(/jwksUri/);
  });

  it('rejects a forged unsigned token instead of minting a GCP access token', async () => {
    const auth = createWIFAuthenticator(
      WIFAuthConfigSchema.parse({
        ...BASE_CONFIG,
        // Never contacted: the token is unsigned, so verification fails before
        // any network fetch would resolve a key for it.
        jwksUri: 'https://example.invalid/.well-known/jwks.json',
        allowedIssuers: ['https://accounts.google.com'],
      })
    );

    const forged = forgeToken({
      iss: 'https://accounts.google.com',
      sub: 'attacker',
      aud: 'anything',
      email: 'attacker@evil.test',
      email_verified: true,
      exp: Math.floor(Date.now() / 1000) + 3600,
      iat: Math.floor(Date.now() / 1000),
    });

    await expect(auth.authenticate(forged)).rejects.toThrow();
  });

  it('still allows an explicit, deliberate opt-out for upstream-verified tokens', () => {
    // The escape hatch must remain possible but must never be the default.
    expect(() =>
      createWIFAuthenticator(
        WIFAuthConfigSchema.parse({ ...BASE_CONFIG, allowUnverifiedTokens: true })
      )
    ).not.toThrow();
  });

  it('defaults allowUnverifiedTokens to false', () => {
    expect(WIFAuthConfigSchema.parse(BASE_CONFIG).allowUnverifiedTokens).toBe(false);
  });
});
