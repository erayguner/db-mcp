/**
 * Unit Tests - BigQuery Client
 */

import { BigQueryClient } from '../../src/bigquery/client.js';
import { createMockBigQueryClient } from '../fixtures/mocks.js';
import { mockQueryResults, mockJobMetadata } from '../fixtures/datasets.js';

const skipClient = process.env.MOCK_FAST === 'true' || process.env.USE_MOCK_BIGQUERY === 'true';
const describeClient = skipClient ? describe.skip : describe;

// Mock the BigQuery SDK
jest.mock('@google-cloud/bigquery');
jest.mock('google-auth-library');

describeClient('BigQueryClient', () => {
  let client: BigQueryClient;
  let mockBQClient: ReturnType<typeof createMockBigQueryClient>;

  beforeEach(() => {
    mockBQClient = createMockBigQueryClient();

    // Create client
    client = new BigQueryClient({
      projectId: 'test-project',
      location: 'US',
      maxRetries: 3,
      timeout: 60000,
    });

    // Replace internal client with mock
    (client as any).client = mockBQClient;
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('constructor', () => {
    it('should initialize with valid config', () => {
      // Arrange & Act
      const newClient = new BigQueryClient({
        projectId: 'my-project',
        location: 'EU',
      });

      // Assert
      expect(newClient).toBeDefined();
      expect(newClient.getClient()).toBeDefined();
    });

    it('should use default values', () => {
      // Arrange & Act
      const newClient = new BigQueryClient({
        projectId: 'test-project',
      });

      // Assert
      expect(newClient).toBeDefined();
    });

    it('should accept access token', () => {
      // Arrange & Act
      const newClient = new BigQueryClient(
        {
          projectId: 'test-project',
        },
        'mock-access-token'
      );

      // Assert
      expect(newClient).toBeDefined();
    });
  });

  describe('query', () => {
    it('should execute query successfully', async () => {
      // Arrange
      const sql = 'SELECT * FROM dataset.table LIMIT 10';
      const mockJob = {
        id: 'job-123',
        getQueryResults: jest.fn().mockResolvedValue([mockQueryResults]),
      };
      mockBQClient.createQueryJob.mockResolvedValue([mockJob as any]);

      // Act
      const results = await client.query(sql);

      // Assert
      expect(mockBQClient.createQueryJob).toHaveBeenCalledWith({
        query: sql,
        location: 'US',
        params: undefined,
      });
      expect(results).toEqual(mockQueryResults);
    });

    it('should execute query with parameters', async () => {
      // Arrange
      const sql = 'SELECT * FROM dataset.table WHERE id = ?';
      const params = ['123'];
      const mockJob = {
        id: 'job-123',
        getQueryResults: jest.fn().mockResolvedValue([[]]),
      };
      mockBQClient.createQueryJob.mockResolvedValue([mockJob as any]);

      // Act
      await client.query(sql, { parameters: params });

      // Assert
      expect(mockBQClient.createQueryJob).toHaveBeenCalledWith({
        query: sql,
        location: 'US',
        params,
      });
    });

    it('should handle query errors', async () => {
      // Arrange
      const sql = 'INVALID SQL';
      const error = new Error('Syntax error');
      mockBQClient.createQueryJob.mockRejectedValue(error);

      // Act & Assert
      await expect(client.query(sql)).rejects.toThrow('Syntax error');
    });

    it('should return empty array for no results', async () => {
      // Arrange
      const sql = 'SELECT * FROM dataset.table WHERE 1=0';
      const mockJob = {
        id: 'job-123',
        getQueryResults: jest.fn().mockResolvedValue([[]]),
      };
      mockBQClient.createQueryJob.mockResolvedValue([mockJob as any]);

      // Act
      const results = await client.query(sql);

      // Assert
      expect(results).toEqual([]);
    });
  });

  describe('dryRun', () => {
    it('should estimate query cost', async () => {
      // Arrange
      const sql = 'SELECT * FROM dataset.large_table';
      const mockJob = {
        metadata: mockJobMetadata,
      };
      mockBQClient.createQueryJob.mockResolvedValue([mockJob as any]);

      // Act
      const result = await client.dryRun(sql);

      // Assert
      expect(mockBQClient.createQueryJob).toHaveBeenCalledWith({
        query: sql,
        location: 'US',
        dryRun: true,
      });
      expect(result).toHaveProperty('totalBytesProcessed');
      expect(result).toHaveProperty('estimatedCost');
      expect(typeof result.estimatedCost).toBe('number');
    });

    it('should calculate cost correctly', async () => {
      // Arrange
      const sql = 'SELECT * FROM dataset.table';
      const bytesProcessed = '1000000000000'; // 1TB
      const mockJob = {
        metadata: {
          statistics: {
            query: {
              totalBytesProcessed: bytesProcessed,
            },
          },
        },
      };
      mockBQClient.createQueryJob.mockResolvedValue([mockJob as any]);

      // Act
      const result = await client.dryRun(sql);

      // Assert
      // 1TB * $6.25/TB = $6.25
      expect(result.estimatedCost).toBeCloseTo(6.25, 2);
    });

    it('should handle zero bytes processed', async () => {
      // Arrange
      const sql = 'SELECT 1';
      const mockJob = {
        metadata: {
          statistics: {
            query: {
              totalBytesProcessed: '0',
            },
          },
        },
      };
      mockBQClient.createQueryJob.mockResolvedValue([mockJob as any]);

      // Act
      const result = await client.dryRun(sql);

      // Assert
      expect(result.estimatedCost).toBe(0);
    });
  });

  describe('listDatasets', () => {
    it('should list datasets successfully', async () => {
      // Arrange
      const mockDatasets = [
        { id: 'dataset1' },
        { id: 'dataset2' },
        { id: 'dataset3' },
      ];
      mockBQClient.getDatasets.mockResolvedValue([mockDatasets as any]);

      // Act
      const datasets = await client.listDatasets();

      // Assert
      expect(datasets).toEqual(['dataset1', 'dataset2', 'dataset3']);
      expect(mockBQClient.getDatasets).toHaveBeenCalled();
    });

    it('should handle empty dataset list', async () => {
      // Arrange
      mockBQClient.getDatasets.mockResolvedValue([[]]);

      // Act
      const datasets = await client.listDatasets();

      // Assert
      expect(datasets).toEqual([]);
    });

    it('should handle API errors', async () => {
      // Arrange
      const error = new Error('Permission denied');
      mockBQClient.getDatasets.mockRejectedValue(error);

      // Act & Assert
      await expect(client.listDatasets()).rejects.toThrow('Permission denied');
    });
  });

  describe('listTables', () => {
    it('should list tables in dataset', async () => {
      // Arrange
      const datasetId = 'my_dataset';
      const mockTables = [
        { id: 'table1' },
        { id: 'table2' },
      ];
      const mockDataset = {
        getTables: jest.fn().mockResolvedValue([mockTables]),
      };
      mockBQClient.dataset.mockReturnValue(mockDataset as any);

      // Act
      const tables = await client.listTables(datasetId);

      // Assert
      expect(mockBQClient.dataset).toHaveBeenCalledWith(datasetId);
      expect(tables).toEqual(['table1', 'table2']);
    });

    it('should handle dataset not found', async () => {
      // Arrange
      const datasetId = 'nonexistent';
      const error = new Error('Dataset not found');
      const mockDataset = {
        getTables: jest.fn().mockRejectedValue(error),
      };
      mockBQClient.dataset.mockReturnValue(mockDataset as any);

      // Act & Assert
      await expect(client.listTables(datasetId)).rejects.toThrow('Dataset not found');
    });
  });

  describe('getTableSchema', () => {
    it('should get table schema', async () => {
      // Arrange
      const datasetId = 'my_dataset';
      const tableId = 'my_table';
      const mockSchema = {
        fields: [
          { name: 'id', type: 'STRING' },
          { name: 'name', type: 'STRING' },
        ],
      };
      const mockTable = {
        getMetadata: jest.fn().mockResolvedValue([{ schema: mockSchema }]),
      };
      const mockDataset = {
        table: jest.fn().mockReturnValue(mockTable),
      };
      mockBQClient.dataset.mockReturnValue(mockDataset as any);

      // Act
      const schema = await client.getTableSchema(datasetId, tableId);

      // Assert
      expect(mockBQClient.dataset).toHaveBeenCalledWith(datasetId);
      expect(mockDataset.table).toHaveBeenCalledWith(tableId);
      expect(schema).toEqual(mockSchema);
    });

    it('should handle table not found', async () => {
      // Arrange
      const datasetId = 'my_dataset';
      const tableId = 'nonexistent';
      const error = new Error('Table not found');
      const mockTable = {
        getMetadata: jest.fn().mockRejectedValue(error),
      };
      const mockDataset = {
        table: jest.fn().mockReturnValue(mockTable),
      };
      mockBQClient.dataset.mockReturnValue(mockDataset as any);

      // Act & Assert
      await expect(client.getTableSchema(datasetId, tableId)).rejects.toThrow('Table not found');
    });
  });

  describe('testConnection', () => {
    it('should return true for successful connection', async () => {
      // Arrange
      mockBQClient.getDatasets.mockResolvedValue([[]]);

      // Act
      const connected = await client.testConnection();

      // Assert
      expect(connected).toBe(true);
    });

    it('should return false for failed connection', async () => {
      // Arrange
      const error = new Error('Connection failed');
      mockBQClient.getDatasets.mockRejectedValue(error);

      // Act
      const connected = await client.testConnection();

      // Assert
      expect(connected).toBe(false);
    });
  });

  describe('getClient', () => {
    it('should return underlying BigQuery client', () => {
      // Act
      const bqClient = client.getClient();

      // Assert
      expect(bqClient).toBeDefined();
      expect(bqClient).toBe(mockBQClient);
    });
  });
});
