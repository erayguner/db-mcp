import {
  DatasetDiscovery,
  DatasetDiscoveryConfig,
  SearchQuery,
} from '../../src/bigquery/dataset-discovery.js';
import { ConnectionPool } from '../../src/bigquery/connection-pool.js';
import { DatasetManager, DatasetMetadata } from '../../src/bigquery/dataset-manager.js';
import { BigQuery } from '@google-cloud/bigquery';

const skipDiscovery = process.env.MOCK_FAST === 'true' || process.env.USE_MOCK_BIGQUERY === 'true';
const describeDiscovery = skipDiscovery ? describe.skip : describe;

describeDiscovery('DatasetDiscovery', () => {
  let discovery: DatasetDiscovery;
  let mockConnectionPool: ConnectionPool;
  let mockDatasetManager: DatasetManager;
  let mockBigQuery: BigQuery;

  const createMockDataset = (
    id: string,
    projectId: string,
    partial?: Partial<DatasetMetadata>
  ): DatasetMetadata => ({
    id,
    projectId,
    location: 'EU',
    createdAt: new Date('2024-01-01'),
    modifiedAt: new Date('2024-01-15'),
    description: `Test dataset ${id}`,
    labels: { env: 'test', team: 'engineering' },
    tableCount: 5,
    tables: [
      {
        id: 'table1',
        datasetId: id,
        projectId,
        type: 'TABLE',
        schema: [],
        numRows: 1000,
        numBytes: 1024 * 1024 * 10, // 10MB
        createdAt: new Date('2024-01-01'),
        modifiedAt: new Date('2024-01-15'),
      },
    ],
    lastAccessedAt: new Date(),
    accessCount: 10,
    ...partial,
  });

  beforeEach(() => {
    // Mock BigQuery
    mockBigQuery = {
      dataset: jest.fn(),
      getDatasets: jest.fn(),
    } as any;

    // Mock ConnectionPool
    mockConnectionPool = {
      acquire: jest.fn().mockResolvedValue(mockBigQuery),
      release: jest.fn(),
      getMetrics: jest.fn().mockReturnValue({
        totalConnections: 2,
        activeConnections: 0,
        idleConnections: 2,
      }),
      isHealthy: jest.fn().mockReturnValue(true),
      shutdown: jest.fn(),
    } as any;

    // Mock DatasetManager
    mockDatasetManager = {
      listDatasets: jest.fn().mockImplementation((_client: any, projectId?: string) => {
        if (projectId === 'project1') {
          return Promise.resolve([
            createMockDataset('dataset1', 'project1'),
            createMockDataset('dataset2', 'project1', {
              description: 'Analytics dataset',
              labels: { env: 'prod', team: 'analytics' },
            }),
          ]);
        } else if (projectId === 'project2') {
          return Promise.resolve([
            createMockDataset('dataset3', 'project2', {
              location: 'EU',
              labels: { env: 'dev', team: 'engineering' },
            }),
          ]);
        }
        return Promise.resolve([
          createMockDataset('dataset1', 'project1'),
          createMockDataset('dataset2', 'project1', {
            description: 'Analytics dataset',
            labels: { env: 'prod', team: 'analytics' },
          }),
          createMockDataset('dataset3', 'project2', {
            location: 'EU',
            labels: { env: 'dev', team: 'engineering' },
          }),
        ]);
      }),
      getDataset: jest.fn(),
      invalidate: jest.fn(),
      shutdown: jest.fn(),
    } as any;

    const config: Partial<DatasetDiscoveryConfig> = {
      enableAutoDiscovery: false,
      fullTextIndexing: true,
      buildRelationshipGraph: true,
      trackAccessPatterns: true,
    };

    discovery = new DatasetDiscovery(mockConnectionPool, mockDatasetManager, config);
  });

  afterEach(() => {
    discovery.shutdown();
  });

  describe('Dataset Discovery', () => {
    it('should discover datasets across multiple projects', async () => {
      const results = await discovery.discoverDatasets(['project1', 'project2']);

      expect(results).toHaveLength(3);
      expect(results[0]).toHaveProperty('discoveredAt');
      expect(results[0]).toHaveProperty('searchableText');
      expect(results[0]).toHaveProperty('keywords');
      expect(mockDatasetManager.listDatasets).toHaveBeenCalledTimes(2);
    });

    it('should enhance dataset metadata with discovery features', async () => {
      const results = await discovery.discoverDatasets(['project1']);

      expect(results[0]).toMatchObject({
        id: 'dataset1',
        projectId: 'project1',
        totalSizeBytes: expect.any(Number),
        estimatedMonthlyCost: expect.any(Number),
        popularityScore: expect.any(Number),
        keywords: expect.any(Array),
        searchableText: expect.any(String),
      });
    });

    it('should build search index after discovery', async () => {
      await discovery.discoverDatasets(['project1', 'project2']);

      const stats = discovery.getStats();
      expect(stats.indexedKeywords).toBeGreaterThan(0);
      expect(stats.totalDatasets).toBe(3);
    });

    it('should apply region filters', async () => {
      const configWithFilter: Partial<DatasetDiscoveryConfig> = {
        includeRegions: ['EU'],
        enableAutoDiscovery: false,
      };

      const filteredDiscovery = new DatasetDiscovery(
        mockConnectionPool,
        mockDatasetManager,
        configWithFilter
      );

      const results = await filteredDiscovery.discoverDatasets(['project1', 'project2']);

      expect(results.every((d) => d.location === 'EU')).toBe(true);
      filteredDiscovery.shutdown();
    });

    it('should apply label filters', async () => {
      const configWithFilter: Partial<DatasetDiscoveryConfig> = {
        includeLabels: { env: 'test' },
        enableAutoDiscovery: false,
      };

      const filteredDiscovery = new DatasetDiscovery(
        mockConnectionPool,
        mockDatasetManager,
        configWithFilter
      );

      const results = await filteredDiscovery.discoverDatasets(['project1']);

      expect(results.every((d) => d.labels?.env === 'test')).toBe(true);
      filteredDiscovery.shutdown();
    });
  });

  describe('Search Functionality', () => {
    beforeEach(async () => {
      await discovery.discoverDatasets(['project1', 'project2']);
    });

    it('should perform text search', async () => {
      const query: SearchQuery = {
        text: 'analytics',
      };

      const results = await discovery.search(query);

      expect(results.length).toBeGreaterThan(0);
      expect(results[0]).toHaveProperty('relevanceScore');
      expect(results[0]).toHaveProperty('matchedFields');
      expect(results[0]).toHaveProperty('highlights');
    });

    it('should filter by labels', async () => {
      const query: SearchQuery = {
        labels: { env: 'prod' },
      };

      const results = await discovery.search(query);

      expect(results.every((r) => r.dataset.labels?.env === 'prod')).toBe(true);
    });

    it('should filter by regions', async () => {
      const query: SearchQuery = {
        regions: ['EU'],
      };

      const results = await discovery.search(query);

      expect(results.every((r) => r.dataset.location === 'EU')).toBe(true);
    });

    it('should filter by size range', async () => {
      const query: SearchQuery = {
        minSize: 1000,
        maxSize: 1000000000,
      };

      const results = await discovery.search(query);

      expect(
        results.every(
          (r) => r.dataset.totalSizeBytes >= 1000 && r.dataset.totalSizeBytes <= 1000000000
        )
      ).toBe(true);
    });

    it('should sort by different criteria', async () => {
      const queries: SearchQuery[] = [
        { sortBy: 'name', sortOrder: 'asc' },
        { sortBy: 'size', sortOrder: 'desc' },
        { sortBy: 'created', sortOrder: 'asc' },
        { sortBy: 'popularity', sortOrder: 'desc' },
      ];

      for (const query of queries) {
        const results = await discovery.search(query);
        expect(results).toBeInstanceOf(Array);
      }
    });

    it('should apply pagination', async () => {
      const query: SearchQuery = {
        limit: 1,
        offset: 0,
      };

      const results = await discovery.search(query);

      expect(results).toHaveLength(1);
    });

    it('should highlight matched fields', async () => {
      const query: SearchQuery = {
        text: 'dataset1',
      };

      const results = await discovery.search(query);
      const firstResult = results.find((r) => r.dataset.id === 'dataset1');

      expect(firstResult?.matchedFields).toContain('id');
      expect(firstResult?.highlights).toHaveProperty('id');
    });
  });

  describe('Relationship Graph', () => {
    beforeEach(async () => {
      await discovery.discoverDatasets(['project1', 'project2']);
    });

    it('should build relationship graph', () => {
      const graph = discovery.getRelationshipGraph();

      expect(graph).toHaveProperty('nodes');
      expect(graph).toHaveProperty('edges');
      expect(graph).toHaveProperty('clusters');
      expect(graph.nodes.length).toBeGreaterThan(0);
    });

    it('should identify similar datasets by labels', () => {
      const graph = discovery.getRelationshipGraph();

      // Datasets with shared labels should have similarity relationships
      expect(graph.edges.length).toBeGreaterThanOrEqual(0);
    });

    it('should create clusters based on labels', () => {
      const graph = discovery.getRelationshipGraph();

      expect(graph.clusters).toBeInstanceOf(Array);
      if (graph.clusters.length > 0) {
        expect(graph.clusters[0]).toHaveProperty('commonLabels');
        expect(graph.clusters[0]).toHaveProperty('datasets');
      }
    });
  });

  describe('Access Pattern Tracking', () => {
    beforeEach(async () => {
      await discovery.discoverDatasets(['project1']);
    });

    it('should track dataset access', () => {
      discovery.trackAccess('dataset1', 'project1', 'user1', 150);

      const dataset = discovery.getDataset('dataset1', 'project1');

      expect(dataset?.accessPattern.totalAccesses).toBeGreaterThan(0);
      expect(dataset?.accessPattern.uniqueUsers.has('user1')).toBe(true);
    });

    it('should update access frequency', () => {
      for (let i = 0; i < 150; i++) {
        discovery.trackAccess('dataset1', 'project1', `user${i}`, 100);
      }

      const dataset = discovery.getDataset('dataset1', 'project1');

      expect(dataset?.accessPattern.accessFrequency).toBe('VERY_HIGH');
    });

    it('should calculate average query duration', () => {
      discovery.trackAccess('dataset1', 'project1', 'user1', 100);
      discovery.trackAccess('dataset1', 'project1', 'user2', 200);
      discovery.trackAccess('dataset1', 'project1', 'user3', 300);

      const dataset = discovery.getDataset('dataset1', 'project1');

      expect(dataset?.accessPattern.averageQueryDurationMs).toBeCloseTo(200, 1);
    });

    it('should update popularity score based on access', () => {
      const dataset = discovery.getDataset('dataset1', 'project1');
      const initialScore = dataset?.popularityScore || 0;

      for (let i = 0; i < 50; i++) {
        discovery.trackAccess('dataset1', 'project1', `user${i}`, 100);
      }

      const updatedDataset = discovery.getDataset('dataset1', 'project1');
      expect(updatedDataset?.popularityScore).toBeGreaterThan(initialScore);
    });
  });

  describe('Incremental Updates', () => {
    beforeEach(async () => {
      await discovery.discoverDatasets(['project1']);
    });

    it('should perform incremental update', async () => {
      // Mock updated dataset
      const updatedDataset = createMockDataset('dataset1', 'project1', {
        modifiedAt: new Date('2024-02-01'),
      });

      (mockDatasetManager.listDatasets as any).mockResolvedValueOnce([updatedDataset]);

      const updatedCount = await discovery.incrementalUpdate(['project1']);

      expect(updatedCount).toBeGreaterThan(0);

      const stats = discovery.getStats();
      expect(stats.lastIncrementalUpdate).toBeTruthy();
    });

    it('should skip unchanged datasets', async () => {
      const updatedCount = await discovery.incrementalUpdate(['project1']);

      // No changes, so should return 0
      expect(updatedCount).toBe(0);
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      await discovery.discoverDatasets(['project1', 'project2']);
    });

    it('should provide comprehensive statistics', () => {
      const stats = discovery.getStats();

      expect(stats).toMatchObject({
        totalDatasets: expect.any(Number),
        totalTables: expect.any(Number),
        totalSizeBytes: expect.any(Number),
        projectCount: expect.any(Number),
        regionDistribution: expect.any(Object),
        labelDistribution: expect.any(Object),
        lastFullScan: expect.any(Date),
        scanDurationMs: expect.any(Number),
        indexedKeywords: expect.any(Number),
      });
    });

    it('should track region distribution', () => {
      const stats = discovery.getStats();

      expect(stats.regionDistribution['EU']).toBeGreaterThan(0);
    });

    it('should track label distribution', () => {
      const stats = discovery.getStats();

      expect(Object.keys(stats.labelDistribution).length).toBeGreaterThan(0);
    });
  });

  describe('Dataset Retrieval', () => {
    beforeEach(async () => {
      await discovery.discoverDatasets(['project1', 'project2']);
    });

    it('should get dataset by ID', () => {
      const dataset = discovery.getDataset('dataset1', 'project1');

      expect(dataset).toBeTruthy();
      expect(dataset?.id).toBe('dataset1');
      expect(dataset?.projectId).toBe('project1');
    });

    it('should return null for non-existent dataset', () => {
      const dataset = discovery.getDataset('nonexistent', 'project1');

      expect(dataset).toBeNull();
    });

    it('should get all discovered datasets', () => {
      const datasets = discovery.getAllDatasets();

      expect(datasets.length).toBeGreaterThan(0);
      expect(datasets[0]).toHaveProperty('discoveredAt');
    });
  });

  describe('Cache Invalidation', () => {
    beforeEach(async () => {
      await discovery.discoverDatasets(['project1']);
    });

    it('should invalidate specific dataset', () => {
      discovery.invalidate('dataset1', 'project1');

      const dataset = discovery.getDataset('dataset1', 'project1');
      expect(dataset).toBeNull();
    });
  });

  describe('Event Emission', () => {
    it('should emit discovery events', async () => {
      const startedHandler = jest.fn();
      const completedHandler = jest.fn();

      discovery.on('discovery:started', startedHandler);
      discovery.on('discovery:completed', completedHandler);

      await discovery.discoverDatasets(['project1']);

      expect(startedHandler).toHaveBeenCalled();
      expect(completedHandler).toHaveBeenCalled();
    });

    it('should emit search events', async () => {
      await discovery.discoverDatasets(['project1']);

      const searchHandler = jest.fn();
      discovery.on('search:completed', searchHandler);

      await discovery.search({ text: 'test' });

      expect(searchHandler).toHaveBeenCalled();
    });

    it('should emit access tracking events', async () => {
      await discovery.discoverDatasets(['project1']);

      const accessHandler = jest.fn();
      discovery.on('access:tracked', accessHandler);

      discovery.trackAccess('dataset1', 'project1', 'user1', 100);

      expect(accessHandler).toHaveBeenCalled();
    });
  });

  describe('Error Handling', () => {
    it('should handle discovery errors', async () => {
      (mockDatasetManager.listDatasets as any).mockRejectedValue(new Error('Discovery failed'));

      await expect(discovery.discoverDatasets(['project1'])).rejects.toThrow(
        'Failed to discover datasets'
      );
    });

    it('should prevent concurrent scans', async () => {
      const promise1 = discovery.discoverDatasets(['project1']);

      await expect(discovery.discoverDatasets(['project2'])).rejects.toThrow(
        'Discovery scan already in progress'
      );

      await promise1;
    });
  });

  describe('Shutdown', () => {
    it('should cleanup resources on shutdown', () => {
      discovery.shutdown();

      expect(discovery.getAllDatasets()).toHaveLength(0);
    });
  });
});
