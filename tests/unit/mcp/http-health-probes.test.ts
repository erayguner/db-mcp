import { describe, it, expect, afterEach } from '@jest/globals';
import { createServer, Server as HttpServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  StreamableHttpTransport,
  ServerProvider,
} from '../../../src/mcp/transports/http-transport.js';
import {
  ReadinessRegistry,
  registerBigQueryReadinessProbe,
} from '../../../src/monitoring/readiness.js';

/**
 * HTTP-surface tests for the Cloud Run / Kubernetes probe endpoints.
 *
 * The load-bearing property is the liveness/readiness split: a BigQuery outage
 * must drain the instance from the load balancer (readiness 503) without
 * restarting the container (liveness stays 200). A liveness probe that depended
 * on BigQuery would turn an upstream outage into a fleet-wide crash-loop.
 */

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

/** Transport wired to an isolated registry (never the process-wide singleton). */
function transportWith(readiness: ReadinessRegistry): StreamableHttpTransport {
  return new StreamableHttpTransport(makeServer, { readiness });
}

/** A BigQuery client stand-in that is reachable. */
const healthyBigQuery = { isHealthy: () => true, query: async () => ({}) };

/** A BigQuery client stand-in whose API calls fail, as during an outage. */
const downBigQuery = {
  isHealthy: () => true,
  query: async () => {
    throw new Error('ECONNREFUSED bigquery.googleapis.com:443');
  },
};

interface ReadinessBody {
  ready: boolean;
  checks: { name: string; ok: boolean; error?: string }[];
  failed?: string[];
  cached?: boolean;
  note?: string;
}

afterEach(async () => {
  if (httpServer) {
    await new Promise<void>((resolve) => httpServer!.close(() => resolve()));
    httpServer = null;
  }
});

describe('Health probe endpoints', () => {
  describe('readiness when dependencies are healthy', () => {
    it('returns 200 and ready:true from /readiness', async () => {
      const readiness = new ReadinessRegistry();
      registerBigQueryReadinessProbe(healthyBigQuery, { registry: readiness });
      const base = await listen(transportWith(readiness));

      const res = await fetch(`${base}/readiness`);
      const body = (await res.json()) as ReadinessBody;

      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.checks).toEqual([expect.objectContaining({ name: 'bigquery', ok: true })]);
      expect(body.failed).toEqual([]);
    });

    it('serves the /health/ready alias identically', async () => {
      const readiness = new ReadinessRegistry();
      registerBigQueryReadinessProbe(healthyBigQuery, { registry: readiness });
      const base = await listen(transportWith(readiness));

      const res = await fetch(`${base}/health/ready`);

      expect(res.status).toBe(200);
      expect(((await res.json()) as ReadinessBody).ready).toBe(true);
    });
  });

  describe('readiness when BigQuery is down', () => {
    it('returns 503 naming the failing check and its cause', async () => {
      const readiness = new ReadinessRegistry();
      registerBigQueryReadinessProbe(downBigQuery, { registry: readiness });
      const base = await listen(transportWith(readiness));

      const res = await fetch(`${base}/readiness`);
      const body = (await res.json()) as ReadinessBody;

      expect(res.status).toBe(503);
      expect(body.ready).toBe(false);
      expect(body.failed).toEqual(['bigquery']);
      expect(body.checks[0].error).toContain('ECONNREFUSED');
    });

    it('returns 503 from the /health/ready alias too', async () => {
      const readiness = new ReadinessRegistry();
      registerBigQueryReadinessProbe(downBigQuery, { registry: readiness });
      const base = await listen(transportWith(readiness));

      expect((await fetch(`${base}/health/ready`)).status).toBe(503);
    });

    it('returns 503 when the BigQuery client was never initialised', async () => {
      const readiness = new ReadinessRegistry();
      registerBigQueryReadinessProbe(
        { isHealthy: () => false, query: async () => ({}) },
        { registry: readiness }
      );
      const base = await listen(transportWith(readiness));

      const res = await fetch(`${base}/readiness`);
      const body = (await res.json()) as ReadinessBody;

      expect(res.status).toBe(503);
      expect(body.checks[0].error).toContain('not initialised');
    });
  });

  describe('liveness is independent of dependencies', () => {
    it('keeps /health at 200 while BigQuery is down', async () => {
      const readiness = new ReadinessRegistry();
      registerBigQueryReadinessProbe(downBigQuery, { registry: readiness });
      const base = await listen(transportWith(readiness));

      // Same server instance: readiness fails, liveness must not.
      expect((await fetch(`${base}/readiness`)).status).toBe(503);

      const res = await fetch(`${base}/health`);
      const body = (await res.json()) as { status: string; uptimeSeconds: number };

      expect(res.status).toBe(200);
      expect(body.status).toBe('healthy');
      expect(typeof body.uptimeSeconds).toBe('number');
    });

    it('keeps /health/live at 200 while BigQuery is down', async () => {
      const readiness = new ReadinessRegistry();
      registerBigQueryReadinessProbe(downBigQuery, { registry: readiness });
      const base = await listen(transportWith(readiness));

      expect((await fetch(`${base}/health/live`)).status).toBe(200);
    });

    it('never invokes a dependency probe to answer liveness', async () => {
      const readiness = new ReadinessRegistry();
      let probeCalls = 0;
      readiness.register('bigquery', () => {
        probeCalls++;
      });
      const base = await listen(transportWith(readiness));

      await fetch(`${base}/health`);
      await fetch(`${base}/health/live`);

      expect(probeCalls).toBe(0);
    });
  });

  describe('probe timeouts', () => {
    it('returns 503 rather than hanging when a dependency never answers', async () => {
      const readiness = new ReadinessRegistry({ timeoutMs: 50 });
      readiness.register('bigquery', () => new Promise<void>(() => {}));
      const base = await listen(transportWith(readiness));

      const start = Date.now();
      const res = await fetch(`${base}/readiness`);
      const elapsed = Date.now() - start;
      const body = (await res.json()) as ReadinessBody;

      expect(res.status).toBe(503);
      expect(body.failed).toEqual(['bigquery']);
      expect(body.checks[0].error).toContain('timed out');
      // The probe request itself must resolve promptly.
      expect(elapsed).toBeLessThan(2_000);
    });

    it('keeps liveness responsive while a readiness probe is hung', async () => {
      const readiness = new ReadinessRegistry({ timeoutMs: 5_000 });
      readiness.register('bigquery', () => new Promise<void>(() => {}));
      const base = await listen(transportWith(readiness));

      // Deliberately not awaited: readiness stays in flight for the whole test.
      void fetch(`${base}/readiness`).catch(() => {});

      const res = await fetch(`${base}/health`);
      expect(res.status).toBe(200);
    });
  });

  describe('probe caching', () => {
    it('reuses a verdict across a burst of probes instead of hammering BigQuery', async () => {
      const readiness = new ReadinessRegistry({ cacheTtlMs: 10_000 });
      let queries = 0;
      registerBigQueryReadinessProbe(
        {
          isHealthy: () => true,
          query: async () => {
            queries++;
            return {};
          },
        },
        { registry: readiness }
      );
      const base = await listen(transportWith(readiness));

      for (let i = 0; i < 5; i++) {
        expect((await fetch(`${base}/readiness`)).status).toBe(200);
      }

      expect(queries).toBe(1);
      const body = (await (await fetch(`${base}/readiness`)).json()) as ReadinessBody;
      expect(body.cached).toBe(true);
    });
  });

  describe('no probes registered', () => {
    it('returns 200 but states that dependency health is unverified', async () => {
      const base = await listen(transportWith(new ReadinessRegistry()));

      const res = await fetch(`${base}/readiness`);
      const body = (await res.json()) as ReadinessBody;

      expect(res.status).toBe(200);
      expect(body.ready).toBe(true);
      expect(body.checks).toEqual([]);
      expect(body.note).toContain('unverified');
    });
  });

  describe('probe responses are not cached by intermediaries', () => {
    it('sets Cache-Control: no-store on liveness and readiness', async () => {
      const base = await listen(transportWith(new ReadinessRegistry()));

      expect((await fetch(`${base}/health`)).headers.get('cache-control')).toBe('no-store');
      expect((await fetch(`${base}/readiness`)).headers.get('cache-control')).toBe('no-store');
    });
  });

  describe('/metrics', () => {
    it('answers in Prometheus text exposition format, not JSON', async () => {
      const base = await listen(transportWith(new ReadinessRegistry()));

      const res = await fetch(`${base}/metrics`);

      expect(res.headers.get('content-type')).toContain('text/plain');
      expect(res.headers.get('content-type')).not.toContain('application/json');
    });

    it('reports a scrape failure when telemetry is not initialised', async () => {
      // No initializeMetrics() call in this suite, so there is no registry to
      // scrape — an empty 200 would misreport the server as having no metrics.
      const base = await listen(transportWith(new ReadinessRegistry()));

      const res = await fetch(`${base}/metrics`);

      expect(res.status).toBe(503);
      expect(await res.text()).toContain('telemetry is not initialised');
    });
  });
});
