/**
 * Integration Tests: Performance Benchmarks
 *
 * Tests system performance under various load conditions,
 * including query execution, connection management, caching efficiency,
 * and resource utilization.
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
    stop(): void {
      client.off('cache:hit', onHit);
      client.off('cache:miss', onMiss);
    },
  };
}

describe('Performance Benchmark Integration Tests', () => {
  let client: BigQueryClient;

  beforeAll(() => {
    client = new BigQueryClient({
      projectId: 'perf-test-project',
      connectionPool: {
        minConnections: 5,
        maxConnections: 20,
        acquireTimeoutMs: 10000,
      },
      datasetManager: {
        cacheSize: 200,
        cacheTTLMs: 300000,
      },
    });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await client.shutdown();
  });

  describe('Query Execution Performance', () => {
    it('should execute simple queries within acceptable time', async () => {
      const start = Date.now();

      const result = await client.query({
        query: 'SELECT 1 as test',
        dryRun: true,
      });

      const duration = Date.now() - start;

      // Correctness: the query completed and produced a well-formed result
      expect(result.jobId).toBeDefined();
      expect(Array.isArray(result.rows)).toBe(true);

      expectTiming(duration, 'simple query').toBeLessThan(2000); // 2 seconds max
    });

    it('should handle concurrent queries efficiently', async () => {
      const concurrentQueries = 20;
      const start = Date.now();

      const queries = Array(concurrentQueries)
        .fill(null)
        .map((_, i) =>
          client.query({
            query: `SELECT ${i} as id`,
            dryRun: true,
          })
        );

      const results = await Promise.all(queries);
      const duration = Date.now() - start;

      // Correctness: every concurrent query resolved — no pool deadlock
      expect(results).toHaveLength(concurrentQueries);
      expect(results.every((r) => r.jobId !== undefined)).toBe(true);

      expectTiming(duration, '20 concurrent queries').toBeLessThan(10000);

      // Calculate average query time
      const avgTime = duration / concurrentQueries;
      expectTiming(avgTime, 'average of 20 concurrent queries').toBeLessThan(1000);
    });

    it('should maintain throughput under sustained load', async () => {
      const iterations = 5;
      const queriesPerIteration = 10;
      const results: number[] = [];
      let completed = 0;

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();

        const batch = await Promise.all(
          Array(queriesPerIteration)
            .fill(null)
            .map(() =>
              client.query({
                query: 'SELECT 1',
                dryRun: true,
              })
            )
        );
        completed += batch.filter((r) => r.jobId !== undefined).length;

        const duration = Date.now() - start;
        results.push(duration);

        // Small delay between iterations
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // Correctness: throughput held — every query in every batch completed
      expect(completed).toBe(iterations * queriesPerIteration);

      // Throughput should remain consistent
      const avgDuration = results.reduce((a, b) => a + b, 0) / results.length;
      const maxDuration = Math.max(...results);

      // Max shouldn't be more than 2x average (no severe degradation).
      // Floored at timer resolution: against mocked I/O every batch lands at
      // 0-1ms, where a 2x ratio is not a measurable quantity.
      expectTiming(maxDuration, 'slowest sustained-load batch').toBeLessThan(
        Math.max(avgDuration * 2, RELATIVE_BUDGET_FLOOR_MS)
      );
    });

    it('should handle large result sets efficiently', async () => {
      const largeQuery = `
        SELECT
          *
        FROM
          UNNEST(GENERATE_ARRAY(1, 1000)) as id
      `;

      const start = Date.now();

      const result = await client.query({
        query: largeQuery,
        dryRun: true,
      });

      const duration = Date.now() - start;

      // Correctness: the large query completed and produced a result
      expect(result.jobId).toBeDefined();
      expect(Array.isArray(result.rows)).toBe(true);

      expectTiming(duration, 'large result set query').toBeLessThan(5000); // 5 seconds max
    });

    it('should optimize repeated queries', async () => {
      const query = 'SELECT COUNT(*) FROM `project.dataset.table`';

      // First execution
      const start1 = Date.now();
      const first = await client.query({ query, dryRun: true });
      const duration1 = Date.now() - start1;

      // Second execution (might benefit from caching)
      await client.query({ query, dryRun: true });
      await client.query({ query, dryRun: true });

      // Third execution
      const start3 = Date.now();
      const third = await client.query({ query, dryRun: true });
      const duration3 = Date.now() - start3;

      // Correctness: repeating a query keeps returning equivalent results
      expect(first.jobId).toBeDefined();
      expect(third.jobId).toBe(first.jobId);
      expect(third.totalRows).toBe(first.totalRows);

      // Subsequent executions should be similar or faster
      expectTiming(duration3, 'repeated query').toBeLessThanOrEqual(
        Math.max(duration1 * 1.5, RELATIVE_BUDGET_FLOOR_MS)
      );
    });
  });

  describe('Connection Pool Performance', () => {
    it('should acquire connections quickly', async () => {
      const acquisitions = 100;
      const before = client.getPoolMetrics();
      const start = Date.now();

      for (let i = 0; i < acquisitions; i++) {
        await client.query({
          query: 'SELECT 1',
          dryRun: true,
        });
      }

      const duration = Date.now() - start;
      const avgAcquireTime = duration / acquisitions;

      // Correctness: every query acquired and returned a connection
      const after = client.getPoolMetrics();
      expect(after.totalAcquired - before.totalAcquired).toBe(acquisitions);
      expect(after.totalReleased - before.totalReleased).toBe(acquisitions);
      expect(after.totalTimeouts).toBe(before.totalTimeouts);

      expectTiming(avgAcquireTime, 'average connection acquire').toBeLessThan(100);
    });

    it('should scale efficiently with concurrent connections', async () => {
      const tests = [
        { concurrent: 5, expected: 5000 },
        { concurrent: 10, expected: 8000 },
        { concurrent: 20, expected: 12000 },
      ];

      for (const test of tests) {
        const start = Date.now();

        const results = await Promise.all(
          Array(test.concurrent)
            .fill(null)
            .map(() =>
              client.query({
                query: 'SELECT 1',
                dryRun: true,
              })
            )
        );

        const duration = Date.now() - start;

        // Correctness: the pool served the whole batch and stayed within bounds
        expect(results).toHaveLength(test.concurrent);
        expect(results.every((r) => r.jobId !== undefined)).toBe(true);
        expect(client.getPoolMetrics().totalConnections).toBeLessThanOrEqual(20);

        expectTiming(duration, `${test.concurrent} concurrent queries`).toBeLessThan(test.expected);
      }
    });

    it('should maintain low connection acquisition latency', async () => {
      const metrics = client.getPoolMetrics();
      const baselineLatency = metrics.averageAcquireTimeMs;

      // Execute some queries
      const results = await Promise.all(
        Array(10)
          .fill(null)
          .map(() => client.query({ query: 'SELECT 1', dryRun: true }))
      );

      const newMetrics = client.getPoolMetrics();

      // Correctness: all ten acquisitions succeeded, none timed out
      expect(results).toHaveLength(10);
      expect(newMetrics.totalAcquired - metrics.totalAcquired).toBe(10);
      expect(newMetrics.totalTimeouts).toBe(metrics.totalTimeouts);

      // Latency shouldn't increase significantly
      expectTiming(newMetrics.averageAcquireTimeMs, 'pool acquire latency').toBeLessThan(
        baselineLatency + 50
      );
    });

    it('should handle connection churn efficiently', async () => {
      const iterations = 20;

      for (let i = 0; i < iterations; i++) {
        const metrics = client.getPoolMetrics();

        // Simulate acquire/release pattern
        await Promise.all([metrics.totalAcquired, metrics.totalReleased]);

        await new Promise((resolve) => setTimeout(resolve, 10));
      }

      const finalMetrics = client.getPoolMetrics();

      // Pool should remain healthy
      expect(finalMetrics.totalConnections).toBeGreaterThanOrEqual(5);
      expect(finalMetrics.totalConnections).toBeLessThanOrEqual(20);
    });
  });

  describe('Caching Performance', () => {
    it('should improve dataset access times with caching', async () => {
      const dataset = 'test_dataset';

      // Guarantee a cold cache so the miss/hit sequence is deterministic
      // regardless of what earlier tests in this file cached.
      client.invalidateCache();
      const cache = trackCacheEvents(client);

      // First access (cache miss)
      const start1 = Date.now();
      const first = await client.getDataset(dataset);
      const duration1 = Date.now() - start1;

      // Second access (cache hit)
      const start2 = Date.now();
      const second = await client.getDataset(dataset);
      const duration2 = Date.now() - start2;

      cache.stop();

      // Correctness: the second access was served from cache, not refetched
      expect(cache.counts.misses).toBe(1);
      expect(cache.counts.hits).toBe(1);
      expect(second).toEqual(first);

      // Cached access should be faster
      expectTiming(duration2, 'cached dataset access').toBeLessThanOrEqual(
        Math.max(duration1, RELATIVE_BUDGET_FLOOR_MS)
      );
    });

    it('should handle high cache hit rates', async () => {
      const datasets = ['dataset1', 'dataset2', 'dataset3'];

      // Warm up cache
      for (const ds of datasets) {
        await client.getDataset(ds);
      }

      // Count only the steady-state phase
      const cache = trackCacheEvents(client);

      // Access repeatedly
      const start = Date.now();

      for (let i = 0; i < 30; i++) {
        const ds = datasets[i % datasets.length];
        await client.getDataset(ds);
      }

      const duration = Date.now() - start;
      const avgTime = duration / 30;

      cache.stop();

      // Correctness: a warm cache serves every read without refetching
      expect(cache.counts.hits).toBe(30);
      expect(cache.counts.misses).toBe(0);

      // Average time should be low with cache hits
      expectTiming(avgTime, 'average cached dataset access').toBeLessThan(50);
    });

    it('should optimize cache eviction performance', async () => {
      const smallCacheClient = new BigQueryClient({
        projectId: 'cache-perf-test',
        datasetManager: {
          cacheSize: 10,
        },
      });

      // Fill cache beyond capacity
      const start = Date.now();

      for (let i = 0; i < 50; i++) {
        await smallCacheClient.getDataset(`dataset_${i}`);
      }

      const duration = Date.now() - start;
      const avgTime = duration / 50;

      // Correctness: LRU eviction held the cache at its configured capacity
      const stats = smallCacheClient.getCacheStats();
      expect(stats.datasets.maxSize).toBe(10);
      expect(stats.datasets.size).toBeLessThanOrEqual(10);

      // LRU eviction shouldn't cause significant slowdown
      expectTiming(avgTime, 'dataset fetch under LRU eviction').toBeLessThan(200);

      await smallCacheClient.shutdown();
    });

    it('should measure cache effectiveness', async () => {
      // Generate cache activity
      const datasets = Array(5)
        .fill(null)
        .map((_, i) => `dataset_${i}`);

      for (let round = 0; round < 3; round++) {
        for (const ds of datasets) {
          await client.getDataset(ds).catch(() => {});
        }
      }

      const stats = client.getCacheStats();

      expect(stats.datasets.hitRate).toBeGreaterThan(0);
      expect(stats.datasets.size).toBeLessThanOrEqual(stats.datasets.maxSize);
    });
  });

  describe('Resource Utilization', () => {
    it('should maintain stable memory usage', async () => {
      // Execute many operations
      for (let i = 0; i < 100; i++) {
        await client
          .query({
            query: `SELECT ${i}`,
            dryRun: true,
          })
          .catch(() => {});
      }

      const finalMetrics = client.getPoolMetrics();

      // Connection count should remain within bounds
      expect(finalMetrics.totalConnections).toBeLessThanOrEqual(20);
      expect(finalMetrics.totalConnections).toBeGreaterThanOrEqual(5);
    });

    it('should handle memory-intensive operations', async () => {
      const largeDatasetClient = new BigQueryClient({
        projectId: 'large-data-test',
        datasetManager: {
          cacheSize: 1000,
        },
      });

      // Simulate large metadata operations
      for (let i = 0; i < 100; i++) {
        await largeDatasetClient.getDataset(`dataset_${i}`).catch(() => {});
      }

      expect(largeDatasetClient.isHealthy()).toBe(true);

      await largeDatasetClient.shutdown();
    });

    it('should cleanup resources efficiently', async () => {
      const testClient = new BigQueryClient({
        projectId: 'cleanup-test',
        connectionPool: {
          minConnections: 2,
          maxConnections: 10,
          idleTimeoutMs: 1000,
        },
      });

      // Create many connections
      await Promise.all(
        Array(10)
          .fill(null)
          .map(() => testClient.query({ query: 'SELECT 1', dryRun: true }).catch(() => {}))
      );

      const beforeMetrics = testClient.getPoolMetrics();

      // Wait for idle timeout
      await new Promise((resolve) => setTimeout(resolve, 2000));

      const afterMetrics = testClient.getPoolMetrics();

      // Should have cleaned up idle connections
      expect(afterMetrics.totalConnections).toBeLessThanOrEqual(beforeMetrics.totalConnections);

      await testClient.shutdown();
    });
  });

  describe('Retry and Error Handling Performance', () => {
    it('should retry failed queries efficiently', async () => {
      // Fail the first two attempts with a retryable error, then succeed.
      const originalCreateQueryJob = BigQuery.prototype.createQueryJob;
      let attempts = 0;

      jest.spyOn(BigQuery.prototype, 'createQueryJob').mockImplementation(function (
        this: BigQuery,
        ...args: unknown[]
      ) {
        attempts++;
        if (attempts <= 2) {
          const error = new Error('Transient backend error');
          (error as unknown as { code: string }).code = 'BACKEND_ERROR';
          throw error;
        }
        return (originalCreateQueryJob as (...a: unknown[]) => unknown).apply(this, args);
      } as never);

      const start = Date.now();

      const result = await client.query({
        query: 'SELECT 1',
        retry: true,
        maxRetries: 3,
      });

      const duration = Date.now() - start;

      // Correctness: it retried twice and then returned a real result
      expect(attempts).toBe(3);
      expect(result.jobId).toBeDefined();

      // Retries with backoff shouldn't take too long
      expectTiming(duration, 'query with two retries').toBeLessThan(10000); // 10 seconds max
    }, 15000);

    it('should handle transient errors without degradation', async () => {
      const results: number[] = [];
      let completed = 0;

      for (let i = 0; i < 5; i++) {
        const start = Date.now();

        const result = await client.query({
          query: 'SELECT 1',
          dryRun: true,
          retry: true,
        });
        if (result.jobId !== undefined) {
          completed++;
        }

        results.push(Date.now() - start);
      }

      // Correctness: every query completed
      expect(completed).toBe(5);

      // Performance should remain consistent.
      // Floored at timer resolution: against mocked I/O all five samples land
      // at 0ms, and `expect(0).toBeLessThan(0)` is false.
      const avg = results.reduce((a, b) => a + b, 0) / results.length;
      const max = Math.max(...results);

      expectTiming(max, 'slowest of five sequential queries').toBeLessThan(
        Math.max(avg * 3, RELATIVE_BUDGET_FLOOR_MS)
      );
    });

    it('should implement exponential backoff efficiently', async () => {
      const retryClient = new BigQueryClient({
        projectId: 'retry-test',
        retry: {
          maxRetries: 5,
          initialDelayMs: 100,
          maxDelayMs: 5000,
          backoffMultiplier: 2,
        },
      });

      // The original test relied on the query 'INVALID' failing. Against the
      // shared BigQuery mock it succeeds immediately, so no retry ever ran and
      // the elapsed time was 0 — the assertion could never hold. Inject a
      // retryable failure so the backoff schedule actually engages.
      const scheduledDelays: number[] = [];
      retryClient.on('query:retry:attempt', (e: { delayMs: number }) =>
        scheduledDelays.push(e.delayMs)
      );

      let attempts = 0;
      jest.spyOn(BigQuery.prototype, 'createQueryJob').mockImplementation((() => {
        attempts++;
        const error = new Error('Rate limited');
        (error as unknown as { code: string }).code = 'RATE_LIMIT_EXCEEDED';
        throw error;
      }) as never);

      const start = Date.now();

      const failure = await retryClient
        .query({
          query: 'INVALID',
          retry: true,
        })
        .then(() => null)
        .catch((error: Error) => error);

      const duration = Date.now() - start;

      // Correctness: all 5 retries were spent, then the client gave up
      expect(attempts).toBe(6); // initial attempt + 5 retries
      expect(failure).toBeInstanceOf(Error);
      expect(scheduledDelays).toHaveLength(5);

      // Correctness: delays follow initialDelayMs * multiplier^(n-1), within
      // the +/-20% jitter band applied by BigQueryClient.calculateBackoff.
      [100, 200, 400, 800, 1600].forEach((base, i) => {
        expect(scheduledDelays[i]).toBeGreaterThanOrEqual(Math.floor(base * 0.8));
        expect(scheduledDelays[i]).toBeLessThanOrEqual(Math.ceil(base * 1.2));
      });

      // Correctness: each retry waits strictly longer than the one before it
      for (let i = 1; i < scheduledDelays.length; i++) {
        expect(scheduledDelays[i]).toBeGreaterThan(scheduledDelays[i - 1]);
      }

      // Total retry time should respect backoff configuration.
      //
      // The original bound was `> 3000`, justified as "100+200+400+800+1600 =
      // 3100ms minimum". That ignores the +/-20% jitter calculateBackoff applies
      // to every delay: the reachable floor is 3100 * 0.8 = 2480ms, so a fast
      // run legitimately lands under 3000ms (observed: 2935ms). The exact bound
      // is the sum of the delays the client actually scheduled — setTimeout
      // never fires early, so elapsed time strictly exceeds it.
      const scheduledTotal = scheduledDelays.reduce((a, b) => a + b, 0);
      expectTiming(duration, 'five exponential-backoff retries').toBeGreaterThan(scheduledTotal);
      expectTiming(duration, 'five exponential-backoff retries').toBeLessThan(10000);

      await retryClient.shutdown();
    }, 20000);
  });

  describe('Benchmark Summary', () => {
    it('should meet overall performance targets', async () => {
      const benchmarks = {
        simpleQuery: 0,
        concurrentQueries: 0,
        cacheAccess: 0,
        connectionAcquire: 0,
      };

      // Simple query
      let start = Date.now();
      const simple = await client.query({ query: 'SELECT 1', dryRun: true });
      benchmarks.simpleQuery = Date.now() - start;

      // Concurrent queries
      start = Date.now();
      const concurrent = await Promise.all(
        Array(10)
          .fill(null)
          .map(() => client.query({ query: 'SELECT 1', dryRun: true }))
      );
      benchmarks.concurrentQueries = Date.now() - start;

      // Cache access
      await client.getDataset('test_dataset');
      const cache = trackCacheEvents(client);
      start = Date.now();
      await client.getDataset('test_dataset');
      benchmarks.cacheAccess = Date.now() - start;
      cache.stop();

      // Connection acquire
      const metrics = client.getPoolMetrics();
      benchmarks.connectionAcquire = metrics.averageAcquireTimeMs;

      // Correctness: each benchmarked operation actually did its job
      expect(simple.jobId).toBeDefined();
      expect(concurrent).toHaveLength(10);
      expect(concurrent.every((r) => r.jobId !== undefined)).toBe(true);
      expect(cache.counts.hits).toBe(1);
      expect(cache.counts.misses).toBe(0);
      expect(metrics.totalAcquired).toBeGreaterThan(0);

      // Verify all benchmarks meet targets
      expectTiming(benchmarks.simpleQuery, 'benchmark: simple query').toBeLessThan(2000);
      expectTiming(benchmarks.concurrentQueries, 'benchmark: concurrent queries').toBeLessThan(
        10000
      );
      expectTiming(benchmarks.cacheAccess, 'benchmark: cache access').toBeLessThan(100);
      expectTiming(benchmarks.connectionAcquire, 'benchmark: connection acquire').toBeLessThan(100);
    });

    it('should generate performance report', () => {
      const poolMetrics = client.getPoolMetrics();
      const cacheStats = client.getCacheStats();

      const report = {
        pool: {
          totalConnections: poolMetrics.totalConnections,
          activeConnections: poolMetrics.activeConnections,
          averageAcquireTime: poolMetrics.averageAcquireTimeMs,
          totalAcquired: poolMetrics.totalAcquired,
          uptime: poolMetrics.uptime,
        },
        cache: {
          datasetCacheSize: cacheStats.datasets.size,
          tableCacheSize: cacheStats.tables.size,
          datasetHitRate: cacheStats.datasets.hitRate,
          tableHitRate: cacheStats.tables.hitRate,
        },
      };

      expect(report.pool.totalConnections).toBeGreaterThan(0);
      expect(report.pool.uptime).toBeGreaterThan(0);

      console.log('Performance Report:', JSON.stringify(report, null, 2));
    });
  });
});
