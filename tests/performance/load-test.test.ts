/**
 * Performance and Load Tests
 * Validates system behaviour under various load conditions.
 *
 * MOCKING NOTE
 * ------------
 * This suite previously declared its own
 *   jest.mock('@google-cloud/bigquery', () => ({ BigQuery: jest.fn() }))
 * and then swapped the constructor via `jest.mocked(BigQuery).mockImplementation`.
 * Under Jest's ESM runtime that `jest.mock` factory is never applied to a static
 * import, so `BigQuery` stayed the real class and `.mockImplementation` was
 * undefined — every test in the file died in `beforeEach`.
 *
 * What is actually in force is __mocks__/@google-cloud/bigquery.js, which Jest
 * applies automatically for node_modules packages with a root __mocks__ entry.
 * Since ConnectionPool constructs its own `new BigQuery(...)` instances, the
 * prototype is the only seam that reaches every pooled connection — so per-test
 * behaviour is installed with `jest.spyOn(BigQuery.prototype, ...)`.
 *
 * Correctness assertions run on every `npm test`. Pure wall-clock budgets go
 * through `expectTiming` and are enforced only under `npm run test:performance`
 * — see tests/helpers/perf-timing.ts.
 */

import { BigQuery } from '@google-cloud/bigquery';
import { BigQueryClient } from '../../src/bigquery/client.js';
import { expectTiming, RELATIVE_BUDGET_FLOOR_MS } from '../helpers/perf-timing.js';

/** Count the cache:hit / cache:miss events the client forwards from DatasetManager. */
function trackCacheEvents(client: BigQueryClient) {
  const counts = { hits: 0, misses: 0 };
  const onHit = (): number => (counts.hits += 1);
  const onMiss = (): number => (counts.misses += 1);

  client.on('cache:hit', onHit);
  client.on('cache:miss', onMiss);

  return {
    counts,
    reset(): void {
      counts.hits = 0;
      counts.misses = 0;
    },
    stop(): void {
      client.off('cache:hit', onHit);
      client.off('cache:miss', onMiss);
    },
  };
}

describe('Performance Tests', () => {
  let client: BigQueryClient;

  beforeEach(() => {
    client = new BigQueryClient({
      projectId: 'test-project',
      connectionPool: {
        minConnections: 5,
        maxConnections: 20,
      },
    });
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    await client.shutdown();
  });

  describe('Query Performance', () => {
    it('should execute simple queries under 100ms', async () => {
      const start = Date.now();

      const result = await client.query({
        query: 'SELECT 1',
      });

      const duration = Date.now() - start;

      // Correctness: the query round-tripped through the pool
      expect(result.jobId).toBeDefined();
      expect(Array.isArray(result.rows)).toBe(true);

      expectTiming(duration, 'simple query').toBeLessThan(100);
    });

    it('should handle 100 concurrent queries', async () => {
      const queries = Array(100)
        .fill(null)
        .map((_, i) => client.query({ query: `SELECT ${i} as num` }));

      const start = Date.now();
      const results = await Promise.all(queries);
      const duration = Date.now() - start;

      // Correctness: every queued query resolved — no pool deadlock
      expect(results).toHaveLength(100);
      expect(results.every((r) => r.jobId !== undefined)).toBe(true);

      expectTiming(duration, '100 concurrent queries').toBeLessThan(5000);
    }, 10000);

    it('should maintain throughput under sustained load', async () => {
      const iterations = 50;
      const durations: number[] = [];
      const results = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        results.push(await client.query({ query: 'SELECT 1' }));
        durations.push(Date.now() - start);
      }

      // Correctness: sustained load did not drop or fail a query
      expect(results).toHaveLength(iterations);
      expect(results.every((r) => r.jobId !== undefined)).toBe(true);

      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const maxDuration = Math.max(...durations);

      expectTiming(avgDuration, 'sustained load, average query').toBeLessThan(50);
      expectTiming(maxDuration, 'sustained load, slowest query').toBeLessThan(200);
    }, 10000);
  });

  describe('Connection Pool Performance', () => {
    it('should reuse connections efficiently', async () => {
      const queries = Array(20)
        .fill(null)
        .map(() => client.query({ query: 'SELECT 1' }));

      await Promise.all(queries);

      const metrics = client.getPoolMetrics();
      expect(metrics.totalConnections).toBeLessThanOrEqual(20);
      expect(metrics.totalConnections).toBeGreaterThan(0);
    });

    it('should handle connection pool exhaustion', async () => {
      // Create more concurrent queries than max pool size
      const queries = Array(50)
        .fill(null)
        .map((_, i) => client.query({ query: `SELECT ${i}` }));

      const results = await Promise.all(queries);

      expect(results).toHaveLength(50);
      // Demand above maxConnections must queue, never grow the pool past its cap
      expect(client.getPoolMetrics().totalConnections).toBeLessThanOrEqual(20);
    }, 15000);

    it('should recover connections after failures', async () => {
      // Cause some failures. A plain Error is non-retryable, so these fail fast
      // instead of burning the retry backoff schedule.
      const failing = jest.spyOn(BigQuery.prototype, 'createQueryJob').mockImplementation((() => {
        throw new Error('Mock BigQuery Error');
      }) as never);

      const failingResults = await Promise.all(
        Array(5)
          .fill(null)
          .map(() =>
            client
              .query({ query: 'SELECT 1' })
              .then(() => 'ok')
              .catch(() => null)
          )
      );

      // Correctness: the injected fault really did surface as query failures
      expect(failingResults.every((r) => r === null)).toBe(true);

      // Reset and verify recovery
      failing.mockRestore();

      const successfulQueries = Array(5)
        .fill(null)
        .map(() => client.query({ query: 'SELECT 1' }));

      const results = await Promise.all(successfulQueries);
      expect(results).toHaveLength(5);
      expect(results.every((r) => r !== null && r.jobId !== undefined)).toBe(true);
      expect(client.isHealthy()).toBe(true);
    });
  });

  describe('Cache Performance', () => {
    it('should improve performance with caching', async () => {
      const cache = trackCacheEvents(client);

      // First call (cache miss)
      const start1 = Date.now();
      await client.getDataset('test_dataset');
      const duration1 = Date.now() - start1;

      // Second call (cache hit)
      const start2 = Date.now();
      await client.getDataset('test_dataset');
      const duration2 = Date.now() - start2;

      cache.stop();

      // Correctness: the second call was served from cache, not refetched
      expect(cache.counts.misses).toBe(1);
      expect(cache.counts.hits).toBe(1);

      expectTiming(duration2, 'cached dataset access').toBeLessThan(
        Math.max(duration1, RELATIVE_BUDGET_FLOOR_MS)
      );
    });

    it('should handle cache under high load', async () => {
      const datasets = ['ds1', 'ds2', 'ds3', 'ds4', 'ds5'];

      // Populate cache
      await Promise.all(datasets.map((ds) => client.getDataset(ds)));

      // Only count the concurrent phase
      const cache = trackCacheEvents(client);

      const queries = Array(100)
        .fill(null)
        .map(() => {
          const randomDs = datasets[Math.floor(Math.random() * datasets.length)];
          return client.getDataset(randomDs);
        });

      const start = Date.now();
      const results = await Promise.all(queries);
      const duration = Date.now() - start;

      cache.stop();

      // Correctness: a warm cache serves every concurrent read without refetching
      expect(results).toHaveLength(100);
      expect(cache.counts.hits).toBe(100);
      expect(cache.counts.misses).toBe(0);

      expectTiming(duration, '100 concurrent cached dataset reads').toBeLessThan(1000);
    }, 10000);

    it('should maintain cache efficiency', async () => {
      const cache = trackCacheEvents(client);
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        await client.getDataset('test_dataset');
      }

      cache.stop();

      // Correctness: exactly one fetch, everything after it is a hit
      expect(cache.counts.misses).toBe(1);
      expect(cache.counts.hits).toBe(iterations - 1);

      const hitRate = cache.counts.hits / (cache.counts.hits + cache.counts.misses);
      expect(hitRate).toBe(0.99);
    });
  });

  describe('Memory Performance', () => {
    it('should not leak memory under sustained load', async () => {
      if (global.gc) {
        global.gc();
      }

      const initialMemory = process.memoryUsage().heapUsed;

      // Run many queries
      for (let i = 0; i < 1000; i++) {
        await client.query({ query: 'SELECT 1' });
      }

      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Memory increase should be minimal (< 50MB)
      expect(memoryIncrease).toBeLessThan(50 * 1024 * 1024);
    }, 30000);

    it('should handle large result sets efficiently', async () => {
      // Mock large result set. generateMockResults is a method on the shared
      // mock's prototype, so this reaches every pooled connection.
      const largeResults = Array(10000)
        .fill(null)
        .map((_, i) => ({
          id: i,
          name: `Record ${i}`,
          data: 'x'.repeat(100),
        }));

      jest
        .spyOn(
          BigQuery.prototype as unknown as { generateMockResults: () => unknown[] },
          'generateMockResults'
        )
        .mockReturnValue(largeResults);

      const result = await client.query({
        query: 'SELECT * FROM large_table',
      });

      expect(result.rows).toHaveLength(10000);
      expect(result.totalRows).toBe(10000);
      expect(result.rows[9999]).toMatchObject({ id: 9999, name: 'Record 9999' });
    });
  });

  describe('Retry Performance', () => {
    it('should handle retries with minimal overhead', async () => {
      const originalCreateQueryJob = BigQuery.prototype.createQueryJob;
      let attemptCount = 0;

      jest.spyOn(BigQuery.prototype, 'createQueryJob').mockImplementation(function (
        this: BigQuery,
        ...args: unknown[]
      ) {
        attemptCount++;
        if (attemptCount === 1) {
          const error = new Error('Temporary error');
          (error as unknown as { code: string }).code = 'RATE_LIMIT_EXCEEDED';
          throw error;
        }
        return (originalCreateQueryJob as (...a: unknown[]) => unknown).apply(this, args);
      } as never);

      const start = Date.now();
      const result = await client.query({
        query: 'SELECT 1',
        maxRetries: 3,
      });
      const duration = Date.now() - start;

      // Correctness: it retried exactly once and then succeeded
      expect(attemptCount).toBe(2);
      expect(result.jobId).toBeDefined();

      // Even with retry, should complete quickly
      expectTiming(duration, 'query with one retry').toBeLessThan(2000);
    });

    it('should exponentially backoff retries', async () => {
      // Dedicated client so the backoff schedule is explicit and fast.
      // (initialDelayMs has a floor of 100ms in BigQueryClientConfigSchema.)
      const retryClient = new BigQueryClient({
        projectId: 'test-project',
        retry: {
          maxRetries: 5,
          initialDelayMs: 100,
          maxDelayMs: 5000,
          backoffMultiplier: 2,
        },
      });

      const scheduledDelays: number[] = [];
      retryClient.on('query:retry:attempt', (e: { delayMs: number }) =>
        scheduledDelays.push(e.delayMs)
      );

      const originalCreateQueryJob = BigQuery.prototype.createQueryJob;
      let attempts = 0;

      jest.spyOn(BigQuery.prototype, 'createQueryJob').mockImplementation(function (
        this: BigQuery,
        ...args: unknown[]
      ) {
        attempts++;
        if (attempts <= 3) {
          const error = new Error('Retry error');
          (error as unknown as { code: string }).code = 'RATE_LIMIT_EXCEEDED';
          throw error;
        }
        return (originalCreateQueryJob as (...a: unknown[]) => unknown).apply(this, args);
      } as never);

      const start = Date.now();
      const result = await retryClient.query({
        query: 'SELECT 1',
        maxRetries: 5,
      });
      const elapsed = Date.now() - start;

      // Correctness: three failures, three scheduled retries, then success
      expect(attempts).toBe(4);
      expect(result.jobId).toBeDefined();
      expect(scheduledDelays).toHaveLength(3);

      // Correctness: each delay follows initialDelay * multiplier^(n-1) within
      // the +/-20% jitter band applied by BigQueryClient.calculateBackoff.
      [100, 200, 400].forEach((base, i) => {
        expect(scheduledDelays[i]).toBeGreaterThanOrEqual(Math.floor(base * 0.8));
        expect(scheduledDelays[i]).toBeLessThanOrEqual(Math.ceil(base * 1.2));
      });

      // Correctness: each retry waits strictly longer than the previous one
      expect(scheduledDelays[1]).toBeGreaterThan(scheduledDelays[0]);
      expect(scheduledDelays[2]).toBeGreaterThan(scheduledDelays[1]);

      // The wall-clock cost of that schedule (100+200+400 = 700ms nominal)
      const scheduledTotal = scheduledDelays.reduce((a, b) => a + b, 0);
      expectTiming(elapsed, 'three exponential-backoff retries').toBeGreaterThan(
        scheduledTotal * 0.8
      );

      await retryClient.shutdown();
    }, 10000);
  });

  describe('Stress Tests', () => {
    it('should handle rapid fire queries', async () => {
      const queries = [];

      for (let i = 0; i < 200; i++) {
        queries.push(client.query({ query: `SELECT ${i}` }));
      }

      const results = await Promise.all(queries);
      expect(results).toHaveLength(200);
      expect(results.every((r) => r.jobId !== undefined)).toBe(true);
      expect(client.getPoolMetrics().totalConnections).toBeLessThanOrEqual(20);
    }, 20000);

    it('should handle mixed operations under load', async () => {
      const operations: Promise<unknown>[] = [];

      for (let i = 0; i < 50; i++) {
        operations.push(client.query({ query: `SELECT ${i}` }));
        operations.push(client.listDatasets());
        operations.push(client.listTables('test_dataset'));
        operations.push(client.getTable('test_dataset', 'test_table'));
      }

      const results = await Promise.all(operations);
      expect(results).toHaveLength(200);
      expect(results.every((r) => r !== undefined && r !== null)).toBe(true);
      expect(client.isHealthy()).toBe(true);
    }, 20000);
  });
});

describe('Benchmark Tests', () => {
  it('should measure query execution time', async () => {
    const client = new BigQueryClient({ projectId: 'test-project' });

    const measurements = [];
    const results = [];

    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      results.push(await client.query({ query: 'SELECT 1' }));
      measurements.push(performance.now() - start);
    }

    // Correctness: every measured query actually executed
    expect(results).toHaveLength(10);
    expect(results.every((r) => r.jobId !== undefined)).toBe(true);

    const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length;

    expectTiming(avg, 'average query execution').toBeLessThan(100);

    await client.shutdown();
  });

  it('should measure cache performance', async () => {
    const client = new BigQueryClient({ projectId: 'test-project' });
    const cache = trackCacheEvents(client);

    // Cache miss
    const start1 = performance.now();
    await client.getDataset('test_dataset');
    const missDuration = performance.now() - start1;

    // Cache hit
    const start2 = performance.now();
    await client.getDataset('test_dataset');
    const hitDuration = performance.now() - start2;

    cache.stop();

    // Correctness: one fetch, one cache hit
    expect(cache.counts.misses).toBe(1);
    expect(cache.counts.hits).toBe(1);

    expectTiming(hitDuration, 'cache hit vs miss').toBeLessThan(
      Math.max(missDuration, RELATIVE_BUDGET_FLOOR_MS)
    );

    await client.shutdown();
  });
});
