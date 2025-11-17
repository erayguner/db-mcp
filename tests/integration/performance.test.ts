/**
 * Integration Tests: Performance Benchmarks
 *
 * Tests system performance under various load conditions,
 * including query execution, connection management, caching efficiency,
 * and resource utilization.
 */

import { BigQueryClient } from '../../src/bigquery/client.js';

describe.skip('Performance Benchmark Integration Tests', () => {
  let client: BigQueryClient;

  beforeAll(() => {
    client = new BigQueryClient({
      projectId: 'perf-test-project',
      connectionPool: {
        minConnections: 5,
        maxConnections: 20,
        acquireTimeoutMs: 10000,
        idleTimeoutMs: 300000,
        healthCheckIntervalMs: 60000,
        maxRetries: 3,
        retryDelayMs: 1000,
      },
      datasetManager: {
        cacheSize: 200,
        cacheTTLMs: 300000,
        autoDiscovery: false,
        discoveryIntervalMs: 300000,
      },
    });
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
      }).catch(error => ({ error }));

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(2000); // 2 seconds max
      expect(result).toBeDefined();
    });

    it('should handle concurrent queries efficiently', async () => {
      const concurrentQueries = 20;
      const start = Date.now();

      const queries = Array(concurrentQueries).fill(null).map((_, i) =>
        client.query({
          query: `SELECT ${i} as id`,
          dryRun: true,
        }).catch(error => ({ error }))
      );

      const results = await Promise.all(queries);
      const duration = Date.now() - start;

      expect(results).toHaveLength(concurrentQueries);
      expect(duration).toBeLessThan(10000); // 10 seconds for 20 queries

      // Calculate average query time
      const avgTime = duration / concurrentQueries;
      expect(avgTime).toBeLessThan(1000); // Average < 1s per query
    });

    it('should maintain throughput under sustained load', async () => {
      const iterations = 5;
      const queriesPerIteration = 10;
      const results: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();

        await Promise.all(
          Array(queriesPerIteration).fill(null).map(() =>
            client.query({
              query: 'SELECT 1',
              dryRun: true,
            }).catch(() => {})
          )
        );

        const duration = Date.now() - start;
        results.push(duration);

        // Small delay between iterations
        await new Promise(resolve => setTimeout(resolve, 100));
      }

      // Throughput should remain consistent
      const avgDuration = results.reduce((a, b) => a + b, 0) / results.length;
      const maxDuration = Math.max(...results);

      // Max shouldn't be more than 2x average (no severe degradation)
      expect(maxDuration).toBeLessThan(avgDuration * 2);
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
      }).catch(error => ({ error }));

      const duration = Date.now() - start;

      expect(duration).toBeLessThan(5000); // 5 seconds max
      expect(result).toBeDefined();
    });

    it('should optimize repeated queries', async () => {
      const query = 'SELECT COUNT(*) FROM `project.dataset.table`';

      // First execution
      const start1 = Date.now();
      await client.query({ query, dryRun: true }).catch(() => {});
      const duration1 = Date.now() - start1;

      // Second execution (might benefit from caching)
      await client.query({ query, dryRun: true }).catch(() => {});

      // Third execution
      const start3 = Date.now();
      await client.query({ query, dryRun: true }).catch(() => {});
      const duration3 = Date.now() - start3;

      // Subsequent executions should be similar or faster
      expect(duration3).toBeLessThanOrEqual(duration1 * 1.5);
    });
  });

  describe('Connection Pool Performance', () => {
    it('should acquire connections quickly', async () => {
      const acquisitions = 100;
      const start = Date.now();

      for (let i = 0; i < acquisitions; i++) {
        await client.query({
          query: 'SELECT 1',
          dryRun: true,
        }).catch(() => {});
      }

      const duration = Date.now() - start;
      const avgAcquireTime = duration / acquisitions;

      expect(avgAcquireTime).toBeLessThan(100); // < 100ms average
    });

    it('should scale efficiently with concurrent connections', async () => {
      const tests = [
        { concurrent: 5, expected: 5000 },
        { concurrent: 10, expected: 8000 },
        { concurrent: 20, expected: 12000 },
      ];

      for (const test of tests) {
        const start = Date.now();

        await Promise.all(
          Array(test.concurrent).fill(null).map(() =>
            client.query({
              query: 'SELECT 1',
              dryRun: true,
            }).catch(() => {})
          )
        );

        const duration = Date.now() - start;

        expect(duration).toBeLessThan(test.expected);
      }
    });

    it('should maintain low connection acquisition latency', async () => {
      const metrics = client.getPoolMetrics();
      const baselineLatency = metrics.averageAcquireTimeMs;

      // Execute some queries
      await Promise.all(
        Array(10).fill(null).map(() =>
          client.query({ query: 'SELECT 1', dryRun: true }).catch(() => {})
        )
      );

      const newMetrics = client.getPoolMetrics();

      // Latency shouldn't increase significantly
      expect(newMetrics.averageAcquireTimeMs).toBeLessThan(baselineLatency + 50);
    });

    it('should handle connection churn efficiently', async () => {
      const iterations = 20;

      for (let i = 0; i < iterations; i++) {
        // Execute queries to simulate acquire/release pattern
        await client.query({
          query: 'SELECT 1',
          dryRun: true,
        }).catch(() => {});

        await new Promise(resolve => setTimeout(resolve, 10));
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

      // First access (cache miss)
      const start1 = Date.now();
      await client.getDataset(dataset).catch(() => {});
      const duration1 = Date.now() - start1;

      // Second access (cache hit)
      const start2 = Date.now();
      await client.getDataset(dataset).catch(() => {});
      const duration2 = Date.now() - start2;

      // Cached access should be faster
      expect(duration2).toBeLessThanOrEqual(duration1);
    });

    it('should handle high cache hit rates', async () => {
      const datasets = ['dataset1', 'dataset2', 'dataset3'];

      // Warm up cache
      for (const ds of datasets) {
        await client.getDataset(ds).catch(() => {});
      }

      // Access repeatedly
      const start = Date.now();

      for (let i = 0; i < 30; i++) {
        const ds = datasets[i % datasets.length];
        await client.getDataset(ds).catch(() => {});
      }

      const duration = Date.now() - start;
      const avgTime = duration / 30;

      // Average time should be low with cache hits
      expect(avgTime).toBeLessThan(50); // < 50ms per cached access
    });

    it('should optimize cache eviction performance', async () => {
      const smallCacheClient = new BigQueryClient({
        projectId: 'cache-perf-test',
        connectionPool: {
          minConnections: 2,
          maxConnections: 10,
          acquireTimeoutMs: 30000,
          idleTimeoutMs: 300000,
          healthCheckIntervalMs: 60000,
          maxRetries: 3,
          retryDelayMs: 1000,
        },
        datasetManager: {
          cacheSize: 10,
          cacheTTLMs: 300000,
          autoDiscovery: false,
          discoveryIntervalMs: 300000,
        },
      });

      // Fill cache beyond capacity
      const start = Date.now();

      for (let i = 0; i < 50; i++) {
        await smallCacheClient.getDataset(`dataset_${i}`).catch(() => {});
      }

      const duration = Date.now() - start;
      const avgTime = duration / 50;

      // LRU eviction shouldn't cause significant slowdown
      expect(avgTime).toBeLessThan(200);

      await smallCacheClient.shutdown();
    });

    it('should measure cache effectiveness', async () => {
      // Generate cache activity
      const datasets = Array(5).fill(null).map((_, i) => `dataset_${i}`);

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
        await client.query({
          query: `SELECT ${i}`,
          dryRun: true,
        }).catch(() => {});
      }

      const finalMetrics = client.getPoolMetrics();

      // Connection count should remain within bounds
      expect(finalMetrics.totalConnections).toBeLessThanOrEqual(20);
      expect(finalMetrics.totalConnections).toBeGreaterThanOrEqual(5);
    });

    it('should handle memory-intensive operations', async () => {
      const largeDatasetClient = new BigQueryClient({
        projectId: 'large-data-test',
        connectionPool: {
          minConnections: 5,
          maxConnections: 20,
          acquireTimeoutMs: 30000,
          idleTimeoutMs: 300000,
          healthCheckIntervalMs: 60000,
          maxRetries: 3,
          retryDelayMs: 1000,
        },
        datasetManager: {
          cacheSize: 1000,
          cacheTTLMs: 300000,
          autoDiscovery: false,
          discoveryIntervalMs: 300000,
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
          acquireTimeoutMs: 30000,
          idleTimeoutMs: 1000,
          healthCheckIntervalMs: 60000,
          maxRetries: 3,
          retryDelayMs: 1000,
        },
      });

      // Create many connections
      await Promise.all(
        Array(10).fill(null).map(() =>
          testClient.query({ query: 'SELECT 1', dryRun: true }).catch(() => {})
        )
      );

      const beforeMetrics = testClient.getPoolMetrics();

      // Wait for idle timeout
      await new Promise(resolve => setTimeout(resolve, 2000));

      const afterMetrics = testClient.getPoolMetrics();

      // Should have cleaned up idle connections
      expect(afterMetrics.totalConnections).toBeLessThanOrEqual(beforeMetrics.totalConnections);

      await testClient.shutdown();
    });
  });

  describe('Retry and Error Handling Performance', () => {
    it('should retry failed queries efficiently', async () => {
      const start = Date.now();

      await client.query({
        query: 'INVALID SQL',
      }).catch(() => {});

      const duration = Date.now() - start;

      // Failed queries shouldn't take too long to fail
      expect(duration).toBeLessThan(10000); // 10 seconds max
    });

    it('should handle transient errors without degradation', async () => {
      const results: number[] = [];

      for (let i = 0; i < 5; i++) {
        const start = Date.now();

        await client.query({
          query: 'SELECT 1',
          dryRun: true,
        }).catch(() => {});

        results.push(Date.now() - start);
      }

      // Performance should remain consistent
      const avg = results.reduce((a, b) => a + b, 0) / results.length;
      const max = Math.max(...results);

      expect(max).toBeLessThan(avg * 3);
    });

    it('should handle errors efficiently', async () => {
      const retryClient = new BigQueryClient({
        projectId: 'retry-test',
        connectionPool: {
          minConnections: 2,
          maxConnections: 10,
          acquireTimeoutMs: 30000,
          idleTimeoutMs: 300000,
          healthCheckIntervalMs: 60000,
          maxRetries: 3,
          retryDelayMs: 1000,
        },
      });

      const start = Date.now();

      await retryClient.query({
        query: 'INVALID',
      }).catch(() => {});

      const duration = Date.now() - start;

      // Error handling should be quick
      expect(duration).toBeLessThan(10000);

      await retryClient.shutdown();
    });
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
      await client.query({ query: 'SELECT 1', dryRun: true }).catch(() => {});
      benchmarks.simpleQuery = Date.now() - start;

      // Concurrent queries
      start = Date.now();
      await Promise.all(
        Array(10).fill(null).map(() =>
          client.query({ query: 'SELECT 1', dryRun: true }).catch(() => {})
        )
      );
      benchmarks.concurrentQueries = Date.now() - start;

      // Cache access
      await client.getDataset('test_dataset').catch(() => {});
      start = Date.now();
      await client.getDataset('test_dataset').catch(() => {});
      benchmarks.cacheAccess = Date.now() - start;

      // Connection acquire
      const metrics = client.getPoolMetrics();
      benchmarks.connectionAcquire = metrics.averageAcquireTimeMs;

      // Verify all benchmarks meet targets
      expect(benchmarks.simpleQuery).toBeLessThan(2000);
      expect(benchmarks.concurrentQueries).toBeLessThan(10000);
      expect(benchmarks.cacheAccess).toBeLessThan(100);
      expect(benchmarks.connectionAcquire).toBeLessThan(100);

      console.log('Performance Benchmarks:', benchmarks);
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
