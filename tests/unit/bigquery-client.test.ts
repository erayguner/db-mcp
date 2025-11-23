/**
 * Unit Tests - BigQuery Client
 */

import { BigQueryClient, BigQueryClientConfig } from '../../src/bigquery/client.js';
import { BigQuery } from '@google-cloud/bigquery';

const skipClient = process.env.MOCK_FAST === 'true' || process.env.USE_MOCK_BIGQUERY === 'true';
const describeClient = skipClient ? describe.skip : describe;

// Mock the BigQuery SDK
jest.mock('@google-cloud/bigquery');
jest.mock('../../src/bigquery/connection-pool.js');
jest.mock('../../src/bigquery/dataset-manager.js');

describeClient('BigQueryClient', () => {
  let client: BigQueryClient;
  let mockBQClient: any;
  let mockJob: any;
  let mockConnectionPool: any;
  let mockDatasetManager: any;

  beforeEach(() => {
    // Mock BigQuery client
    mockJob = {
      id: 'job-123',
      getQueryResults: jest.fn(),
      getMetadata: jest.fn(),
    };

    mockBQClient = {
      createQueryJob: jest.fn(),
      dataset: jest.fn(),
      getDatasets: jest.fn(),
    };

    (BigQuery as jest.MockedClass<typeof BigQuery>).mockImplementation(() => mockBQClient);

    // Mock connection pool
    mockConnectionPool = {
      acquire: jest.fn().mockResolvedValue(mockBQClient),
      release: jest.fn(),
      shutdown: jest.fn(),
      getMetrics: jest.fn().mockReturnValue({}),
      isHealthy: jest.fn().mockReturnValue(true),
    };

    // Mock dataset manager
    mockDatasetManager = {
      getDataset: jest.fn(),
      getTable: jest.fn(),
      listDatasets: jest.fn(),
      listTables: jest.fn(),
      shutdown: jest.fn(),
      on: jest.fn(),
      getStats: jest.fn().mockReturnValue({}),
      getCacheStats: jest.fn().mockReturnValue({
        datasets: { size: 10, maxSize: 100, hitRate: 0.85 },
        tables: { size: 50, maxSize: 500, hitRate: 0.92 },
      }),
    };

    // Create client with minimal config
    const config: BigQueryClientConfig = {
      projectId: 'test-project',
      queryDefaults: {
        useLegacySql: false,
        location: 'US',
      },
      datasetManager: {
        cacheSize: 100,
        cacheTTLMs: 300000,
        autoDiscovery: false,
        discoveryIntervalMs: 300000,
      },
    };

    client = new BigQueryClient(config);

    // Replace internal dependencies with mocks
    (client as any).connectionPool = mockConnectionPool;
    (client as any).datasetManager = mockDatasetManager;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with valid config', () => {
      const newClient = new BigQueryClient({
        projectId: 'my-project',
        queryDefaults: {
          useLegacySql: false,
          location: 'EU',
        },
      });

      expect(newClient).toBeDefined();
      expect(newClient).toBeInstanceOf(BigQueryClient);
    });

    it('should use default values for optional config', () => {
      const newClient = new BigQueryClient({
        projectId: 'test-project',
      });

      expect(newClient).toBeDefined();
    });

    it('should validate config with Zod schema', () => {
      expect(() => {
        new BigQueryClient({} as any);
      }).not.toThrow(); // Schema has defaults
    });
  });

  describe('query', () => {
    it('should execute query successfully', async () => {
      // Arrange
      const queryOptions = {
        query: 'SELECT * FROM dataset.table LIMIT 10',
        maxResults: 100,
      };

      const mockRows = [
        { id: 1, name: 'Alice' },
        { id: 2, name: 'Bob' },
      ];

      mockJob.getQueryResults.mockResolvedValue([mockRows]);
      mockJob.getMetadata.mockResolvedValue([{
        statistics: {
          query: {
            totalBytesProcessed: '50000',
            cacheHit: false,
          },
        },
      }]);
      mockBQClient.createQueryJob.mockResolvedValue([mockJob]);

      // Act
      const result = await client.query(queryOptions);

      // Assert
      expect(mockConnectionPool.acquire).toHaveBeenCalled();
      expect(mockBQClient.createQueryJob).toHaveBeenCalledWith(
        expect.objectContaining({
          query: queryOptions.query,
        })
      );
      expect(result.rows).toEqual(mockRows);
      expect(result.totalRows).toBe(2);
      expect(result.jobId).toBe('job-123');
      expect(mockConnectionPool.release).toHaveBeenCalledWith(mockBQClient);
    });

    it('should handle query with parameters', async () => {
      const queryOptions = {
        query: 'SELECT * FROM dataset.table WHERE id = @id',
        params: { id: 123 },
      };

      const mockRows = [{ id: 123, name: 'Test' }];
      mockJob.getQueryResults.mockResolvedValue([mockRows]);
      mockJob.getMetadata.mockResolvedValue([{ statistics: { query: {} } }]);
      mockBQClient.createQueryJob.mockResolvedValue([mockJob]);

      const result = await client.query(queryOptions);

      expect(result.rows).toEqual(mockRows);
      expect(mockBQClient.createQueryJob).toHaveBeenCalledWith(
        expect.objectContaining({
          params: { id: 123 },
        })
      );
    });

    it('should handle query errors', async () => {
      const error = new Error('Query failed');
      mockBQClient.createQueryJob.mockRejectedValue(error);

      await expect(
        client.query({ query: 'INVALID SQL' })
      ).rejects.toThrow();
    });

    it('should return empty results for empty query', async () => {
      mockJob.getQueryResults.mockResolvedValue([[]]);
      mockJob.getMetadata.mockResolvedValue([{ statistics: { query: {} } }]);
      mockBQClient.createQueryJob.mockResolvedValue([mockJob]);

      const result = await client.query({ query: 'SELECT * FROM dataset.table WHERE 1=0' });

      expect(result.rows).toEqual([]);
      expect(result.totalRows).toBe(0);
    });

    it('should include cache hit information', async () => {
      mockJob.getQueryResults.mockResolvedValue([[{ id: 1 }]]);
      mockJob.getMetadata.mockResolvedValue([{
        statistics: {
          query: {
            cacheHit: true,
            totalBytesProcessed: '0',
          },
        },
      }]);
      mockBQClient.createQueryJob.mockResolvedValue([mockJob]);

      const result = await client.query({ query: 'SELECT 1' });

      expect(result.cacheHit).toBe(true);
      expect(result.totalBytesProcessed).toBe('0');
    });
  });

  describe('dryRun', () => {
    it('should estimate query cost', async () => {
      mockJob.getMetadata.mockResolvedValue([{
        statistics: {
          query: {
            totalBytesProcessed: '1250000000000', // 1.25 TB
          },
        },
      }]);
      mockBQClient.createQueryJob.mockResolvedValue([mockJob]);

      const result = await client.dryRun('SELECT * FROM large_table');

      expect(typeof result.totalBytesProcessed).toBe('string');
      expect(typeof result.estimatedCostUSD).toBe('number');
      expect(mockBQClient.createQueryJob).toHaveBeenCalledWith(
        expect.objectContaining({
          dryRun: true,
        })
      );
    });

    it('should calculate cost for large query', async () => {
      mockJob.getMetadata.mockResolvedValue([{
        statistics: {
          query: {
            totalBytesProcessed: '5497558138880', // ~5 TB
          },
        },
      }]);
      mockBQClient.createQueryJob.mockResolvedValue([mockJob]);

      const result = await client.dryRun('SELECT * FROM huge_table');

      expect(result.estimatedCostUSD).toBeGreaterThan(0);
    });

    it('should return zero cost for cached query', async () => {
      mockJob.getMetadata.mockResolvedValue([{
        statistics: {
          query: {
            totalBytesProcessed: '0',
            cacheHit: true,
          },
        },
      }]);
      mockBQClient.createQueryJob.mockResolvedValue([mockJob]);

      const result = await client.dryRun('SELECT 1');

      expect(result.estimatedCostUSD).toBe(0);
    });
  });

  describe('listDatasets', () => {
    it('should list datasets successfully', async () => {
      const mockDatasets = [
        {
          id: 'dataset1',
          projectId: 'test-project',
          location: 'US',
          createdAt: new Date(),
          modifiedAt: new Date(),
          tableCount: 5,
          tables: [],
          lastAccessedAt: new Date(),
          accessCount: 0,
        },
      ];

      mockDatasetManager.listDatasets.mockResolvedValue(mockDatasets);

      const datasets = await client.listDatasets();

      expect(datasets).toEqual(mockDatasets);
      expect(mockDatasetManager.listDatasets).toHaveBeenCalled();
    });

    it('should handle empty dataset list', async () => {
      mockDatasetManager.listDatasets.mockResolvedValue([]);

      const datasets = await client.listDatasets();

      expect(datasets).toEqual([]);
    });

    it('should handle list datasets error', async () => {
      const error = new Error('Access denied');
      mockDatasetManager.listDatasets.mockRejectedValue(error);

      await expect(client.listDatasets()).rejects.toThrow('Access denied');
    });
  });

  describe('listTables', () => {
    it('should list tables in a dataset', async () => {
      const mockTables = [
        {
          id: 'table1',
          datasetId: 'my_dataset',
          projectId: 'test-project',
          type: 'TABLE' as const,
          schema: [],
          createdAt: new Date(),
          modifiedAt: new Date(),
        },
      ];

      mockDatasetManager.listTables.mockResolvedValue(mockTables);

      const tables = await client.listTables('my_dataset');

      expect(tables).toEqual(mockTables);
      expect(mockDatasetManager.listTables).toHaveBeenCalledWith(mockBQClient, 'my_dataset', undefined);
    });
  });

  describe('getTable', () => {
    it('should get table metadata', async () => {
      const mockTable = {
        id: 'my_table',
        datasetId: 'my_dataset',
        projectId: 'test-project',
        type: 'TABLE' as const,
        schema: [
          { name: 'id', type: 'INTEGER', mode: 'REQUIRED' },
          { name: 'name', type: 'STRING', mode: 'NULLABLE' },
        ],
        createdAt: new Date('2024-01-01'),
        modifiedAt: new Date('2024-01-02'),
        numRows: 1000,
        numBytes: 50000,
      };

      mockDatasetManager.getTable.mockResolvedValue(mockTable);

      const table = await client.getTable('my_dataset', 'my_table');

      expect(table).toEqual(mockTable);
      expect(mockDatasetManager.getTable).toHaveBeenCalledWith(mockBQClient, 'my_dataset', 'my_table', undefined);
    });

    it('should handle table not found error', async () => {
      const error = new Error('Table not found');
      mockDatasetManager.getTable.mockRejectedValue(error);

      await expect(
        client.getTable('my_dataset', 'nonexistent_table')
      ).rejects.toThrow('Table not found');
    });
  });

  describe('health checks', () => {
    it('should return healthy status', () => {
      expect(client.isHealthy()).toBe(true);
    });

    it('should return unhealthy during shutdown', async () => {
      (client as any).isShuttingDown = true;

      expect(client.isHealthy()).toBe(false);
    });

    it('should test connection successfully', async () => {
      mockJob.getQueryResults.mockResolvedValue([[{ result: 1 }]]);
      mockJob.getMetadata.mockResolvedValue([{ statistics: { query: {} } }]);
      mockBQClient.createQueryJob.mockResolvedValue([mockJob]);

      const result = await client.testConnection();

      expect(result).toBe(true);
      expect(mockBQClient.createQueryJob).toHaveBeenCalledWith(
        expect.objectContaining({
          query: 'SELECT 1',
        })
      );
    });
  });

  describe('metrics', () => {
    it('should return pool metrics', () => {
      const mockMetrics = {
        totalConnections: 5,
        activeConnections: 2,
        idleConnections: 3,
      };

      mockConnectionPool.getMetrics.mockReturnValue(mockMetrics);

      const metrics = client.getPoolMetrics();

      expect(metrics).toEqual(mockMetrics);
    });

    it('should return cache stats', () => {
      const mockStats = {
        datasets: { size: 10, maxSize: 100, hitRate: 0.85 },
        tables: { size: 50, maxSize: 500, hitRate: 0.92 },
      };

      mockDatasetManager.getStats.mockReturnValue(mockStats);

      const stats = client.getCacheStats();

      expect(stats).toEqual(mockStats);
    });
  });

  describe('shutdown', () => {
    it('should shutdown gracefully', async () => {
      await client.shutdown();

      expect(mockConnectionPool.shutdown).toHaveBeenCalled();
      expect(mockDatasetManager.shutdown).toHaveBeenCalled();
    });

    it('should reject queries after shutdown', async () => {
      await client.shutdown();

      await expect(
        client.query({ query: 'SELECT 1' })
      ).rejects.toThrow('shutting down');
    });
  });
});
