import { describe, it, expect, jest } from '@jest/globals';
import {
  ReadinessRegistry,
  registerBigQueryReadinessProbe,
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_READINESS_CACHE_MS,
  type BigQueryReadinessTarget,
} from '../../../src/monitoring/readiness.js';

/**
 * Unit tests for the readiness registry — the timeout, caching and failure
 * semantics that the HTTP probe endpoints depend on.
 */

const never = (): Promise<void> => new Promise<void>(() => {});

describe('ReadinessRegistry', () => {
  describe('defaults', () => {
    it('uses a 2s probe timeout and a 5s result cache', () => {
      expect(DEFAULT_PROBE_TIMEOUT_MS).toBe(2_000);
      expect(DEFAULT_READINESS_CACHE_MS).toBe(5_000);
    });
  });

  describe('verdicts', () => {
    it('reports ready when every probe resolves', async () => {
      const registry = new ReadinessRegistry();
      registry.register('bigquery', async () => {});
      registry.register('config', () => {});

      const result = await registry.check();

      expect(result.ready).toBe(true);
      expect(result.checks).toHaveLength(2);
      expect(result.checks.every((check) => check.ok)).toBe(true);
    });

    it('reports ready with no checks when nothing is registered', async () => {
      const result = await new ReadinessRegistry().check();

      expect(result.ready).toBe(true);
      expect(result.checks).toEqual([]);
    });

    it('reports not ready and names the failing probe when one rejects', async () => {
      const registry = new ReadinessRegistry();
      registry.register('bigquery', async () => {
        throw new Error('connection refused');
      });
      registry.register('config', () => {});

      const result = await registry.check();

      expect(result.ready).toBe(false);
      const bigquery = result.checks.find((check) => check.name === 'bigquery');
      expect(bigquery?.ok).toBe(false);
      expect(bigquery?.error).toBe('connection refused');
      // A healthy probe alongside a failing one is still reported as healthy.
      expect(result.checks.find((check) => check.name === 'config')?.ok).toBe(true);
    });

    it('treats a probe that throws synchronously as a failure, not a crash', async () => {
      const registry = new ReadinessRegistry();
      registry.register('sync-throw', () => {
        throw new Error('boom');
      });

      const result = await registry.check();

      expect(result.ready).toBe(false);
      expect(result.checks[0].error).toBe('boom');
    });
  });

  describe('timeouts', () => {
    it('fails a probe that outlives the timeout budget instead of hanging', async () => {
      const registry = new ReadinessRegistry({ timeoutMs: 50 });
      registry.register('bigquery', never);

      const start = Date.now();
      const result = await registry.check();
      const elapsed = Date.now() - start;

      expect(result.ready).toBe(false);
      expect(result.checks[0].error).toContain('timed out after 50ms');
      // The probe never resolves; the verdict must come from the timeout.
      expect(elapsed).toBeLessThan(1_000);
    });

    it('does not let one hung probe mask a healthy one', async () => {
      const registry = new ReadinessRegistry({ timeoutMs: 50 });
      registry.register('hung', never);
      registry.register('fine', () => {});

      const result = await registry.check();

      expect(result.checks.find((check) => check.name === 'hung')?.ok).toBe(false);
      expect(result.checks.find((check) => check.name === 'fine')?.ok).toBe(true);
    });
  });

  describe('caching', () => {
    it('serves a cached verdict within the TTL instead of re-probing', async () => {
      const probe = jest.fn(() => {});
      const registry = new ReadinessRegistry({ cacheTtlMs: 10_000 });
      registry.register('bigquery', probe);

      const first = await registry.check();
      const second = await registry.check();

      expect(probe).toHaveBeenCalledTimes(1);
      expect(first.cached).toBe(false);
      expect(second.cached).toBe(true);
      expect(second.ready).toBe(true);
    });

    it('re-probes once the cache has expired', async () => {
      const probe = jest.fn(() => {});
      const registry = new ReadinessRegistry({ cacheTtlMs: 1 });
      registry.register('bigquery', probe);

      await registry.check();
      await new Promise((resolve) => setTimeout(resolve, 15));
      await registry.check();

      expect(probe).toHaveBeenCalledTimes(2);
    });

    it('collapses a burst of concurrent probes into a single evaluation', async () => {
      const probe = jest.fn(async () => {
        await new Promise((resolve) => setTimeout(resolve, 20));
      });
      const registry = new ReadinessRegistry();
      registry.register('bigquery', probe);

      const results = await Promise.all([registry.check(), registry.check(), registry.check()]);

      expect(probe).toHaveBeenCalledTimes(1);
      expect(results.every((result) => result.ready)).toBe(true);
    });

    it('invalidates the cache when a probe is registered or removed', async () => {
      const probe = jest.fn(() => {});
      const registry = new ReadinessRegistry({ cacheTtlMs: 10_000 });
      registry.register('bigquery', probe);

      await registry.check();
      registry.register('another', () => {});
      await registry.check();

      expect(probe).toHaveBeenCalledTimes(2);
      expect(registry.unregister('another')).toBe(true);
      expect(registry.unregister('missing')).toBe(false);
    });
  });

  describe('registry management', () => {
    it('tracks size and probe names, and clears them', () => {
      const registry = new ReadinessRegistry();
      registry.register('a', () => {});
      registry.register('b', () => {});

      expect(registry.size).toBe(2);
      expect(registry.probeNames()).toEqual(['a', 'b']);

      registry.clear();
      expect(registry.size).toBe(0);
    });

    it('replaces a probe registered under an existing name', async () => {
      const registry = new ReadinessRegistry();
      registry.register('bigquery', () => {});
      registry.register('bigquery', () => {
        throw new Error('replaced');
      });

      const result = await registry.check();

      expect(registry.size).toBe(1);
      expect(result.ready).toBe(false);
    });
  });
});

describe('registerBigQueryReadinessProbe', () => {
  const makeTarget = (
    overrides: Partial<BigQueryReadinessTarget> = {}
  ): BigQueryReadinessTarget => ({
    isHealthy: () => true,
    query: async () => ({}),
    ...overrides,
  });

  it('is ready when the client is healthy and the dry-run query succeeds', async () => {
    const query = jest.fn(async () => ({}));
    const registry = new ReadinessRegistry();
    registerBigQueryReadinessProbe(makeTarget({ query }), { registry });

    const result = await registry.check();

    expect(result.ready).toBe(true);
    // Reachability must cost nothing: a dry run scans zero bytes.
    expect(query).toHaveBeenCalledWith({ query: 'SELECT 1', dryRun: true, retry: false });
  });

  it('is not ready when the client reports itself uninitialised', async () => {
    const query = jest.fn(async () => ({}));
    const registry = new ReadinessRegistry();
    registerBigQueryReadinessProbe(makeTarget({ isHealthy: () => false, query }), { registry });

    const result = await registry.check();

    expect(result.ready).toBe(false);
    expect(result.checks[0].error).toContain('not initialised');
    // Fails fast on local state without paying for a round trip.
    expect(query).not.toHaveBeenCalled();
  });

  it('is not ready when BigQuery is unreachable', async () => {
    const registry = new ReadinessRegistry();
    registerBigQueryReadinessProbe(
      makeTarget({
        query: async () => {
          throw new Error('ECONNREFUSED bigquery.googleapis.com:443');
        },
      }),
      { registry }
    );

    const result = await registry.check();

    expect(result.ready).toBe(false);
    expect(result.checks[0].name).toBe('bigquery');
    expect(result.checks[0].error).toContain('ECONNREFUSED');
  });

  it('honours a custom probe name', async () => {
    const registry = new ReadinessRegistry();
    registerBigQueryReadinessProbe(makeTarget(), { registry, name: 'bigquery-eu' });

    expect(registry.probeNames()).toEqual(['bigquery-eu']);
  });
});
