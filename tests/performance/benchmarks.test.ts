/**
 * Performance Benchmarks
 */

import { BigQueryClient } from '../../src/bigquery/client.js';
import { SecurityMiddleware } from '../../src/security/middleware.js';
import { createMockBigQueryClient } from '../fixtures/mocks.js';

const skipPerf = process.env.MOCK_FAST === 'true' || process.env.USE_MOCK_BIGQUERY === 'true';
const describePerf = skipPerf ? describe.skip : describe;

describePerf('Performance Benchmarks', () => {
  describe('Query Performance', () => {
    let client: BigQueryClient;
    let mockBQClient: ReturnType<typeof createMockBigQueryClient>;

    beforeEach(() => {
      mockBQClient = createMockBigQueryClient();
      client = new BigQueryClient({
        projectId: 'test-project',
        location: 'EU',
      });
      (client as any).client = mockBQClient;
    });

    it('should execute simple query in <100ms', async () => {
      // Arrange
      const sql = 'SELECT * FROM dataset.table LIMIT 10';
      const mockJob = {
        id: 'job-123',
        getQueryResults: jest.fn().mockResolvedValue([[]]),
      };
      mockBQClient.createQueryJob.mockResolvedValue([mockJob as any]);

      // Act
      const startTime = performance.now();
      await client.query(sql);
      const duration = performance.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(100);
    });

    it('should handle 100 sequential queries efficiently', async () => {
      // Arrange
      const sql = 'SELECT * FROM dataset.table LIMIT 1';
      const mockJob = {
        id: 'job-123',
        getQueryResults: jest.fn().mockResolvedValue([[]]),
      };
      mockBQClient.createQueryJob.mockResolvedValue([mockJob as any]);

      // Act
      const startTime = performance.now();
      for (let i = 0; i < 100; i++) {
        await client.query(sql);
      }
      const duration = performance.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(5000); // <5s for 100 queries
      console.log(`100 sequential queries: ${duration.toFixed(2)}ms`);
    });

    it('should process large result sets efficiently', async () => {
      // Arrange
      const largeResults = Array(10000)
        .fill(null)
        .map((_, i) => ({
          id: i,
          data: `data-${i}`,
        }));

      const mockJob = {
        id: 'job-123',
        getQueryResults: jest.fn().mockResolvedValue([largeResults]),
      };
      mockBQClient.createQueryJob.mockResolvedValue([mockJob as any]);

      // Act
      const startTime = performance.now();
      const results = await client.query('SELECT * FROM large_table');
      const duration = performance.now() - startTime;

      // Assert
      expect((results as any).rows?.length ?? (results as any).length).toBe(10000);
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
        promptInjectionDetection: true,
        toolValidationEnabled: true,
      });
    });

    it('should validate requests in <10ms', async () => {
      // Arrange
      const request = {
        toolName: 'query_bigquery',
        userId: 'user-123',
        arguments: { query: 'SELECT * FROM dataset.table' },
      };

      // Act
      const startTime = performance.now();
      await security.validateRequest(request);
      const duration = performance.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(10);
      console.log(`Security validation: ${duration.toFixed(2)}ms`);
    });

    it('should handle 1000 validations efficiently', async () => {
      // Arrange
      const requests = Array(1000)
        .fill(null)
        .map((_, i) => ({
          toolName: 'list_datasets',
          userId: `user-${i % 100}`,
          arguments: {},
        }));

      // Act
      const startTime = performance.now();
      await Promise.all(requests.map((req) => security.validateRequest(req)));
      const duration = performance.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(5000); // <5s for 1000 validations
      console.log(`1000 security validations: ${duration.toFixed(2)}ms`);
    });

    it('should detect injections without significant overhead', async () => {
      // Arrange
      const safeRequest = {
        toolName: 'query_bigquery',
        userId: 'user-123',
        arguments: { query: 'SELECT * FROM dataset.table' },
      };

      const maliciousRequest = {
        toolName: 'query_bigquery',
        userId: 'user-123',
        arguments: { query: 'SELECT * FROM users; DROP TABLE users' },
      };

      // Act
      const safeStart = performance.now();
      await security.validateRequest(safeRequest);
      const safeDuration = performance.now() - safeStart;

      const maliciousStart = performance.now();
      await security.validateRequest(maliciousRequest);
      const maliciousDuration = performance.now() - maliciousStart;

      // Assert
      // Malicious detection should not be significantly slower
      const overhead = maliciousDuration - safeDuration;
      expect(overhead).toBeLessThan(50); // <50ms overhead
      console.log(`Injection detection overhead: ${overhead.toFixed(2)}ms`);
    });
  });

  describe('Memory Efficiency', () => {
    it('should not leak memory during operations', async () => {
      // Arrange
      const security = new SecurityMiddleware();
      const iterations = 1000;

      // Get initial memory
      const initialMemory = process.memoryUsage().heapUsed;

      // Act - Perform many operations
      for (let i = 0; i < iterations; i++) {
        await security.validateRequest({
          toolName: 'list_datasets',
          userId: `user-${i}`,
          arguments: {},
        });
      }

      // Force garbage collection if available
      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Assert - Memory increase should be minimal
      expect(memoryIncrease).toBeLessThan(10 * 1024 * 1024); // <10MB
      console.log(
        `Memory increase after ${iterations} operations: ${(memoryIncrease / 1024 / 1024).toFixed(2)}MB`
      );
    });

    it('should handle rate limiter cleanup efficiently', () => {
      // Arrange
      const security = new SecurityMiddleware({
        rateLimitWindowMs: 100, // Short window for testing
      });

      const initialMemory = process.memoryUsage().heapUsed;

      // Act - Create many rate limit entries
      for (let i = 0; i < 1000; i++) {
        security.getRateLimiter().checkRateLimit(`user-${i}`);
      }

      // Wait for cleanup
      jest.advanceTimersByTime(200);

      if (global.gc) {
        global.gc();
      }

      const finalMemory = process.memoryUsage().heapUsed;
      const memoryIncrease = finalMemory - initialMemory;

      // Assert
      expect(memoryIncrease).toBeLessThan(5 * 1024 * 1024); // <5MB
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent queries efficiently', async () => {
      // Arrange
      const client = new BigQueryClient({
        projectId: 'test-project',
      });
      const mockBQClient = createMockBigQueryClient();
      (client as any).client = mockBQClient;

      const mockJob = {
        id: 'job-123',
        getQueryResults: jest.fn().mockResolvedValue([[]]),
      };
      mockBQClient.createQueryJob.mockResolvedValue([mockJob as any]);

      const queries = Array(50).fill('SELECT * FROM dataset.table');

      // Act
      const startTime = performance.now();
      await Promise.all(queries.map((q) => client.query(q)));
      const duration = performance.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(2000); // <2s for 50 concurrent queries
      console.log(`50 concurrent queries: ${duration.toFixed(2)}ms`);
    });

    it('should maintain performance under mixed workload', async () => {
      // Arrange
      const security = new SecurityMiddleware();
      const operations = [
        () =>
          security.validateRequest({ toolName: 'list_datasets', userId: 'user-1', arguments: {} }),
        () =>
          security.validateRequest({
            toolName: 'query_bigquery',
            userId: 'user-2',
            arguments: { query: 'SELECT 1' },
          }),
        () => security.validateResponse({ data: 'test' }),
      ];

      // Act
      const startTime = performance.now();
      await Promise.all(
        Array(100)
          .fill(null)
          .map((_, i) => operations[i % operations.length]())
      );
      const duration = performance.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(3000); // <3s for 100 mixed operations
      console.log(`100 mixed operations: ${duration.toFixed(2)}ms`);
    });
  });
});
