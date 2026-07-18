import { describe, it, expect, afterAll } from '@jest/globals';
import { createServer, Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHttpTransport } from '../../../src/mcp/transports/http-transport.js';
import {
  initializeMetrics,
  recordRequest,
  shutdownMetrics,
} from '../../../src/telemetry/metrics.js';

/**
 * Proves `/metrics` serves the OpenTelemetry Prometheus registry in text
 * exposition format. The exporter is built with `preventServerStart: true`, so
 * this route is the only thing that makes those metrics reachable at all —
 * before this wiring the endpoint returned a JSON placeholder that no
 * Prometheus scraper could parse.
 *
 * Runs in its own file because `initializeMetrics` installs a process-global
 * meter provider.
 */

let httpServer: HttpServer | null = null;

afterAll(async () => {
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
  }
  await shutdownMetrics();
});

describe('/metrics with telemetry initialised', () => {
  it('emits Prometheus text exposition format containing recorded metrics', async () => {
    initializeMetrics('metrics-endpoint-test', '0.0.0', 'test-project');
    recordRequest('list_datasets', true);
    recordRequest('list_datasets', false);

    const transport = new StreamableHttpTransport(
      () => new Server({ name: 'test-mcp', version: '0.0.0' }, { capabilities: {} })
    );
    httpServer = createServer(transport.getApp());
    await new Promise<void>((resolve) => httpServer!.listen(0, '127.0.0.1', resolve));
    const { port } = httpServer.address() as AddressInfo;

    const res = await fetch(`http://127.0.0.1:${port}/metrics`);
    const body = await res.text();

    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toContain('text/plain');

    // Prometheus exposition format: HELP/TYPE preamble then samples.
    expect(body).toContain('# HELP');
    expect(body).toContain('# TYPE');
    // The counter incremented above must be present in the scrape.
    expect(body).toMatch(/mcp_requests_total/);
    // And it must not be the old JSON placeholder.
    expect(body.trimStart().startsWith('{')).toBe(false);
  });
});
