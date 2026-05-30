import { describe, it, expect, afterEach } from '@jest/globals';
import { createServer, Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import {
  StreamableHttpTransport,
  JsonRpcHandler,
  AuthResolver,
} from '../../../src/mcp/transports/http-transport.js';

/**
 * Runtime tests for the wired Streamable HTTP transport — the path that makes
 * the server actually deployable on Cloud Run (health probe + POST /mcp) and
 * enforces auth/tenant resolution at the HTTP boundary.
 *
 * We drive the transport's Express app through an ephemeral http.Server so the
 * test never binds a fixed port.
 */

const echoHandler: JsonRpcHandler = async (req, ctx) => ({
  jsonrpc: '2.0',
  id: req.id,
  result: {
    method: req.method,
    tenant: (ctx?.tenantContext as { id?: string } | undefined)?.id ?? null,
  },
});

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
    const transport = new StreamableHttpTransport(echoHandler);
    const base = await listen(transport);

    const res = await fetch(`${base}/health`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string };
    expect(body.status).toBe('healthy');
  });

  it('answers an initialize request with a JSON-RPC result', async () => {
    const transport = new StreamableHttpTransport(echoHandler);
    const base = await listen(transport);

    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { id: number; result: { method: string } };
    expect(body.id).toBe(1);
    expect(body.result.method).toBe('initialize');
  });

  it('acknowledges a notification (no id) with 202 and no body', async () => {
    const transport = new StreamableHttpTransport(echoHandler);
    const base = await listen(transport);

    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
    });
    expect(res.status).toBe(202);
    expect(await res.text()).toBe('');
  });

  it('rejects requests with 401 when the auth resolver denies', async () => {
    const denyResolver: AuthResolver = async () => ({
      authorized: false,
      error: 'token expired',
      errorCode: 'invalid_token',
    });
    const transport = new StreamableHttpTransport(echoHandler, undefined, denyResolver);
    const base = await listen(transport);

    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
  });

  it('threads the resolved tenant context through to the handler', async () => {
    const allowResolver: AuthResolver = async () => ({
      authorized: true,
      context: { tenantContext: { id: 'tenant-a' } },
    });
    const transport = new StreamableHttpTransport(echoHandler, undefined, allowResolver);
    const base = await listen(transport);

    const res = await fetch(`${base}/mcp`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 7, method: 'tools/call' }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { result: { tenant: string } };
    expect(body.result.tenant).toBe('tenant-a');
  });

  it('returns GET /mcp 405 in strict Streamable HTTP mode (Gemini Enterprise)', async () => {
    const transport = new StreamableHttpTransport(echoHandler, { strictStreamableHttp: true });
    const base = await listen(transport);

    const res = await fetch(`${base}/mcp`, { method: 'GET' });
    expect(res.status).toBe(405);
    expect(res.headers.get('allow')).toBe('POST');
  });
});
