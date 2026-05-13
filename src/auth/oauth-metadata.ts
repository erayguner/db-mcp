/**
 * OAuth 2.0 / MCP 2025-06-18 metadata discovery
 *
 * Required by:
 * - RFC 8414 (OAuth 2.0 Authorization Server Metadata) — `/.well-known/oauth-authorization-server`
 * - RFC 9728 (OAuth 2.0 Protected Resource Metadata) — `/.well-known/oauth-protected-resource`
 * - MCP authorization spec (June 2025) — clients dereference the `resource_metadata`
 *   parameter from a `WWW-Authenticate` 401 to discover the bound authorization server.
 * - Gemini Enterprise custom MCP connector — uses OAuth 2.0 with redirect URI
 *   `https://vertexaisearch.cloud.google.com/oauth-redirect` for user consent.
 */

import { z } from 'zod';

export const VERTEX_AI_SEARCH_REDIRECT_URI =
  'https://vertexaisearch.cloud.google.com/oauth-redirect';

/**
 * Configuration loaded from environment for OAuth metadata responses.
 *
 * The MCP server itself does not have to *be* the authorization server — it
 * typically delegates to Google, Okta, or Azure AD. These values describe
 * the upstream IdP so MCP clients (e.g. Gemini Enterprise) can discover it.
 */
export const OAuthMetadataConfigSchema = z.object({
  /** Public base URL of this MCP server (used as `resource` identifier). */
  resourceUrl: z.string().url(),
  /** Authorization-server issuer URL (Google, Okta, Azure AD, …). */
  authorizationServerIssuer: z.string().url(),
  /** Authorization endpoint URL on the IdP. */
  authorizationEndpoint: z.string().url(),
  /** Token endpoint URL on the IdP. */
  tokenEndpoint: z.string().url(),
  /** Optional JWKS endpoint URL. */
  jwksUri: z.string().url().optional(),
  /** Optional dynamic-client-registration endpoint per RFC 7591. */
  registrationEndpoint: z.string().url().optional(),
  /** Scopes the resource server enforces. */
  scopesSupported: z.array(z.string()).default(['mcp.read', 'mcp.invoke']),
  /** Audience the IdP must mint tokens for (typically equals resourceUrl). */
  resourceAudience: z.string().min(1),
});

export type OAuthMetadataConfig = z.infer<typeof OAuthMetadataConfigSchema>;

/**
 * Load OAuth metadata config from environment variables.
 *
 * Required env vars:
 * - `OAUTH_RESOURCE_URL`             — public base URL of this MCP server
 * - `OAUTH_ISSUER`                   — IdP issuer (e.g. `https://accounts.google.com`)
 * - `OAUTH_AUTHORIZATION_ENDPOINT`   — IdP authorize URL
 * - `OAUTH_TOKEN_ENDPOINT`           — IdP token URL
 *
 * Optional:
 * - `OAUTH_JWKS_URI`, `OAUTH_REGISTRATION_ENDPOINT`,
 * - `OAUTH_SCOPES_SUPPORTED` (space-separated),
 * - `OAUTH_RESOURCE_AUDIENCE` (defaults to `OAUTH_RESOURCE_URL`).
 */
export function loadOAuthMetadataConfig(): OAuthMetadataConfig | null {
  const required = [
    'OAUTH_RESOURCE_URL',
    'OAUTH_ISSUER',
    'OAUTH_AUTHORIZATION_ENDPOINT',
    'OAUTH_TOKEN_ENDPOINT',
  ];
  const missing = required.filter((k) => !process.env[k]);
  if (missing.length > 0) {
    return null;
  }

  const scopesEnv = process.env.OAUTH_SCOPES_SUPPORTED;
  return OAuthMetadataConfigSchema.parse({
    resourceUrl: process.env.OAUTH_RESOURCE_URL,
    authorizationServerIssuer: process.env.OAUTH_ISSUER,
    authorizationEndpoint: process.env.OAUTH_AUTHORIZATION_ENDPOINT,
    tokenEndpoint: process.env.OAUTH_TOKEN_ENDPOINT,
    jwksUri: process.env.OAUTH_JWKS_URI,
    registrationEndpoint: process.env.OAUTH_REGISTRATION_ENDPOINT,
    scopesSupported: scopesEnv ? scopesEnv.split(/\s+/).filter(Boolean) : undefined,
    resourceAudience: process.env.OAUTH_RESOURCE_AUDIENCE || process.env.OAUTH_RESOURCE_URL,
  });
}

/** RFC 8414 — Authorization Server Metadata document. */
export function buildAuthorizationServerMetadata(
  cfg: OAuthMetadataConfig
): Record<string, unknown> {
  return {
    issuer: cfg.authorizationServerIssuer,
    authorization_endpoint: cfg.authorizationEndpoint,
    token_endpoint: cfg.tokenEndpoint,
    ...(cfg.jwksUri ? { jwks_uri: cfg.jwksUri } : {}),
    ...(cfg.registrationEndpoint ? { registration_endpoint: cfg.registrationEndpoint } : {}),
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    token_endpoint_auth_methods_supported: ['client_secret_basic', 'client_secret_post', 'none'],
    scopes_supported: cfg.scopesSupported,
    code_challenge_methods_supported: ['S256'],
    // Vertex AI Search redirect URI must be allowed by IdP client config.
    // Surface it here for discoverability/documentation.
    'x-known-redirect-uris': [VERTEX_AI_SEARCH_REDIRECT_URI],
  };
}

/** RFC 9728 — Protected Resource Metadata document. */
export function buildProtectedResourceMetadata(cfg: OAuthMetadataConfig): Record<string, unknown> {
  return {
    resource: cfg.resourceUrl,
    authorization_servers: [cfg.authorizationServerIssuer],
    bearer_methods_supported: ['header'],
    scopes_supported: cfg.scopesSupported,
    resource_documentation: `${cfg.resourceUrl}/docs`,
    ...(cfg.jwksUri ? { jwks_uri: cfg.jwksUri } : {}),
  };
}

/**
 * Build the value for the `WWW-Authenticate` response header on 401 responses.
 *
 * Per MCP 2025-06-18, clients use the `resource_metadata` parameter to discover
 * the protected-resource metadata document, which in turn points to the
 * authorization server.
 */
export function buildWwwAuthenticateHeader(
  resourceMetadataUrl: string,
  opts: { realm?: string; error?: string; errorDescription?: string } = {}
): string {
  const params: Array<[string, string]> = [];
  if (opts.realm) params.push(['realm', opts.realm]);
  if (opts.error) params.push(['error', opts.error]);
  if (opts.errorDescription) params.push(['error_description', opts.errorDescription]);
  params.push(['resource_metadata', resourceMetadataUrl]);
  const formatted = params.map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`).join(', ');
  return `Bearer ${formatted}`;
}
