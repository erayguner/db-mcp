/**
 * Performance Benchmarks
 *
 * Correctness assertions (row counts, completion of every queued operation,
 * validation verdicts) run on every `npm test`. Pure wall-clock budgets go
 * through `expectTiming` and are enforced only under `npm run test:performance`
 * — see tests/helpers/perf-timing.ts for the rationale.
 */

import { BigQuery } from '@google-cloud/bigquery';
import { BigQueryClient } from '../../src/bigquery/client.js';
import { SecurityMiddleware } from '../../src/security/middleware.js';
import { expectTiming } from '../helpers/perf-timing.js';

/**
 * Force every pooled BigQuery connection to return `rows` for the next query.
 *
 * The pool builds its own `new BigQuery(...)` instances (see
 * ConnectionPool.createConnection), and the module under test resolves
 * '@google-cloud/bigquery' to the shared mock in __mocks__/ — which Jest
 * applies automatically for node_modules packages. There is therefore no
 * instance to hand a local mock to; the only seam that reaches every pooled
 * connection is the prototype.
 */
function stubQueryRows(rows: unknown[]): jest.SpyInstance {
  const job = {
    id: 'job-123',
    getQueryResults: () => Promise.resolve([rows, {}, {}]),
    getMetadata: () => Promise.resolve([{ statistics: { query: {} } }]),
  };

  return jest
    .spyOn(BigQuery.prototype, 'createQueryJob')
    .mockImplementation((() => Promise.resolve([job])) as never);
}

describe('Performance Benchmarks', () => {
  describe('Query Performance', () => {
    let client: BigQueryClient;

    beforeEach(() => {
      client = new BigQueryClient({
        projectId: 'test-project',
        location: 'EU',
      });
    });

    afterEach(async () => {
      jest.restoreAllMocks();
      await client.shutdown();
    });

    it('should execute simple query in <100ms', async () => {
      // Arrange
      const sql = 'SELECT * FROM dataset.table LIMIT 10';

      // Act
      const startTime = performance.now();
      const result = await client.query({ query: sql });
      const duration = performance.now() - startTime;

      // Assert — correctness: the query actually round-tripped
      expect(result.jobId).toBeDefined();
      expect(Array.isArray(result.rows)).toBe(true);
      expect(result.totalRows).toBe(result.rows.length);

      // Assert — budget
      expectTiming(duration, 'simple query').toBeLessThan(100);
    });

    it('should handle 100 sequential queries efficiently', async () => {
      // Arrange
      const sql = 'SELECT * FROM dataset.table LIMIT 1';

      // Act
      const startTime = performance.now();
      const results = [];
      for (let i = 0; i < 100; i++) {
        results.push(await client.query({ query: sql }));
      }
      const duration = performance.now() - startTime;

      // Assert — correctness: every query completed
      expect(results).toHaveLength(100);
      expect(results.every((r) => r.jobId !== undefined)).toBe(true);

      // Assert — budget
      expectTiming(duration, '100 sequential queries').toBeLessThan(5000);
    });

    it('should process large result sets efficiently', async () => {
      // Arrange
      const largeResults = Array(10000)
        .fill(null)
        .map((_, i) => ({
          id: i,
          data: `data-${i}`,
        }));
      stubQueryRows(largeResults);

      // Act
      const startTime = performance.now();
      const results = await client.query({ query: 'SELECT * FROM large_table' });
      const duration = performance.now() - startTime;

      // Assert — correctness: all 10k rows survive the client layer
      expect(results.rows).toHaveLength(10000);
      expect(results.totalRows).toBe(10000);
      expect(results.rows[9999]).toEqual({ id: 9999, data: 'data-9999' });

      // Assert — budget
      expectTiming(duration, 'large result set (10k rows)').toBeLessThan(1000);
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
      const result = await security.validateRequest(request);
      const duration = performance.now() - startTime;

      // Assert — correctness: a benign request is allowed
      expect(result.allowed).toBe(true);

      // Assert — budget
      expectTiming(duration, 'security validation').toBeLessThan(10);
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
      const results = await Promise.all(requests.map((req) => security.validateRequest(req)));
      const duration = performance.now() - startTime;

      // Assert — correctness: every validation produced a verdict
      expect(results).toHaveLength(1000);
      expect(results.every((r) => typeof r.allowed === 'boolean')).toBe(true);

      // Assert — budget
      expectTiming(duration, '1000 security validations').toBeLessThan(5000);
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
      const safeResult = await security.validateRequest(safeRequest);
      const safeDuration = performance.now() - safeStart;

      const maliciousStart = performance.now();
      const maliciousResult = await security.validateRequest(maliciousRequest);
      const maliciousDuration = performance.now() - maliciousStart;

      // Assert — correctness: the detection actually fires
      expect(safeResult.allowed).toBe(true);
      expect(maliciousResult.allowed).toBe(false);

      // Assert — budget: malicious detection should not be significantly slower
      const overhead = maliciousDuration - safeDuration;
      expectTiming(overhead, 'injection detection overhead').toBeLessThan(50);
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
    });

    it('should handle rate limiter cleanup efficiently', () => {
      // Arrange
      const security = new SecurityMiddleware({
        rateLimitWindowMs: 100, // Short window for testing
      });

      const initialMemory = process.memoryUsage().heapUsed;

      // Act - Create many rate limit entries
      const verdicts = [];
      for (let i = 0; i < 1000; i++) {
        verdicts.push(security.getRateLimiter().checkRateLimit(`user-${i}`));
      }

      // Assert - correctness: distinct users are each admitted
      expect(verdicts).toHaveLength(1000);
      expect(verdicts.every((v) => v.allowed)).toBe(true);

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

      const queries = Array(50).fill('SELECT * FROM dataset.table');

      // Act
      const startTime = performance.now();
      const results = await Promise.all(queries.map((q) => client.query({ query: q })));
      const duration = performance.now() - startTime;

      // Assert — correctness: all 50 resolved, no deadlock on the pool
      expect(results).toHaveLength(50);
      expect(results.every((r) => r.jobId !== undefined)).toBe(true);

      // Assert — budget
      expectTiming(duration, '50 concurrent queries').toBeLessThan(2000);

      await client.shutdown();
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
      const results = await Promise.all(
        Array(100)
          .fill(null)
          .map((_, i) => operations[i % operations.length]())
      );
      const duration = performance.now() - startTime;

      // Assert — correctness: every operation produced a verdict
      expect(results).toHaveLength(100);
      expect(results.every((r) => typeof r.allowed === 'boolean')).toBe(true);

      // Assert — budget
      expectTiming(duration, '100 mixed operations').toBeLessThan(3000);
    });
  });
});
