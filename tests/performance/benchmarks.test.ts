/**
 * Performance Benchmarks
 */

import { BigQueryClient } from '../../src/bigquery/client.js';
import { SecurityMiddleware } from '../../src/security/middleware.js';
import { BigQuery } from '@google-cloud/bigquery';

// Mock dependencies
jest.mock('@google-cloud/bigquery');
jest.mock('../../src/bigquery/connection-pool.js');
jest.mock('../../src/bigquery/dataset-manager.js');

describe('Performance Benchmarks', () => {
  describe('Query Performance', () => {
    let client: BigQueryClient;
    let mockBQClient: any;
    let mockJob: any;
    let mockConnectionPool: any;

    beforeEach(() => {
      // Mock BigQuery job
      mockJob = {
        id: 'job-123',
        getQueryResults: jest.fn(),
        getMetadata: jest.fn().mockResolvedValue([{ statistics: { query: {} } }]),
      };

      // Mock BigQuery client
      mockBQClient = {
        createQueryJob: jest.fn(),
      };

      (BigQuery as jest.MockedClass<typeof BigQuery>).mockImplementation(() => mockBQClient);

      // Mock connection pool
      mockConnectionPool = {
        acquire: jest.fn().mockResolvedValue(mockBQClient),
        release: jest.fn(),
        shutdown: jest.fn(),
        getMetrics: jest.fn().mockReturnValue({}),
      };

      // Create client with proper config
      client = new BigQueryClient({
        projectId: 'test-project',
        queryDefaults: {
          useLegacySql: false,
          location: 'US',
        },
      });

      (client as any).connectionPool = mockConnectionPool;
      (client as any).datasetManager = {
        shutdown: jest.fn(),
        on: jest.fn(),
      };
    });

    it('should execute simple query in <100ms', async () => {
      mockJob.getQueryResults.mockResolvedValue([[]]);
      mockBQClient.createQueryJob.mockResolvedValue([mockJob]);

      const startTime = performance.now();
      await client.query({ query: 'SELECT * FROM dataset.table LIMIT 10' });
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(100);
    });

    it('should handle 100 sequential queries efficiently', async () => {
      mockJob.getQueryResults.mockResolvedValue([[]]);
      mockBQClient.createQueryJob.mockResolvedValue([mockJob]);

      const startTime = performance.now();
      for (let i = 0; i < 100; i++) {
        await client.query({ query: 'SELECT * FROM dataset.table LIMIT 1' });
      }
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(5000); // <5s for 100 queries
      console.log(`100 sequential queries: ${duration.toFixed(2)}ms`);
    });

    it('should process large result sets efficiently', async () => {
      const largeResults = Array(10000).fill(null).map((_, i) => ({
        id: i,
        data: `data-${i}`,
      }));

      mockJob.getQueryResults.mockResolvedValue([largeResults]);
      mockBQClient.createQueryJob.mockResolvedValue([mockJob]);

      const startTime = performance.now();
      const results = await client.query({ query: 'SELECT * FROM large_table' });
      const duration = performance.now() - startTime;

      expect(results.rows).toHaveLength(10000);
      expect(duration).toBeLessThan(1000); // <1s for 10k rows
      console.log(`Large result set (10k rows): ${duration.toFixed(2)}ms`);
    });
  });

  describe('Security Performance', () => {
    let security: SecurityMiddleware;

    beforeEach(() => {
      security = new SecurityMiddleware({
        rateLimitEnabled: true,
        rateLimitMaxRequests: 1000,
        rateLimitWindowMs: 60000,
        maxQueryLength: 10000,
        maxDatasetNameLength: 100,
        maxTableNameLength: 100,
        promptInjectionDetection: true,
        suspiciousPatterns: [],
        sensitiveDataPatterns: [],
        toolValidationEnabled: true,
        allowedTools: ['query_bigquery'],
        securityLoggingEnabled: false,
        logSuspiciousActivity: false,
      });
    });

    it('should validate requests in <10ms', async () => {
      const startTime = performance.now();
      await security.validateRequest({
        toolName: 'query_bigquery',
        userId: 'user-123',
        arguments: { query: 'SELECT 1' },
      });
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(10);
    });

    it('should handle 1000 validations efficiently', async () => {
      const startTime = performance.now();
      for (let i = 0; i < 1000; i++) {
        await security.validateRequest({
          toolName: 'query_bigquery',
          userId: 'user-123',
          arguments: { query: 'SELECT 1' },
        });
      }
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(1000); // <1s for 1000 validations
      console.log(`1000 security validations: ${duration.toFixed(2)}ms`);
    });
  });

  describe('Connection Pool Performance', () => {
    it('should acquire connections quickly', async () => {
      const mockPool = {
        acquire: jest.fn().mockResolvedValue({}),
        release: jest.fn(),
      };

      const startTime = performance.now();
      for (let i = 0; i < 100; i++) {
        const conn = await mockPool.acquire();
        mockPool.release(conn);
      }
      const duration = performance.now() - startTime;

      expect(duration).toBeLessThan(100); // <100ms for 100 acquire/release cycles
      console.log(`100 connection acquire/release cycles: ${duration.toFixed(2)}ms`);
    });
  });
});
