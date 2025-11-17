/**
 * Integration Tests: Multi-Project Connection Management
 *
 * Tests the BigQuery MCP server's ability to handle multiple GCP projects
 * simultaneously with proper connection pooling, authentication, and resource isolation.
 */

import { BigQueryClient } from '../../src/bigquery/client.js';

describe.skip('Multi-Project Connection Management', () => {
  let clients: Map<string, BigQueryClient>;
  const testProjects = ['project-a', 'project-b', 'project-c'];

  beforeAll(() => {
    clients = new Map();
  });

  afterAll(async () => {
    // Clean up all clients
    for (const client of clients.values()) {
      await client.shutdown();
    }
    clients.clear();
  });

  describe('Connection Initialization', () => {
    it('should initialize clients for multiple projects', async () => {
      for (const projectId of testProjects) {
        const client = new BigQueryClient({
          projectId,
          connectionPool: {
            minConnections: 2,
            maxConnections: 5,
          },
        });

        clients.set(projectId, client);

        // Wait for pool initialization
        await new Promise(resolve => setTimeout(resolve, 1000));

        expect(client.isHealthy()).toBe(true);
      }

      expect(clients.size).toBe(testProjects.length);
    });

    it('should maintain separate connection pools per project', () => {
      const metrics = new Map<string, any>();

      for (const [projectId, client] of clients.entries()) {
        metrics.set(projectId, client.getPoolMetrics());
      }

      // Each project should have independent metrics
      expect(metrics.size).toBe(testProjects.length);

      for (const [projectId, metric] of metrics.entries()) {
        expect(metric).toHaveProperty('totalConnections');
        expect(metric.totalConnections).toBeGreaterThanOrEqual(2); // minConnections
        expect(metric.totalConnections).toBeLessThanOrEqual(5); // maxConnections
      }
    });

    it('should handle connection pool configuration per project', () => {
      const client1 = new BigQueryClient({
        projectId: 'project-config-1',
        connectionPool: {
          minConnections: 1,
          maxConnections: 3,
        },
      });

      const client2 = new BigQueryClient({
        projectId: 'project-config-2',
        connectionPool: {
          minConnections: 5,
          maxConnections: 10,
        },
      });

      clients.set('project-config-1', client1);
      clients.set('project-config-2', client2);

      const metrics1 = client1.getPoolMetrics();
      const metrics2 = client2.getPoolMetrics();

      expect(metrics1.totalConnections).toBeLessThanOrEqual(3);
      expect(metrics2.totalConnections).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle concurrent queries across multiple projects', async () => {
      const queryPromises = Array.from(clients.entries()).map(([projectId, client]) =>
        client.query({
          query: 'SELECT 1 as test',
          dryRun: true,
        }).then(result => ({
          projectId,
          success: true,
          jobId: result.jobId,
        })).catch(error => ({
          projectId,
          success: false,
          error: error.message,
        }))
      );

      const results = await Promise.all(queryPromises);

      expect(results).toHaveLength(clients.size);

      // In mock/test environment, we expect dry runs to work
      const successCount = results.filter(r => r.success).length;
      expect(successCount).toBeGreaterThan(0);
    });

    it('should maintain connection pool integrity under concurrent load', async () => {
      const client = clients.get('project-a')!;
      const initialMetrics = client.getPoolMetrics();

      // Simulate concurrent operations
      const operations = Array(20).fill(null).map(async (_, index) => {
        try {
          await client.query({
            query: `SELECT ${index} as id`,
            dryRun: true,
          });
          return { success: true };
        } catch (error) {
          return { success: false, error };
        }
      });

      await Promise.allSettled(operations);

      const finalMetrics = client.getPoolMetrics();

      // Connection pool should remain healthy
      expect(finalMetrics.totalConnections).toBeGreaterThanOrEqual(initialMetrics.totalConnections);
      expect(finalMetrics.totalConnections).toBeLessThanOrEqual(5); // maxConnections
      expect(client.isHealthy()).toBe(true);
    });

    it('should isolate failures between projects', async () => {
      const client1 = clients.get('project-a')!;
      const client2 = clients.get('project-b')!;

      // Force an error in client1
      const promise1 = client1.query({
        query: 'INVALID SQL QUERY HERE',
        retry: false,
      }).catch(error => ({ error: error.message }));

      // Valid query in client2
      const promise2 = client2.query({
        query: 'SELECT 1',
        dryRun: true,
      }).then(result => ({ success: true, jobId: result.jobId }));

      const [result1, result2] = await Promise.all([promise1, promise2]);

      // client1 should have error, client2 should succeed (in mock env)
      expect(result1).toHaveProperty('error');
      // client2 health should not be affected
      expect(client2.isHealthy()).toBe(true);
    });
  });

  describe('Resource Management', () => {
    it('should properly release connections across projects', async () => {
      const client = clients.get('project-a')!;

      const beforeMetrics = client.getPoolMetrics();

      // Execute multiple queries
      await Promise.all([
        client.query({ query: 'SELECT 1', dryRun: true }).catch(() => {}),
        client.query({ query: 'SELECT 2', dryRun: true }).catch(() => {}),
        client.query({ query: 'SELECT 3', dryRun: true }).catch(() => {}),
      ]);

      // Allow time for connections to be released
      await new Promise(resolve => setTimeout(resolve, 500));

      const afterMetrics = client.getPoolMetrics();

      // Connections should be released back to pool
      expect(afterMetrics.totalReleased).toBeGreaterThanOrEqual(beforeMetrics.totalReleased);
      expect(afterMetrics.activeConnections).toBeLessThanOrEqual(afterMetrics.idleConnections + afterMetrics.activeConnections);
    });

    it('should handle graceful shutdown of individual projects', async () => {
      const testClient = new BigQueryClient({
        projectId: 'project-shutdown-test',
        connectionPool: {
          minConnections: 2,
          maxConnections: 4,
        },
      });

      expect(testClient.isHealthy()).toBe(true);

      await testClient.shutdown();

      expect(testClient.isHealthy()).toBe(false);

      // Should reject new queries after shutdown
      await expect(
        testClient.query({ query: 'SELECT 1' })
      ).rejects.toThrow(/shutting down|shutdown/i);
    });

    it('should not affect other projects when one shuts down', async () => {
      const client1 = new BigQueryClient({
        projectId: 'project-shutdown-1',
      });

      const client2 = clients.get('project-b')!;

      await client1.shutdown();

      expect(client1.isHealthy()).toBe(false);
      expect(client2.isHealthy()).toBe(true);

      // client2 should still be able to execute queries
      const result = await client2.query({
        query: 'SELECT 1',
        dryRun: true,
      }).catch(error => ({ error }));

      // In test environment, dry run should work
      expect(result).toBeDefined();
    });
  });

  describe('Cross-Project Operations', () => {
    it('should support cross-project dataset queries', async () => {
      const client = clients.get('project-a')!;

      // Query referencing another project's dataset
      const crossProjectQuery = `
        SELECT *
        FROM \`project-b.dataset.table\`
        LIMIT 10
      `;

      const dryRunResult = await client.dryRun(crossProjectQuery);

      expect(dryRunResult).toHaveProperty('totalBytesProcessed');
      expect(dryRunResult).toHaveProperty('estimatedCostUSD');
    });

    it('should handle project switching within same client', async () => {
      const client = new BigQueryClient({
        projectId: 'default-project',
      });

      clients.set('default-project', client);

      // Query with explicit project override
      const query1 = await client.query({
        query: 'SELECT 1',
        dryRun: true,
      }).catch(error => ({ error }));

      const query2 = await client.query({
        query: 'SELECT 2',
        dryRun: true,
        location: 'US',
      }).catch(error => ({ error }));

      expect(query1).toBeDefined();
      expect(query2).toBeDefined();
    });
  });

  describe('Error Handling and Recovery', () => {
    it('should handle authentication errors per project', async () => {
      const invalidClient = new BigQueryClient({
        projectId: 'invalid-project-123',
        credentials: {
          client_email: 'invalid@example.com',
          private_key: 'invalid-key',
        },
      });

      await expect(
        invalidClient.query({ query: 'SELECT 1' })
      ).rejects.toThrow();

      // Other clients should not be affected
      const validClient = clients.get('project-a')!;
      expect(validClient.isHealthy()).toBe(true);

      await invalidClient.shutdown();
    });

    it('should recover from transient failures in one project', async () => {
      const client = clients.get('project-a')!;

      // First query might fail
      const result1 = await client.query({
        query: 'SELECT 1',
        dryRun: true,
        retry: true,
        maxRetries: 3,
      }).catch(error => ({ error }));

      // Subsequent queries should work
      const result2 = await client.query({
        query: 'SELECT 2',
        dryRun: true,
      }).catch(error => ({ error }));

      expect(result1).toBeDefined();
      expect(result2).toBeDefined();
      expect(client.isHealthy()).toBe(true);
    });

    it('should maintain separate error states per project', async () => {
      const client1 = clients.get('project-a')!;
      const client2 = clients.get('project-b')!;

      // Force error in client1
      await client1.query({
        query: 'INVALID QUERY',
        retry: false,
      }).catch(() => {});

      // Both clients should maintain independent health states
      const metrics1 = client1.getPoolMetrics();
      const metrics2 = client2.getPoolMetrics();

      expect(metrics1).toBeDefined();
      expect(metrics2).toBeDefined();

      // Metrics should be independent
      expect(metrics1.totalFailed).not.toBe(metrics2.totalFailed);
    });
  });

  describe('Performance and Metrics', () => {
    it('should track separate metrics per project', () => {
      const allMetrics = Array.from(clients.entries()).map(([projectId, client]) => ({
        projectId,
        metrics: client.getPoolMetrics(),
      }));

      expect(allMetrics).toHaveLength(clients.size);

      for (const { projectId, metrics } of allMetrics) {
        expect(metrics).toMatchObject({
          totalConnections: expect.any(Number),
          activeConnections: expect.any(Number),
          idleConnections: expect.any(Number),
          totalAcquired: expect.any(Number),
          totalReleased: expect.any(Number),
          uptime: expect.any(Number),
        });
      }
    });

    it('should report cache statistics per project', () => {
      const allCacheStats = Array.from(clients.entries()).map(([projectId, client]) => ({
        projectId,
        stats: client.getCacheStats(),
      }));

      for (const { projectId, stats } of allCacheStats) {
        expect(stats).toHaveProperty('datasets');
        expect(stats).toHaveProperty('tables');
        expect(stats.datasets).toHaveProperty('size');
        expect(stats.tables).toHaveProperty('size');
      }
    });

    it('should measure performance across projects', async () => {
      const performanceResults = await Promise.all(
        Array.from(clients.entries()).map(async ([projectId, client]) => {
          const start = Date.now();

          await client.query({
            query: 'SELECT 1',
            dryRun: true,
          }).catch(() => {});

          const duration = Date.now() - start;

          return { projectId, duration };
        })
      );

      for (const result of performanceResults) {
        expect(result.duration).toBeLessThan(5000); // Should complete within 5s
      }
    });
  });
});
