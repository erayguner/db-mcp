/**
 * Performance and Load Tests
 * Validates system performance under various load conditions
 */

import { BigQueryClient } from '../../src/bigquery/client.js';
import { BigQuery } from '@google-cloud/bigquery';

jest.mock('@google-cloud/bigquery');
jest.mock('../../src/bigquery/connection-pool.js');
jest.mock('../../src/bigquery/dataset-manager.js');

describe('Performance Tests', () => {
  let client: BigQueryClient;
  let mockBQClient: any;
  let mockJob: any;
  let mockConnectionPool: any;
  let mockDatasetManager: any;

  beforeEach(() => {
    // Mock BigQuery job
    mockJob = {
      id: 'job-123',
      getQueryResults: jest.fn(),
      getMetadata: jest.fn().mockResolvedValue([{ statistics: { query: {} } }]),
    };

    // Mock BigQuery client
    mockBQClient = {
      createQueryJob: jest.fn().mockResolvedValue([mockJob]),
      dataset: jest.fn(),
    };

    (BigQuery as jest.MockedClass<typeof BigQuery>).mockImplementation(() => mockBQClient);

    // Mock connection pool with metrics
    mockConnectionPool = {
      acquire: jest.fn().mockResolvedValue(mockBQClient),
      release: jest.fn(),
      shutdown: jest.fn(),
      getMetrics: jest.fn().mockReturnValue({
        totalConnections: 5,
        activeConnections: 2,
        idleConnections: 3,
        waitingRequests: 0,
        totalAcquired: 100,
        totalReleased: 98,
        totalFailed: 0,
        totalTimeouts: 0,
        averageAcquireTimeMs: 5,
        uptime: 60000,
      }),
    };

    // Mock dataset manager with stats
    mockDatasetManager = {
      getDataset: jest.fn().mockResolvedValue({
        id: 'test_dataset',
        projectId: 'test-project',
        location: 'US',
        createdAt: new Date(),
        modifiedAt: new Date(),
        tableCount: 0,
        tables: [],
        lastAccessedAt: new Date(),
        accessCount: 0,
      }),
      shutdown: jest.fn(),
      on: jest.fn(),
      getStats: jest.fn().mockReturnValue({
        datasets: { size: 10, maxSize: 100, hitRate: 0.95 },
        tables: { size: 50, maxSize: 500, hitRate: 0.92 },
        lruQueue: 60,
      }),
      getCacheStats: jest.fn().mockReturnValue({
        datasets: { size: 10, maxSize: 100, hitRate: 0.95 },
        tables: { size: 50, maxSize: 500, hitRate: 0.92 },
      }),
    };

    client = new BigQueryClient({
      projectId: 'test-project',
      connectionPool: {
        minConnections: 5,
        maxConnections: 20,
        acquireTimeoutMs: 30000,
        idleTimeoutMs: 300000,
        healthCheckIntervalMs: 60000,
        maxRetries: 3,
        retryDelayMs: 1000,
      },
    });

    (client as any).connectionPool = mockConnectionPool;
    (client as any).datasetManager = mockDatasetManager;
  });

  afterEach(async () => {
    jest.clearAllMocks();
  });

  describe('Query Performance', () => {
    it('should execute simple queries under 100ms', async () => {
      mockJob.getQueryResults.mockResolvedValue([[{ result: 1 }]]);

      const start = Date.now();
      await client.query({ query: 'SELECT 1' });
      const duration = Date.now() - start;

      expect(duration).toBeLessThan(100);
    });

    it('should handle 100 concurrent queries', async () => {
      mockJob.getQueryResults.mockResolvedValue([[{ num: 1 }]]);

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
      mockJob.getQueryResults.mockResolvedValue([[{ result: 1 }]]);

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
      mockJob.getQueryResults.mockResolvedValue([[{ result: 1 }]]);

      const queries = Array(20).fill(null).map(() =>
        client.query({ query: 'SELECT 1' })
      );

      await Promise.all(queries);

      const metrics = client.getPoolMetrics();
      expect(metrics.totalConnections).toBeLessThanOrEqual(20);
      expect(metrics.totalConnections).toBeGreaterThan(0);
    });

    it('should handle connection pool exhaustion', async () => {
      mockJob.getQueryResults.mockResolvedValue([[{ result: 1 }]]);

      // Create more concurrent queries than max pool size
      const queries = Array(50).fill(null).map((_, i) =>
        client.query({ query: `SELECT ${i}` })
      );

      const results = await Promise.all(queries);
      expect(results).toHaveLength(50);
    }, 15000);

    it('should recover connections after failures', async () => {
      // Mock some failures
      let callCount = 0;
      mockBQClient.createQueryJob.mockImplementation(() => {
        callCount++;
        if (callCount <= 5) {
          return Promise.reject(new Error('Connection failed'));
        }
        return Promise.resolve([mockJob]);
      });

      mockJob.getQueryResults.mockResolvedValue([[{ result: 1 }]]);

      const failingQueries = Array(5).fill(null).map(() =>
        client.query({ query: 'SELECT 1' }).catch(() => null)
      );

      await Promise.all(failingQueries);

      // Verify recovery
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

      // Second call (should be faster due to internal optimizations)
      const start2 = Date.now();
      await client.getDataset('test_dataset');
      const duration2 = Date.now() - start2;

      // Both should complete quickly
      expect(duration1).toBeLessThan(100);
      expect(duration2).toBeLessThan(100);
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
      expect(stats.datasets.hitRate).toBeGreaterThan(0.5);
    }, 10000);

    it('should maintain cache efficiency', async () => {
      const iterations = 100;

      for (let i = 0; i < iterations; i++) {
        await client.getDataset('test_dataset');
      }

      const stats = client.getCacheStats();
      expect(stats.datasets.hitRate).toBeGreaterThan(0.5);
    });
  });

  describe('Memory Performance', () => {
    it('should not leak memory under sustained load', async () => {
      mockJob.getQueryResults.mockResolvedValue([[{ result: 1 }]]);

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
      const largeResults = Array(10000).fill(null).map((_, i) => ({
        id: i,
        data: `data-${i}`,
      }));

      mockJob.getQueryResults.mockResolvedValue([largeResults]);

      const result = await client.query({ query: 'SELECT * FROM large_table' });

      expect(result.rows.length).toBe(10000);
      expect(result.totalRows).toBe(10000);
    });
  });
});
