import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import {
  loadOAuthMetadataConfig,
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  buildWwwAuthenticateHeader,
  VERTEX_AI_SEARCH_REDIRECT_URI,
  OAuthMetadataConfig,
} from '../../../src/auth/oauth-metadata.js';

const SAMPLE_CFG: OAuthMetadataConfig = {
  resourceUrl: 'https://mcp.example.com',
  authorizationServerIssuer: 'https://accounts.google.com',
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
  registrationEndpoint: undefined,
  scopesSupported: ['mcp.read', 'mcp.invoke'],
  resourceAudience: 'https://mcp.example.com',
};

describe('oauth-metadata', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('loadOAuthMetadataConfig', () => {
    beforeEach(() => {
      delete process.env.OAUTH_RESOURCE_URL;
      delete process.env.OAUTH_ISSUER;
      delete process.env.OAUTH_AUTHORIZATION_ENDPOINT;
      delete process.env.OAUTH_TOKEN_ENDPOINT;
    });

    it('returns null when required env vars are absent', () => {
      expect(loadOAuthMetadataConfig()).toBeNull();
    });

    it('loads a complete config from env', () => {
      process.env.OAUTH_RESOURCE_URL = 'https://mcp.example.com';
      process.env.OAUTH_ISSUER = 'https://accounts.google.com';
      process.env.OAUTH_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
      process.env.OAUTH_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
      process.env.OAUTH_SCOPES_SUPPORTED = 'a b c';

      const cfg = loadOAuthMetadataConfig();
      expect(cfg).not.toBeNull();
      expect(cfg!.scopesSupported).toEqual(['a', 'b', 'c']);
      expect(cfg!.resourceAudience).toBe('https://mcp.example.com');
    });

    it('falls back to resourceUrl when audience env is absent', () => {
      process.env.OAUTH_RESOURCE_URL = 'https://mcp.example.com';
      process.env.OAUTH_ISSUER = 'https://accounts.google.com';
      process.env.OAUTH_AUTHORIZATION_ENDPOINT = 'https://accounts.google.com/auth';
      process.env.OAUTH_TOKEN_ENDPOINT = 'https://accounts.google.com/token';

      const cfg = loadOAuthMetadataConfig();
      expect(cfg!.resourceAudience).toBe('https://mcp.example.com');
    });

    it('returns null if any one required var is missing', () => {
      process.env.OAUTH_RESOURCE_URL = 'https://mcp.example.com';
      process.env.OAUTH_ISSUER = 'https://accounts.google.com';
      // missing OAUTH_AUTHORIZATION_ENDPOINT and OAUTH_TOKEN_ENDPOINT
      expect(loadOAuthMetadataConfig()).toBeNull();
    });
  });

  describe('buildAuthorizationServerMetadata', () => {
    it('emits RFC 8414 required fields', () => {
      const md = buildAuthorizationServerMetadata(SAMPLE_CFG);
      expect(md.issuer).toBe(SAMPLE_CFG.authorizationServerIssuer);
      expect(md.authorization_endpoint).toBe(SAMPLE_CFG.authorizationEndpoint);
      expect(md.token_endpoint).toBe(SAMPLE_CFG.tokenEndpoint);
      expect(md.response_types_supported).toContain('code');
      expect(md.grant_types_supported).toEqual(
        expect.arrayContaining(['authorization_code', 'refresh_token'])
      );
      expect(md.code_challenge_methods_supported).toContain('S256');
    });

    it('includes the Vertex AI Search redirect URI in known list', () => {
      const md = buildAuthorizationServerMetadata(SAMPLE_CFG) as Record<string, unknown>;
      expect(md['x-known-redirect-uris']).toEqual([VERTEX_AI_SEARCH_REDIRECT_URI]);
    });

    it('omits optional fields when not set', () => {
      const md = buildAuthorizationServerMetadata({
        ...SAMPLE_CFG,
        jwksUri: undefined,
        registrationEndpoint: undefined,
      });
      expect(md.jwks_uri).toBeUndefined();
      expect(md.registration_endpoint).toBeUndefined();
    });
  });

  describe('buildProtectedResourceMetadata', () => {
    it('emits RFC 9728 required fields', () => {
      const md = buildProtectedResourceMetadata(SAMPLE_CFG);
      expect(md.resource).toBe(SAMPLE_CFG.resourceUrl);
      expect(md.authorization_servers).toEqual([SAMPLE_CFG.authorizationServerIssuer]);
      expect(md.bearer_methods_supported).toEqual(['header']);
      expect(md.scopes_supported).toEqual(SAMPLE_CFG.scopesSupported);
    });
  });

  describe('buildWwwAuthenticateHeader', () => {
    it('includes Bearer scheme and resource_metadata', () => {
      const h = buildWwwAuthenticateHeader(
        'https://mcp.example.com/.well-known/oauth-protected-resource',
        {
          realm: 'mcp',
          error: 'invalid_token',
          errorDescription: 'Token expired',
        }
      );
      expect(h).toMatch(/^Bearer /);
      expect(h).toContain('realm="mcp"');
      expect(h).toContain('error="invalid_token"');
      expect(h).toContain('error_description="Token expired"');
      expect(h).toContain(
        'resource_metadata="https://mcp.example.com/.well-known/oauth-protected-resource"'
      );
    });

    it('escapes quotes in parameter values', () => {
      const h = buildWwwAuthenticateHeader('https://example.com/md', {
        errorDescription: 'has "quotes"',
      });
      expect(h).toContain('error_description="has \\"quotes\\""');
    });
  });
});
