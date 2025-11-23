/**
 * Performance and Load Tests
 * Validates system performance under various load conditions
 */

import { BigQuery } from '@google-cloud/bigquery';
import { BigQueryClient } from '../../src/bigquery/client';
import { createMockBigQuery, MockBigQuery } from '../mocks/bigquery-mock';

jest.mock('@google-cloud/bigquery', () => ({
  BigQuery: jest.fn(),
}));

const skipPerf = process.env.MOCK_FAST === 'true' || process.env.USE_MOCK_BIGQUERY === 'true';
const describePerf = skipPerf ? describe.skip : describe;

describePerf('Performance Tests', () => {
  let mockBQ: MockBigQuery;
  let client: BigQueryClient;

  beforeEach(() => {
    mockBQ = createMockBigQuery();

    const BigQueryMock = jest.mocked(BigQuery);
    BigQueryMock.mockImplementation(() => mockBQ as any);

    client = new BigQueryClient({
      projectId: 'test-project',
      connectionPool: {
        minConnections: 5,
        maxConnections: 20,
      },
    });
  });

  afterEach(async () => {
    await client.shutdown();
  });

  describe('Query Performance', () => {
    it('should execute simple queries under 100ms', async () => {
      const start = Date.now();

      await client.query({
        query: 'SELECT 1',
      });

      const duration = Date.now() - start;
      expect(duration).toBeLessThan(100);
    });

    it('should handle 100 concurrent queries', async () => {
      const queries = Array(100).fill(null).map((_, i) =>
        client.query({ query: `SELECT ${i} as num` })
      );

      const start = Date.now();
      const results = await Promise.all(queries);
      const duration = Date.now() - start;

      expect(results).toHaveLength(100);
      expect(duration).toBeLessThan(5000); // 5 seconds for 100 queries
    }, 10000);

    it('should maintain throughput under sustained load', async () => {
      const iterations = 50;
      const durations: number[] = [];

      for (let i = 0; i < iterations; i++) {
        const start = Date.now();
        await client.query({ query: 'SELECT 1' });
        durations.push(Date.now() - start);
      }

      const avgDuration = durations.reduce((a, b) => a + b, 0) / durations.length;
      const maxDuration = Math.max(...durations);

      expect(avgDuration).toBeLessThan(50);
      expect(maxDuration).toBeLessThan(200);
    }, 10000);
  });

  describe('Connection Pool Performance', () => {
    it('should reuse connections efficiently', async () => {
      const queries = Array(20).fill(null).map(() =>
        client.query({ query: 'SELECT 1' })
      );

      await Promise.all(queries);

      const metrics = client.getPoolMetrics();
      expect(metrics.totalConnections).toBeLessThanOrEqual(20);
      expect(metrics.totalConnections).toBeGreaterThan(0);
    });

    it('should handle connection pool exhaustion', async () => {
      // Create more concurrent queries than max pool size
      const queries = Array(50).fill(null).map((_, i) =>
        client.query({ query: `SELECT ${i}` })
      );

      const results = await Promise.all(queries);
      expect(results).toHaveLength(50);
    }, 15000);

    it('should recover connections after failures', async () => {
      // Cause some failures
      mockBQ.setShouldFail(true);

      const failingQueries = Array(5).fill(null).map(() =>
        client.query({ query: 'SELECT 1' }).catch(() => null)
      );

      await Promise.all(failingQueries);

      // Reset and verify recovery
      mockBQ.setShouldFail(false);

      const successfulQueries = Array(5).fill(null).map(() =>
        client.query({ query: 'SELECT 1' })
      );

      const results = await Promise.all(successfulQueries);
      expect(results.every(r => r !== null)).toBe(true);
    });
  });

  describe('Cache Performance', () => {
    it('should improve performance with caching', async () => {
      // First call (cache miss)
      const start1 = Date.now();
      await client.getDataset('test_dataset');
      const duration1 = Date.now() - start1;

      // Second call (cache hit)
      const start2 = Date.now();
      await client.getDataset('test_dataset');
      const duration2 = Date.now() - start2;

      expect(duration2).toBeLessThan(duration1);
    });

    it('should handle cache under high load', async () => {
      const datasets = ['ds1', 'ds2', 'ds3', 'ds4', 'ds5'];

      // Populate cache
      await Promise.all(datasets.map(ds => client.getDataset(ds)));

      // Concurrent cache hits
      const queries = Array(100).fill(null).map(() => {
        const randomDs = datasets[Math.floor(Math.random() * datasets.length)];
        return client.getDataset(randomDs);
      });

      const start = Date.now();
      await Promise.all(queries);
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(1000);

      const stats = client.getCacheStats();
      expect(stats.hits).toBeGreaterThan(90); // Most should be cache hits
    }, 10000);

    it('should maintain cache efficiency', async () => {
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        await client.getDataset('test_dataset');
      }

      const stats = client.getCacheStats();
      const hitRate = stats.hits / (stats.hits + stats.misses);

      expect(hitRate).toBeGreaterThan(0.99); // >99% hit rate
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
      // Mock large result set
      const largeResults = Array(10000).fill(null).map((_, i) => ({
        id: i,
        name: `Record ${i}`,
        data: 'x'.repeat(100),
      }));

      mockBQ.generateMockResults = () => largeResults;

      const result = await client.query({
        query: 'SELECT * FROM large_table',
      });

      expect(result.rows.length).toBe(10000);
    });
  });

  describe('Retry Performance', () => {
    it('should handle retries with minimal overhead', async () => {
      let attemptCount = 0;
      const originalCreateQueryJob = mockBQ.createQueryJob.bind(mockBQ);

      mockBQ.createQueryJob = jest.fn().mockImplementation((options) => {
        attemptCount++;
        if (attemptCount === 1) {
          const error = new Error('Temporary error');
          (error as any).code = 'RATE_LIMIT_EXCEEDED';
          throw error;
        }
        return originalCreateQueryJob(options);
      });

      const start = Date.now();
      await client.query({
        query: 'SELECT 1',
        maxRetries: 3,
      });
      const duration = Date.now() - start;

      expect(attemptCount).toBe(2);
      // Even with retry, should complete quickly
      expect(duration).toBeLessThan(2000);
    });

    it('should exponentially backoff retries', async () => {
      const retryTimings: number[] = [];
      let lastTime = Date.now();

      mockBQ.createQueryJob = jest.fn().mockImplementation(() => {
        const now = Date.now();
        if (retryTimings.length > 0) {
          retryTimings.push(now - lastTime);
        }
        lastTime = now;

        if (retryTimings.length < 3) {
          const error = new Error('Retry error');
          (error as any).code = 'RATE_LIMIT_EXCEEDED';
          throw error;
        }

        return Promise.resolve([{
          id: 'job-id',
          getQueryResults: () => Promise.resolve([[], {}, {}]),
          getMetadata: () => Promise.resolve([{
            statistics: { query: {} },
            configuration: { query: { destinationTable: { schema: { fields: [] } } } },
          }]),
        }]);
      });

      await client.query({
        query: 'SELECT 1',
        maxRetries: 5,
      });

      // Each retry should take longer (exponential backoff)
      expect(retryTimings[1]).toBeGreaterThan(retryTimings[0]);
      expect(retryTimings[2]).toBeGreaterThan(retryTimings[1]);
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
    }, 20000);

    it('should handle mixed operations under load', async () => {
      const operations = [];

      for (let i = 0; i < 50; i++) {
        operations.push(client.query({ query: `SELECT ${i}` }));
        operations.push(client.listDatasets());
        operations.push(client.listTables('test_dataset'));
        operations.push(client.getTable('test_dataset', 'test_table'));
      }

      const results = await Promise.all(operations);
      expect(results).toHaveLength(200);
    }, 20000);
  });
});

describePerf('Benchmark Tests', () => {
  it('should measure query execution time', async () => {
    const mockBQ = createMockBigQuery();
    const BigQueryMock = jest.mocked(BigQuery);
    BigQueryMock.mockImplementation(() => mockBQ as any);

    const client = new BigQueryClient({ projectId: 'test-project' });

    const measurements = [];

    for (let i = 0; i < 10; i++) {
      const start = performance.now();
      await client.query({ query: 'SELECT 1' });
      measurements.push(performance.now() - start);
    }

    const avg = measurements.reduce((a, b) => a + b, 0) / measurements.length;
    const min = Math.min(...measurements);
    const max = Math.max(...measurements);

    console.log(`Query Performance:
      Average: ${avg.toFixed(2)}ms
      Min: ${min.toFixed(2)}ms
      Max: ${max.toFixed(2)}ms
    `);

    expect(avg).toBeLessThan(100);

    await client.shutdown();
  });

  it('should measure cache performance', async () => {
    const mockBQ = createMockBigQuery();
    const BigQueryMock = jest.mocked(BigQuery);
    BigQueryMock.mockImplementation(() => mockBQ as any);

    const client = new BigQueryClient({ projectId: 'test-project' });

    // Cache miss
    const start1 = performance.now();
    await client.getDataset('test_dataset');
    const missDuration = performance.now() - start1;

    // Cache hit
    const start2 = performance.now();
    await client.getDataset('test_dataset');
    const hitDuration = performance.now() - start2;

    const improvement = ((missDuration - hitDuration) / missDuration) * 100;

    console.log(`Cache Performance:
      Cache Miss: ${missDuration.toFixed(2)}ms
      Cache Hit: ${hitDuration.toFixed(2)}ms
      Improvement: ${improvement.toFixed(1)}%
    `);

    expect(hitDuration).toBeLessThan(missDuration);

    await client.shutdown();
  });
});
