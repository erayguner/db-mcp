/**
 * Integration tests for the StreamableHttpTransport — focused on the
 * Gemini-Enterprise-related additions: OAuth discovery endpoints,
 * strict Streamable HTTP mode, and the WWW-Authenticate 401 helper.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from '@jest/globals';
import { AddressInfo } from 'net';
import { StreamableHttpTransport } from '../../../src/mcp/transports/http-transport.js';
import type { JsonRpcRequest, JsonRpcResponse } from '../../../src/mcp/middleware/batch-handler.js';

const noopHandler = async (req: JsonRpcRequest): Promise<JsonRpcResponse> => ({
  jsonrpc: '2.0',
  id: req.id ?? null,
  result: { ok: true },
});

function getPort(t: StreamableHttpTransport): number {
  const app = t.getApp();
  // express stores the server on internal handle; reach into transport via cast
  const internal = (t as unknown as { server: { address(): AddressInfo | null } }).server;
  const addr = internal.address();
  if (!addr || typeof addr === 'string') throw new Error('no address');
  // touch app reference to satisfy unused checks
  void app;
  return addr.port;
}

describe('StreamableHttpTransport — discovery + strict mode', () => {
  describe('strict Streamable HTTP mode', () => {
    let transport: StreamableHttpTransport;

    beforeEach(async () => {
      transport = new StreamableHttpTransport(noopHandler, {
        port: 0,
        host: '127.0.0.1',
        strictStreamableHttp: true,
        oauthMetadata: null,
      });
      await transport.start();
    });

    afterEach(async () => {
      await transport.shutdown();
    });

    it('returns 405 with Allow: POST on GET /mcp', async () => {
      const port = getPort(transport);
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, { method: 'GET' });
      expect(res.status).toBe(405);
      expect(res.headers.get('Allow')).toBe('POST');
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('method_not_allowed');
    });

    it('still accepts POST /mcp in strict mode', async () => {
      const port = getPort(transport);
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'ping' }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as { result: { ok: boolean } };
      expect(body.result.ok).toBe(true);
    });
  });

  describe('non-strict mode (SSE permitted)', () => {
    let transport: StreamableHttpTransport;

    beforeEach(async () => {
      transport = new StreamableHttpTransport(noopHandler, {
        port: 0,
        host: '127.0.0.1',
        strictStreamableHttp: false,
        oauthMetadata: null,
      });
      await transport.start();
    });

    afterEach(async () => {
      await transport.shutdown();
    });

    it('opens an SSE stream on GET /mcp', async () => {
      const port = getPort(transport);
      const controller = new AbortController();
      const res = await fetch(`http://127.0.0.1:${port}/mcp`, {
        method: 'GET',
        signal: controller.signal,
      });
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('text/event-stream');
      controller.abort();
      // Drain to release the socket
      try {
        await res.body?.cancel();
      } catch {
        /* ignore */
      }
    });
  });

  describe('OAuth discovery endpoints', () => {
    let transport: StreamableHttpTransport;

    beforeAll(async () => {
      transport = new StreamableHttpTransport(noopHandler, {
        port: 0,
        host: '127.0.0.1',
        strictStreamableHttp: true,
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
      const t2 = new StreamableHttpTransport(noopHandler, {
        port: 0,
        host: '127.0.0.1',
        strictStreamableHttp: true,
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
