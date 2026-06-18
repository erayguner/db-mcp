/**
 * Tests for the StreamableHttpTransport HTTP surface — the Gemini-Enterprise /
 * MCP-auth-related additions: OAuth discovery endpoints, the stateless GET 405,
 * and the WWW-Authenticate 401 helper. These are pure Express routes that
 * resolve before the MCP protocol layer, so they need no live MCP Server.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { AddressInfo } from 'net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  StreamableHttpTransport,
  ServerProvider,
} from '../../../src/mcp/transports/http-transport.js';

const makeServer: ServerProvider = () =>
  new Server({ name: 'test-mcp', version: '0.0.0' }, { capabilities: {} });

function getPort(t: StreamableHttpTransport): number {
  const app = t.getApp();
  const internal = (t as unknown as { server: { address(): AddressInfo | null } }).server;
  const addr = internal.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  void app;
  return addr.port;
}

describe('StreamableHttpTransport — discovery + stateless behaviour', () => {
  describe('stateless Streamable HTTP', () => {
    let transport: StreamableHttpTransport;

    beforeEach(async () => {
      transport = new StreamableHttpTransport(makeServer, {
        port: 0,
        host: '127.0.0.1',
        oauthMetadata: null,
      });
      await transport.start();
    });

    afterEach(async () => {
      await transport.shutdown();
    });

    it('returns 405 with Allow: POST on GET /mcp (no standalone SSE)', async () => {
      const port = getPort(transport);
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET' });
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('POST');
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('method_not_allowed');
    });

    it('returns 405 with Allow: POST on DELETE /mcp (no sessions)', async () => {
      const port = getPort(transport);
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'DELETE' });
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('POST');
    });
  });

  describe('OAuth discovery endpoints', () => {
    let transport: StreamableHttpTransport;

    beforeAll(async () => {
      transport = new StreamableHttpTransport(makeServer, {
        port: 0,
        host: '127.0.0.1',
        oauthMetadata: {
          resourceUrl: 'https://mcp.example.com',
          authorizationServerIssuer: 'https://accounts.google.com',
          authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
          tokenEndpoint: 'https://oauth2.googleapis.com/token',
          jwksUri: 'https://www.googleapis.com/oauth2/v3/certs',
          registrationEndpoint: undefined,
          scopesSupported: ['mcp.read', 'mcp.invoke'],
          resourceAudience: 'https://mcp.example.com',
        },
      });
      await transport.start();
    });

    afterAll(async () => {
      await transport.shutdown();
    });

    it('serves /.well-known/oauth-authorization-server', async () => {
      const port = getPort(transport);
      const res = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-authorization-server`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.issuer).toBe('https://accounts.google.com');
      expect(body.token_endpoint).toBe('https://oauth2.googleapis.com/token');
      expect(body.code_challenge_methods_supported).toContain('S256');
      expect(res.headers.get('Cache-Control')).toContain('max-age=3600');
    });

    it('serves /.well-known/oauth-protected-resource', async () => {
      const port = getPort(transport);
      const res = await fetch(`http://127.0.0.1:${port}/.well-known/oauth-protected-resource`);
      expect(res.status).toBe(200);
      const body = (await res.json()) as Record<string, unknown>;
      expect(body.resource).toBe('https://mcp.example.com');
      expect(body.authorization_servers).toEqual(['https://accounts.google.com']);
    });

    it('does NOT mount discovery routes when oauthMetadata is null', async () => {
      const t2 = new StreamableHttpTransport(makeServer, {
        port: 0,
        host: '127.0.0.1',
        oauthMetadata: null,
      });
      await t2.start();
      const p2 = getPort(t2);
      try {
        const res = await fetch(`http://127.0.0.1:${p2}/.well-known/oauth-authorization-server`);
        expect(res.status).toBe(404);
      } finally {
        await t2.shutdown();
      }
    });
  });
});
