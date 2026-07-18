import {
  BaseToolHandler,
  QueryBigQueryHandler,
  ListDatasetsHandler,
  ListTablesHandler,
  GetTableSchemaHandler,
  ToolHandlerFactory,
  ToolHandlerContext,
  ToolResponse,
} from '../../../src/mcp/handlers/tool-handlers.js';
import { BigQueryClient } from '../../../src/bigquery/client.js';

// Mock dependencies
jest.mock('../../../src/bigquery/client');
jest.mock('../../../src/utils/logger', () => ({
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
}));

describe('Tool Handlers', () => {
  let mockBigQueryClient: jest.Mocked<BigQueryClient>;
  let context: ToolHandlerContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // Create mock BigQuery client
    mockBigQueryClient = {
      query: jest.fn(),
      dryRun: jest.fn(),
      listDatasets: jest.fn(),
      listTables: jest.fn(),
      getTable: jest.fn(),
      getProjectId: jest.fn().mockReturnValue('test-project'),
      isHealthy: jest.fn().mockReturnValue(true),
    } as any;

    context = {
      bigQueryClient: mockBigQueryClient,
      userId: 'test-user',
      requestId: 'req-123',
      metadata: { test: 'metadata' },
    };
  });

  describe('BaseToolHandler', () => {
    class TestHandler extends BaseToolHandler {
      async execute(_args: unknown): Promise<ToolResponse> {
        return this.formatSuccess({ result: 'test' });
      }
    }

    it('should format success response correctly', async () => {
      const handler = new TestHandler(context);
      const response = await handler.execute({});

      expect(response).toMatchObject({
        content: [
          {
            type: 'text',
            text: expect.stringContaining('"result": "test"'),
          },
        ],
        _meta: {
          timestamp: expect.any(String),
        },
      });
      expect(response.isError).toBeUndefined();
    });

    it('should format success response with metadata', async () => {
      class MetadataHandler extends BaseToolHandler {
        async execute(_args?: unknown): Promise<ToolResponse> {
          return this.formatSuccess({ data: 'value' }, { custom: 'meta' });
        }
      }

      const handler = new MetadataHandler(context);
      const response = await handler.execute({});

      expect(response._meta).toMatchObject({
        custom: 'meta',
        timestamp: expect.any(String),
      });
    });

    it('should format error response correctly', async () => {
      class ErrorHandler extends BaseToolHandler {
        async execute(_args?: unknown): Promise<ToolResponse> {
          return this.formatError('Test error', 'TEST_CODE');
        }
      }

      const handler = new ErrorHandler(context);
      const response = await handler.execute({});

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Test error');
      expect(response.content[0].text).toContain('TEST_CODE');
    });

    it('should format error response from Error object', async () => {
      class ErrorHandler extends BaseToolHandler {
        async execute(_args?: unknown): Promise<ToolResponse> {
          return this.formatError(new Error('Error object message'));
        }
      }

      const handler = new ErrorHandler(context);
      const response = await handler.execute({});

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Error object message');
      expect(response.content[0].text).toContain('TOOL_ERROR');
    });

    it('should format streaming response for large datasets', async () => {
      class StreamHandler extends BaseToolHandler {
        async execute(_args?: unknown): Promise<ToolResponse> {
          const items = Array.from({ length: 250 }, (_, i) => ({ id: i }));
          return this.formatStreamingResponse(items, { source: 'test' });
        }
      }

      const handler = new StreamHandler(context);
      const response = await handler.execute({});

      expect(response._meta?.streaming).toBe(true);
      expect(response._meta?.totalItems).toBe(250);
      expect(response._meta?.chunks).toBe(3);
      // The payload conforms to QueryExecutedOutputSchema; chunking lives in _meta.
      expect(response.content[0].text).toContain('"rowCount": 250');
      expect((response.structuredContent as { rows: unknown[] }).rows).toHaveLength(250);
    });
  });

  describe('QueryBigQueryHandler', () => {
    it('should execute dry run successfully', async () => {
      const handler = new QueryBigQueryHandler(context);
      const args = {
        query: 'SELECT * FROM table',
        dryRun: true,
      };

      mockBigQueryClient.dryRun.mockResolvedValue({
        totalBytesProcessed: '1000000',
        estimatedCostUSD: 0.005,
      });

      const response = await handler.execute(args);

      expect(mockBigQueryClient.dryRun).toHaveBeenCalledWith(
        'SELECT * FROM table',
        expect.objectContaining({
          useLegacySql: false,
        })
      );
      expect(response.isError).toBeUndefined();
      expect(response.content[0].text).toContain('dryRun');
      expect(response.content[0].text).toContain('1000000');
    });

    it('should execute query successfully', async () => {
      const handler = new QueryBigQueryHandler(context);
      const args = {
        query: 'SELECT id, name FROM users LIMIT 10',
        maxResults: 100,
        timeoutMs: 30000,
      };

      mockBigQueryClient.query.mockResolvedValue({
        rows: [
          { id: 1, name: 'Alice' },
          { id: 2, name: 'Bob' },
        ],
        schema: [
          { name: 'id', type: 'INTEGER' },
          { name: 'name', type: 'STRING' },
        ],
        jobId: 'job-123',
        totalRows: 2,
        cacheHit: false,
        executionTimeMs: 1500,
        totalBytesProcessed: '50000',
      });

      const response = await handler.execute(args);

      expect(mockBigQueryClient.query).toHaveBeenCalledWith({
        query: 'SELECT id, name FROM users LIMIT 10',
        maxResults: 100,
        jobTimeoutMs: 30000,
        useLegacySql: false,
        location: undefined,
      });
      expect(response.isError).toBeUndefined();
      expect(response.content[0].text).toContain('Alice');
      expect(response.content[0].text).toContain('Bob');
      expect(response.content[0].text).toContain('job-123');
    });

    it('should use streaming response for large result sets', async () => {
      const handler = new QueryBigQueryHandler(context);
      const args = { query: 'SELECT * FROM large_table' };

      const largeRowSet = Array.from({ length: 1500 }, (_, i) => ({ id: i, value: `row-${i}` }));

      mockBigQueryClient.query.mockResolvedValue({
        rows: largeRowSet,
        schema: [],
        jobId: 'job-456',
        totalRows: 1500,
        cacheHit: true,
        executionTimeMs: 5000,
        totalBytesProcessed: '5000000',
      });

      const response = await handler.execute(args);

      expect(response._meta?.streaming).toBe(true);
      expect(response._meta?.totalItems).toBe(1500);
      expect(response._meta?.cacheHit).toBe(true);
    });

    it('should handle query execution errors', async () => {
      const handler = new QueryBigQueryHandler(context);
      const args = { query: 'INVALID SQL' };

      mockBigQueryClient.query.mockRejectedValue(new Error('Syntax error in SQL'));

      const response = await handler.execute(args);

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Syntax error in SQL');
      expect(response.content[0].text).toContain('QUERY_ERROR');
    });

    it('should validate arguments before execution', async () => {
      const handler = new QueryBigQueryHandler(context);
      const invalidArgs = { query: '' }; // Empty query

      const response = await handler.execute(invalidArgs);

      expect(response.isError).toBe(true);
      expect(mockBigQueryClient.query).not.toHaveBeenCalled();
    });

    it('should handle legacy SQL option', async () => {
      const handler = new QueryBigQueryHandler(context);
      const args = {
        query: 'SELECT * FROM [project:dataset.table]',
        useLegacySql: true,
      };

      mockBigQueryClient.query.mockResolvedValue({
        rows: [],
        schema: [],
        jobId: 'job-legacy',
        totalRows: 0,
        cacheHit: false,
        executionTimeMs: 100,
        totalBytesProcessed: '0',
      });

      await handler.execute(args);

      expect(mockBigQueryClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          useLegacySql: true,
        })
      );
    });

    it('should handle location parameter', async () => {
      const handler = new QueryBigQueryHandler(context);
      const args = {
        query: 'SELECT 1',
        location: 'EU',
      };

      mockBigQueryClient.query.mockResolvedValue({
        rows: [{ f0_: 1 }],
        schema: [],
        jobId: 'job-eu',
        totalRows: 1,
        cacheHit: false,
        executionTimeMs: 50,
        totalBytesProcessed: '10',
      });

      await handler.execute(args);

      expect(mockBigQueryClient.query).toHaveBeenCalledWith(
        expect.objectContaining({
          location: 'EU',
        })
      );
    });
  });

  describe('ListDatasetsHandler', () => {
    it('should list datasets successfully', async () => {
      const handler = new ListDatasetsHandler(context);
      const args = { projectId: 'my-project' };

      mockBigQueryClient.listDatasets.mockResolvedValue([
        {
          id: 'dataset1',
          projectId: 'my-project',
          location: 'EU',
          createdAt: new Date('2024-01-01'),
          modifiedAt: new Date('2024-01-02'),
          description: 'Test dataset 1',
          tableCount: 0,
          tables: [],
          lastAccessedAt: new Date('2024-01-02'),
          accessCount: 0,
        },
        {
          id: 'dataset2',
          projectId: 'my-project',
          location: 'EU',
          createdAt: new Date('2024-01-03'),
          modifiedAt: new Date('2024-01-04'),
          description: 'Test dataset 2',
          tableCount: 0,
          tables: [],
          lastAccessedAt: new Date('2024-01-04'),
          accessCount: 0,
        },
      ]);

      const response = await handler.execute(args);

      expect(mockBigQueryClient.listDatasets).toHaveBeenCalledWith('my-project');
      expect(response.isError).toBeUndefined();
      expect(response.content[0].text).toContain('dataset1');
      expect(response.content[0].text).toContain('dataset2');
      expect(response.content[0].text).toContain('"count": 2');
    });

    it('should apply maxResults limit', async () => {
      const handler = new ListDatasetsHandler(context);
      const args = { projectId: 'my-project', maxResults: 1 };

      mockBigQueryClient.listDatasets.mockResolvedValue([
        {
          id: 'dataset1',
          projectId: 'my-project',
          location: 'EU',
          createdAt: new Date(),
          modifiedAt: new Date(),
          tableCount: 0,
          tables: [],
          lastAccessedAt: new Date(),
          accessCount: 0,
        },
        {
          id: 'dataset2',
          projectId: 'my-project',
          location: 'EU',
          createdAt: new Date(),
          modifiedAt: new Date(),
          tableCount: 0,
          tables: [],
          lastAccessedAt: new Date(),
          accessCount: 0,
        },
        {
          id: 'dataset3',
          projectId: 'my-project',
          location: 'ASIA',
          createdAt: new Date(),
          modifiedAt: new Date(),
          tableCount: 0,
          tables: [],
          lastAccessedAt: new Date(),
          accessCount: 0,
        },
      ]);

      const response = await handler.execute(args);

      expect(response.content[0].text).toContain('"count": 1');
      expect(response.content[0].text).toContain('dataset1');
      expect(response.content[0].text).not.toContain('dataset2');
    });

    it('should handle empty dataset list', async () => {
      const handler = new ListDatasetsHandler(context);
      const args = { projectId: 'empty-project' };

      mockBigQueryClient.listDatasets.mockResolvedValue([]);

      const response = await handler.execute(args);

      expect(response.isError).toBeUndefined();
      expect(response.content[0].text).toContain('"count": 0');
      expect(response.content[0].text).toContain('"datasets": []');
    });

    it('should handle list datasets errors', async () => {
      const handler = new ListDatasetsHandler(context);
      const args = { projectId: 'invalid-project' };

      mockBigQueryClient.listDatasets.mockRejectedValue(new Error('Project not found'));

      const response = await handler.execute(args);

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Project not found');
      expect(response.content[0].text).toContain('LIST_DATASETS_ERROR');
    });
  });

  describe('ListTablesHandler', () => {
    it('should list tables successfully', async () => {
      const handler = new ListTablesHandler(context);
      const args = {
        datasetId: 'my_dataset',
        projectId: 'my-project',
      };

      mockBigQueryClient.listTables.mockResolvedValue([
        {
          id: 'table1',
          datasetId: 'my_dataset',
          projectId: 'my-project',
          type: 'TABLE',
          schema: [],
          createdAt: new Date('2024-01-01'),
          modifiedAt: new Date('2024-01-01'),
          numRows: 1000,
          numBytes: 50000,
        },
        {
          id: 'table2',
          datasetId: 'my_dataset',
          projectId: 'my-project',
          type: 'VIEW',
          schema: [],
          createdAt: new Date('2024-01-02'),
          modifiedAt: new Date('2024-01-02'),
          numRows: 500,
          numBytes: 25000,
        },
      ]);

      const response = await handler.execute(args);

      expect(mockBigQueryClient.listTables).toHaveBeenCalledWith('my_dataset', 'my-project');
      expect(response.isError).toBeUndefined();
      expect(response.content[0].text).toContain('table1');
      expect(response.content[0].text).toContain('table2');
      expect(response.content[0].text).toContain('"count": 2');
    });

    it('should apply maxResults limit', async () => {
      const handler = new ListTablesHandler(context);
      const args = {
        datasetId: 'my_dataset',
        maxResults: 1,
      };

      mockBigQueryClient.listTables.mockResolvedValue([
        {
          id: 'table1',
          datasetId: 'my_dataset',
          projectId: 'my-project',
          type: 'TABLE',
          schema: [],
          createdAt: new Date(),
          modifiedAt: new Date(),
        },
        {
          id: 'table2',
          datasetId: 'my_dataset',
          projectId: 'my-project',
          type: 'TABLE',
          schema: [],
          createdAt: new Date(),
          modifiedAt: new Date(),
        },
      ]);

      const response = await handler.execute(args);

      expect(response.content[0].text).toContain('"count": 1');
      expect(response.content[0].text).toContain('table1');
      expect(response.content[0].text).not.toContain('table2');
    });

    it('should handle list tables errors', async () => {
      const handler = new ListTablesHandler(context);
      const args = { datasetId: 'nonexistent' };

      mockBigQueryClient.listTables.mockRejectedValue(new Error('Dataset not found'));

      const response = await handler.execute(args);

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Dataset not found');
      expect(response.content[0].text).toContain('LIST_TABLES_ERROR');
    });
  });

  describe('GetTableSchemaHandler', () => {
    it('should get table schema successfully', async () => {
      const handler = new GetTableSchemaHandler(context);
      const args = {
        datasetId: 'my_dataset',
        tableId: 'my_table',
        projectId: 'my-project',
      };

      mockBigQueryClient.getTable.mockResolvedValue({
        id: 'my_table',
        datasetId: 'my_dataset',
        projectId: 'my-project',
        schema: [
          { name: 'id', type: 'INTEGER', mode: 'REQUIRED' },
          { name: 'name', type: 'STRING', mode: 'NULLABLE' },
          { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
        ],
        type: 'TABLE',
        createdAt: new Date('2024-01-01'),
        modifiedAt: new Date('2024-01-05'),
        numRows: 10000,
        numBytes: 500000,
      });

      const response = await handler.execute(args);

      expect(mockBigQueryClient.getTable).toHaveBeenCalledWith(
        'my_dataset',
        'my_table',
        'my-project'
      );
      expect(response.isError).toBeUndefined();
      expect(response.content[0].text).toContain('my_dataset');
      expect(response.content[0].text).toContain('my_table');
      expect(response.content[0].text).toContain('INTEGER');
      expect(response.content[0].text).toContain('STRING');
      expect(response.content[0].text).toContain('TIMESTAMP');
    });

    it('should include metadata when requested', async () => {
      const handler = new GetTableSchemaHandler(context);
      const args = {
        datasetId: 'my_dataset',
        tableId: 'my_table',
        includeMetadata: true,
      };

      mockBigQueryClient.getTable.mockResolvedValue({
        id: 'my_table',
        datasetId: 'my_dataset',
        projectId: 'my-project',
        schema: [{ name: 'id', type: 'INTEGER' }],
        type: 'TABLE',
        createdAt: new Date('2024-01-01'),
        modifiedAt: new Date('2024-01-02'),
        numRows: 5000,
        numBytes: 100000,
      });

      const response = await handler.execute(args);

      expect(response.content[0].text).toContain('metadata');
      expect(response.content[0].text).toContain('TABLE');
      expect(response.content[0].text).toContain('5000');
    });

    it('should exclude metadata by default or when requested', async () => {
      const handler = new GetTableSchemaHandler(context);
      const args = {
        datasetId: 'my_dataset',
        tableId: 'my_table',
        includeMetadata: false,
      };

      mockBigQueryClient.getTable.mockResolvedValue({
        id: 'my_table',
        datasetId: 'my_dataset',
        projectId: 'my-project',
        schema: [{ name: 'id', type: 'INTEGER' }],
        type: 'TABLE',
        createdAt: new Date(),
        modifiedAt: new Date(),
        numRows: 5000,
      });

      const response = await handler.execute(args);

      const parsed = JSON.parse(response.content[0].text!);
      expect(parsed.schema).toBeDefined();
      expect(parsed.metadata).toBeUndefined();
    });

    it('should handle get table schema errors', async () => {
      const handler = new GetTableSchemaHandler(context);
      const args = {
        datasetId: 'my_dataset',
        tableId: 'nonexistent_table',
      };

      mockBigQueryClient.getTable.mockRejectedValue(new Error('Table not found'));

      const response = await handler.execute(args);

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Table not found');
      expect(response.content[0].text).toContain('GET_SCHEMA_ERROR');
    });
  });

  describe('ToolHandlerFactory', () => {
    it('should create factory with default handlers', () => {
      const factory = new ToolHandlerFactory();

      expect(factory).toBeInstanceOf(ToolHandlerFactory);
    });

    it('should create query handler', () => {
      const factory = new ToolHandlerFactory();
      const handler = factory.create('query_bigquery', context);

      expect(handler).toBeInstanceOf(QueryBigQueryHandler);
      expect(handler).toBeInstanceOf(BaseToolHandler);
    });

    it('should create list datasets handler', () => {
      const factory = new ToolHandlerFactory();
      const handler = factory.create('list_datasets', context);

      expect(handler).toBeInstanceOf(ListDatasetsHandler);
    });

    it('should create list tables handler', () => {
      const factory = new ToolHandlerFactory();
      const handler = factory.create('list_tables', context);

      expect(handler).toBeInstanceOf(ListTablesHandler);
    });

    it('should create get table schema handler', () => {
      const factory = new ToolHandlerFactory();
      const handler = factory.create('get_table_schema', context);

      expect(handler).toBeInstanceOf(GetTableSchemaHandler);
    });

    it('should throw error for unknown tool', () => {
      const factory = new ToolHandlerFactory();

      expect(() => {
        factory.create('unknown_tool' as any, context);
      }).toThrow('No handler registered for tool');
    });

    it('should register custom handler', () => {
      class CustomHandler extends BaseToolHandler {
        async execute(_args?: unknown): Promise<ToolResponse> {
          return this.formatSuccess({ custom: true });
        }
      }

      const factory = new ToolHandlerFactory();
      factory.register('query_bigquery', CustomHandler);

      const handler = factory.create('query_bigquery', context);
      expect(handler).toBeInstanceOf(CustomHandler);
    });

    it('should execute tool with handler', async () => {
      const factory = new ToolHandlerFactory();
      const args = {
        query: 'SELECT 1',
        dryRun: true,
      };

      mockBigQueryClient.dryRun.mockResolvedValue({
        totalBytesProcessed: '100',
        estimatedCostUSD: 0.001,
      });

      const response = await factory.execute('query_bigquery', args, context);

      expect(response.isError).toBeUndefined();
      expect(response.content[0].text).toContain('dryRun');
    });

    it('should handle execution errors gracefully', async () => {
      const factory = new ToolHandlerFactory();
      const args = { query: 'INVALID' };

      mockBigQueryClient.query.mockRejectedValue(new Error('Query failed'));

      const response = await factory.execute('query_bigquery', args, context);

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('Query failed');
    });

    it('should handle handler creation errors', async () => {
      const factory = new ToolHandlerFactory();

      const response = await factory.execute('unknown_tool' as any, {}, context);

      expect(response.isError).toBe(true);
      expect(response.content[0].text).toContain('No handler registered');
      expect(response.content[0].text).toContain('HANDLER_ERROR');
    });
  });
});
