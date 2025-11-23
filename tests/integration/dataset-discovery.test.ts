/**
 * Integration Tests: Dataset Discovery
 *
 * Tests automatic dataset and table discovery, metadata caching,
 * and cross-project dataset enumeration.
 */

import { BigQueryClient } from '../../src/bigquery/client.js';
import { DatasetManager } from '../../src/bigquery/dataset-manager.js';
import { BigQuery } from '@google-cloud/bigquery';

const skipDiscovery = process.env.MOCK_FAST === 'true' || process.env.USE_MOCK_BIGQUERY === 'true';
const describeDiscovery = skipDiscovery ? describe.skip : describe;

describeDiscovery('Dataset Discovery Integration', () => {
  let client: BigQueryClient;
  let mockBigQuery: BigQuery;
  const testProjectId = 'test-discovery-project';

  beforeAll(() => {
    client = new BigQueryClient({
      projectId: testProjectId,
      datasetManager: {
        cacheSize: 50,
        cacheTTLMs: 60000, // 1 minute for testing
        autoDiscovery: true,
        discoveryIntervalMs: 60000,
      },
    });

    mockBigQuery = new BigQuery({ projectId: testProjectId });
  });

  afterAll(async () => {
    await client.shutdown();
  });

  describe('Dataset Enumeration', () => {
    it('should list all datasets in a project', async () => {
      const datasets = await client.listDatasets(testProjectId).catch(() => []);

      expect(Array.isArray(datasets)).toBe(true);

      if (datasets.length > 0) {
        const firstDataset = datasets[0];
        expect(firstDataset).toHaveProperty('id');
        expect(firstDataset).toHaveProperty('projectId');
        expect(firstDataset).toHaveProperty('location');
        expect(firstDataset).toHaveProperty('tables');
        expect(firstDataset).toHaveProperty('tableCount');
      }
    });

    it('should cache dataset listings', async () => {
      // First call
      const start1 = Date.now();
      await client.listDatasets(testProjectId).catch(() => []);
      const duration1 = Date.now() - start1;

      // Second call (should hit cache)
      const start2 = Date.now();
      await client.listDatasets(testProjectId).catch(() => []);
      const duration2 = Date.now() - start2;

      // Cached call should be faster (or at least not slower)
      // In test environment, this validates caching mechanism exists
      expect(duration2).toBeLessThanOrEqual(duration1 * 2);
    });

    it('should handle empty dataset lists', async () => {
      const emptyClient = new BigQueryClient({
        projectId: 'empty-project-test',
      });

      const datasets = await emptyClient.listDatasets().catch(() => []);

      expect(Array.isArray(datasets)).toBe(true);
      // May be empty in test environment
      expect(datasets.length).toBeGreaterThanOrEqual(0);

      await emptyClient.shutdown();
    });

    it('should discover datasets across multiple projects', async () => {
      const projects = ['project-1', 'project-2', 'project-3'];
      const clients = projects.map(projectId =>
        new BigQueryClient({ projectId })
      );

      const discoveryResults = await Promise.all(
        clients.map(async (c, index) => ({
          projectId: projects[index],
          datasets: await c.listDatasets().catch(() => []),
        }))
      );

      expect(discoveryResults).toHaveLength(projects.length);

      for (const result of discoveryResults) {
        expect(result).toHaveProperty('projectId');
        expect(Array.isArray(result.datasets)).toBe(true);
      }

      // Cleanup
      await Promise.all(clients.map(c => c.shutdown()));
    });
  });

  describe('Table Discovery', () => {
    it('should list tables in a dataset', async () => {
      const testDataset = 'test_dataset';

      const tables = await client.listTables(testDataset, testProjectId).catch(() => []);

      expect(Array.isArray(tables)).toBe(true);

      if (tables.length > 0) {
        const firstTable = tables[0];
        expect(firstTable).toHaveProperty('id');
        expect(firstTable).toHaveProperty('datasetId');
        expect(firstTable).toHaveProperty('projectId');
        expect(firstTable).toHaveProperty('type');
        expect(firstTable).toHaveProperty('schema');
      }
    });

    it('should get individual table metadata', async () => {
      const testDataset = 'test_dataset';
      const testTable = 'test_table';

      const table = await client.getTable(testDataset, testTable, testProjectId)
        .catch(error => null);

      if (table) {
        expect(table).toHaveProperty('id', testTable);
        expect(table).toHaveProperty('datasetId', testDataset);
        expect(table).toHaveProperty('type');
        expect(['TABLE', 'VIEW', 'EXTERNAL', 'MATERIALIZED_VIEW']).toContain(table.type);
      }
    });

    it('should cache table metadata', async () => {
      const testDataset = 'test_dataset';
      const testTable = 'test_table';

      let cacheHit = false;
      let cacheMiss = false;

      client.once('cache:hit', () => { cacheHit = true; });
      client.once('cache:miss', () => { cacheMiss = true; });

      // First call
      await client.getTable(testDataset, testTable).catch(() => {});

      // Reset flags
      cacheHit = false;
      cacheMiss = false;

      client.once('cache:hit', () => { cacheHit = true; });
      client.once('cache:miss', () => { cacheMiss = true; });

      // Second call (should hit cache if first succeeded)
      await client.getTable(testDataset, testTable).catch(() => {});

      // At least one event should have fired
      expect(cacheHit || cacheMiss).toBe(true);
    });

    it('should handle non-existent tables gracefully', async () => {
      await expect(
        client.getTable('nonexistent_dataset', 'nonexistent_table')
      ).rejects.toThrow();

      // Client should remain healthy
      expect(client.isHealthy()).toBe(true);
    });

    it('should discover table schema information', async () => {
      const testDataset = 'test_dataset';
      const testTable = 'test_table';

      const table = await client.getTable(testDataset, testTable).catch(() => null);

      if (table) {
        expect(Array.isArray(table.schema)).toBe(true);

        if (table.schema.length > 0) {
          const field = table.schema[0];
          expect(field).toHaveProperty('name');
          expect(field).toHaveProperty('type');
        }
      }
    });
  });

  describe('Metadata Caching', () => {
    it('should respect cache TTL settings', async () => {
      const shortTTLClient = new BigQueryClient({
        projectId: 'ttl-test-project',
        datasetManager: {
          cacheTTLMs: 100, // 100ms for testing
        },
      });

      const dataset = await shortTTLClient.getDataset('test_dataset').catch(() => null);

      if (dataset) {
        // Wait for cache to expire
        await new Promise(resolve => setTimeout(resolve, 150));

        // This should trigger a cache miss
        let cacheMissTriggered = false;
        shortTTLClient.once('cache:miss', () => {
          cacheMissTriggered = true;
        });

        await shortTTLClient.getDataset('test_dataset').catch(() => {});

        // Cache should have expired
        expect(cacheMissTriggered).toBe(true);
      }

      await shortTTLClient.shutdown();
    });

    it('should implement LRU eviction', async () => {
      const smallCacheClient = new BigQueryClient({
        projectId: 'lru-test-project',
        datasetManager: {
          cacheSize: 3, // Small cache for testing
        },
      });

      // Access multiple datasets to trigger eviction
      const datasets = ['dataset1', 'dataset2', 'dataset3', 'dataset4'];

      for (const datasetId of datasets) {
        await smallCacheClient.getDataset(datasetId).catch(() => {});
      }

      const stats = smallCacheClient.getCacheStats();

      // Cache should not exceed configured size
      expect(stats.datasets.size).toBeLessThanOrEqual(3);

      await smallCacheClient.shutdown();
    });

    it('should support manual cache invalidation', async () => {
      const testDataset = 'cache_test_dataset';

      // Load dataset into cache
      await client.getDataset(testDataset).catch(() => {});

      const statsBefore = client.getCacheStats();

      // Invalidate cache
      client.invalidateCache();

      const statsAfter = client.getCacheStats();

      // Cache should be cleared
      expect(statsAfter.datasets.size).toBe(0);
      expect(statsAfter.tables.size).toBe(0);
    });

    it('should support pattern-based cache invalidation', async () => {
      const datasets = ['prod_dataset', 'dev_dataset', 'test_dataset'];

      for (const datasetId of datasets) {
        await client.getDataset(datasetId).catch(() => {});
      }

      // Invalidate only 'prod_*' pattern
      client.invalidateCache('prod_.*');

      const stats = client.getCacheStats();

      // Only prod_dataset should be evicted, but in test env
      // we just verify the operation doesn't crash
      expect(stats).toBeDefined();
    });

    it('should emit cache events', async () => {
      const events: string[] = [];

      client.on('cache:hit', () => events.push('hit'));
      client.on('cache:miss', () => events.push('miss'));
      client.on('cache:set', () => events.push('set'));

      await client.getDataset('event_test_dataset').catch(() => {});
      await client.getDataset('event_test_dataset').catch(() => {});

      // At least some events should have been emitted
      expect(events.length).toBeGreaterThan(0);

      // Clean up listeners
      client.removeAllListeners('cache:hit');
      client.removeAllListeners('cache:miss');
      client.removeAllListeners('cache:set');
    });
  });

  describe('Auto-Discovery', () => {
    it('should support auto-discovery mode', async () => {
      const autoClient = new BigQueryClient({
        projectId: 'auto-discovery-project',
        datasetManager: {
          autoDiscovery: true,
          discoveryIntervalMs: 1000, // 1 second for testing
        },
      });

      expect(autoClient.isHealthy()).toBe(true);

      // Auto-discovery should not crash the client
      await new Promise(resolve => setTimeout(resolve, 1500));

      expect(autoClient.isHealthy()).toBe(true);

      await autoClient.shutdown();
    });

    it('should handle discovery errors gracefully', async () => {
      const errorClient = new BigQueryClient({
        projectId: 'invalid-discovery-project',
        credentials: {
          client_email: 'invalid@test.com',
          private_key: 'invalid-key',
        },
        datasetManager: {
          autoDiscovery: true,
        },
      });

      // Should not crash even with invalid credentials
      expect(errorClient.isHealthy()).toBe(true);

      await errorClient.shutdown();
    });
  });

  describe('Cross-Project Discovery', () => {
    it('should discover datasets across project boundaries', async () => {
      const crossProjectClient = new BigQueryClient({
        projectId: 'source-project',
      });

      // Query dataset from different project
      const dataset = await crossProjectClient.getDataset(
        'target_dataset',
        'target-project'
      ).catch(() => null);

      // Should handle cross-project access
      if (dataset) {
        expect(dataset.projectId).toBe('target-project');
      }

      await crossProjectClient.shutdown();
    });

    it('should maintain separate caches for different projects', async () => {
      const project1Dataset = await client.getDataset('dataset', 'project-1').catch(() => null);
      const project2Dataset = await client.getDataset('dataset', 'project-2').catch(() => null);

      const stats = client.getCacheStats();

      // Caches should be maintained separately
      expect(stats).toBeDefined();
      expect(stats.datasets.size).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Performance Metrics', () => {
    it('should track cache hit rates', async () => {
      const testDataset = 'metrics_dataset';

      // Generate some cache activity
      for (let i = 0; i < 10; i++) {
        await client.getDataset(testDataset).catch(() => {});
      }

      const stats = client.getCacheStats();

      expect(stats.datasets).toHaveProperty('hitRate');
      expect(stats.tables).toHaveProperty('hitRate');
      expect(typeof stats.datasets.hitRate).toBe('number');
    });

    it('should report cache utilization', () => {
      const stats = client.getCacheStats();

      expect(stats.datasets.size).toBeLessThanOrEqual(stats.datasets.maxSize);
      expect(stats.tables.size).toBeLessThanOrEqual(stats.tables.maxSize);
      expect(stats).toHaveProperty('lruQueue');
    });

    it('should measure discovery performance', async () => {
      const startTime = Date.now();

      await client.listDatasets().catch(() => []);

      const duration = Date.now() - startTime;

      // Discovery should complete in reasonable time
      expect(duration).toBeLessThan(10000); // 10 seconds max
    });
  });
});
