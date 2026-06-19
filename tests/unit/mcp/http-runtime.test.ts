import { describe, it, expect, afterEach } from '@jest/globals';
import { createServer, Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  StreamableHttpTransport,
  AuthResolver,
  ServerProvider,
} from '../../../src/mcp/transports/http-transport.js';

/**
 * Runtime tests for the SDK-backed Streamable HTTP transport — the HTTP-layer
 * concerns the transport itself owns: Cloud Run health probe, the auth
 * boundary (401 + WWW-Authenticate), Host allow-list (DNS-rebinding defense),
 * and the stateless GET 405. The MCP protocol itself (initialize negotiation,
 * batch rejection, version-header validation) is delegated to and covered by
 * the official SDK transport, so these tests do not re-assert it.
 */

// In these tests the MCP Server is the repo's lightweight mock; the routes
// exercised below resolve before any request reaches the MCP protocol layer.
const makeServer: ServerProvider = () =>
  new Server({ name: 'test-mcp', version: '0.0.0' }, { capabilities: {} });

let httpServer: HttpServer | null = null;

async function listen(transport: StreamableHttpTransport): Promise<string> {
  const server = createServer(transport.getApp());
  httpServer = server;
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return `http://127.0.0.1:${port}`;
}

afterEach(async () => {
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    httpServer = null;
  }
});

describe('StreamableHttpTransport runtime', () => {
  it('serves the /health liveness probe (Cloud Run startup/liveness)', async () => {
    const transport = new StreamableHttpTransport(makeServer);
    const base = await listen(transport);

    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('healthy');
  });

  it('rejects requests with 401 + WWW-Authenticate when the auth resolver denies', async () => {
    const denyResolver: AuthResolver = async () => ({
      authorized: false,
      error: 'token expired',
      errorCode: 'invalid_token',
    });
    const transport = new StreamableHttpTransport(makeServer, undefined, denyResolver);
    const base = await listen(transport);

    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('returns GET /mcp 405 with Allow: POST (stateless Streamable HTTP)', async () => {
    const transport = new StreamableHttpTransport(makeServer);
    const base = await listen(transport);

    const res = await fetch(`${base}/mcp`, { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });

  it('rejects a disallowed Host header with 403 (DNS-rebinding defense)', async () => {
    const transport = new StreamableHttpTransport(makeServer, {
      allowedHosts: ['mcp.allowed.example:443'],
    });
    const base = await listen(transport);

    // fetch sends Host: 127.0.0.1:<port>, which is not in the allow-list.
    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(403);
    const body = (await res.json()) as { error: string };
    expect(body.error).toBe('forbidden');
  });
});
