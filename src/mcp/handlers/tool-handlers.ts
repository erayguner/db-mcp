import { BigQueryClient } from '../../bigquery/client.js';
import { logger } from '../../utils/logger.js';
import {
  validateToolArgs,
  ToolName,
} from '../schemas/tool-schemas.js';

/**
 * MCP Tool Response Format
 */
export interface ToolResponse {
  content: Array<{
    type: 'text' | 'image' | 'resource';
    text?: string;
    data?: string;
    uri?: string;
    mimeType?: string;
  }>;
  isError?: boolean;
  _meta?: Record<string, unknown>;
}

/**
 * Tool Handler Context
 */
export interface ToolHandlerContext {
  bigQueryClient: BigQueryClient;
  userId?: string;
  requestId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Base Tool Handler
 */
export abstract class BaseToolHandler {
  constructor(protected context: ToolHandlerContext) {}

  /**
   * Execute the tool
   */
  abstract execute(args: unknown): Promise<ToolResponse>;

  /**
   * Format success response
   */
  protected formatSuccess(data: unknown, meta?: Record<string, unknown>): ToolResponse {
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
      _meta: {
        ...meta,
        timestamp: new Date().toISOString(),
      },
    };
  }

  /**
   * Format error response
   */
  protected formatError(error: Error | string, code?: string): ToolResponse {
    const message = typeof error === 'string' ? error : error.message;
    const errorData = {
      error: message,
      code: code || 'TOOL_ERROR',
      timestamp: new Date().toISOString(),
    };

    logger.error('Tool execution error', {
      error: message,
      code,
      context: this.context.metadata,
    });

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(errorData, null, 2),
        },
      ],
      isError: true,
    };
  }

  /**
   * Format streaming response (for large result sets)
   */
  protected formatStreamingResponse(
    items: unknown[],
    meta?: Record<string, unknown>
  ): ToolResponse {
    const chunks: string[] = [];
    const chunkSize = 100; // Process in chunks of 100 items

    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      chunks.push(JSON.stringify(chunk));
    }

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            totalItems: items.length,
            chunks: chunks.length,
            items: items,
          }, null, 2),
        },
      ],
      _meta: {
        ...meta,
        streaming: true,
        totalItems: items.length,
        timestamp: new Date().toISOString(),
      },
    };
  }
}

/**
 * Query BigQuery Tool Handler
 */
export class QueryBigQueryHandler extends BaseToolHandler {
  async execute(args: unknown): Promise<ToolResponse> {
    try {
      const validated = validateToolArgs('query_bigquery', args);
      const { query, dryRun, maxResults, timeoutMs, useLegacySql, location } = validated;

      logger.info('Executing BigQuery query', {
        queryLength: query.length,
        dryRun,
        requestId: this.context.requestId,
      });

      // Execute dry run if requested
      if (dryRun) {
        const dryRunResult = await this.context.bigQueryClient.dryRun(query, {
          useLegacySql,
          location,
        });

        return this.formatSuccess({
          dryRun: true,
          totalBytesProcessed: dryRunResult.totalBytesProcessed,
          estimatedCostUSD: dryRunResult.estimatedCostUSD,
        });
      }

      // Execute actual query
      const result = await this.context.bigQueryClient.query({
        query,
        maxResults,
        jobTimeoutMs: timeoutMs,
        useLegacySql,
        location,
      });

      // Use streaming response for large result sets
      if (result.rows.length > 1000) {
        return this.formatStreamingResponse(result.rows, {
          totalRows: result.totalRows,
          jobId: result.jobId,
          cacheHit: result.cacheHit,
          executionTimeMs: result.executionTimeMs,
          totalBytesProcessed: result.totalBytesProcessed,
        });
      }

      return this.formatSuccess({
        rowCount: result.rows.length,
        rows: result.rows,
        schema: result.schema,
        jobId: result.jobId,
        cacheHit: result.cacheHit,
        executionTimeMs: result.executionTimeMs,
        totalBytesProcessed: result.totalBytesProcessed,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return this.formatError(err, 'QUERY_ERROR');
    }
  }
}

/**
 * List Datasets Tool Handler
 */
export class ListDatasetsHandler extends BaseToolHandler {
  async execute(args: unknown): Promise<ToolResponse> {
    try {
      const validated = validateToolArgs('list_datasets', args);
      const { projectId, maxResults } = validated;

      logger.info('Listing BigQuery datasets', {
        projectId,
        maxResults,
        requestId: this.context.requestId,
      });

      let datasets = await this.context.bigQueryClient.listDatasets(projectId);

      // Apply max results limit if specified
      if (maxResults && datasets.length > maxResults) {
        datasets = datasets.slice(0, maxResults);
      }

      return this.formatSuccess({
        count: datasets.length,
        datasets: datasets.map(ds => ({
          id: ds.id,
          projectId: ds.projectId,
          location: ds.location,
          createdAt: ds.createdAt,
          modifiedAt: ds.modifiedAt,
          description: ds.description,
        })),
      }, {
        projectId: projectId || 'default',
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return this.formatError(err, 'LIST_DATASETS_ERROR');
    }
  }
}

/**
 * List Tables Tool Handler
 */
export class ListTablesHandler extends BaseToolHandler {
  async execute(args: unknown): Promise<ToolResponse> {
    try {
      const validated = validateToolArgs('list_tables', args);
      const { datasetId, projectId, maxResults } = validated;

      logger.info('Listing BigQuery tables', {
        datasetId,
        projectId,
        maxResults,
        requestId: this.context.requestId,
      });

      let tables = await this.context.bigQueryClient.listTables(datasetId, projectId);

      // Apply max results limit if specified
      if (maxResults && tables.length > maxResults) {
        tables = tables.slice(0, maxResults);
      }

      return this.formatSuccess({
        datasetId,
        count: tables.length,
        tables: tables.map(table => ({
          id: table.id,
          datasetId: table.datasetId,
          type: table.type,
          createdAt: table.createdAt,
          numRows: table.numRows,
          numBytes: table.numBytes,
        })),
      }, {
        datasetId,
        projectId: projectId || 'default',
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return this.formatError(err, 'LIST_TABLES_ERROR');
    }
  }
}

/**
 * Get Table Schema Tool Handler
 */
export class GetTableSchemaHandler extends BaseToolHandler {
  async execute(args: unknown): Promise<ToolResponse> {
    try {
      const validated = validateToolArgs('get_table_schema', args);
      const { datasetId, tableId, projectId, includeMetadata } = validated;

      logger.info('Getting BigQuery table schema', {
        datasetId,
        tableId,
        projectId,
        requestId: this.context.requestId,
      });

      const table = await this.context.bigQueryClient.getTable(
        datasetId,
        tableId,
        projectId
      );

      const response: Record<string, unknown> = {
        datasetId,
        tableId,
        schema: table.schema,
      };

      if (includeMetadata) {
        response.metadata = {
          type: table.type,
          createdAt: table.createdAt,
          modifiedAt: table.modifiedAt,
          numRows: table.numRows,
          numBytes: table.numBytes,
        };
      }

      return this.formatSuccess(response, {
        datasetId,
        tableId,
        projectId: projectId || 'default',
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      return this.formatError(err, 'GET_SCHEMA_ERROR');
    }
  }
}

/**
 * Tool Handler Factory
 */
export class ToolHandlerFactory {
  private handlers: Map<ToolName, new (context: ToolHandlerContext) => BaseToolHandler>;

  constructor() {
    this.handlers = new Map();
    this.registerDefaultHandlers();
  }

  private registerDefaultHandlers(): void {
    this.handlers.set('query_bigquery', QueryBigQueryHandler);
    this.handlers.set('list_datasets', ListDatasetsHandler);
    this.handlers.set('list_tables', ListTablesHandler);
    this.handlers.set('get_table_schema', GetTableSchemaHandler);
  }

  /**
   * Register custom tool handler
   */
  public register(
    toolName: ToolName,
    handlerClass: new (context: ToolHandlerContext) => BaseToolHandler
  ): void {
    this.handlers.set(toolName, handlerClass);
    logger.info('Registered tool handler', { toolName });
  }

  /**
   * Create handler instance for tool
   */
  public create(toolName: ToolName, context: ToolHandlerContext): BaseToolHandler {
    const HandlerClass = this.handlers.get(toolName);

    if (!HandlerClass) {
      throw new Error(`No handler registered for tool: ${toolName}`);
    }

    return new HandlerClass(context);
  }

  /**
   * Execute tool with proper error handling
   */
  public async execute(
    toolName: ToolName,
    args: unknown,
    context: ToolHandlerContext
  ): Promise<ToolResponse> {
    try {
      const handler = this.create(toolName, context);
      return await handler.execute(args);
    } catch (error) {
      logger.error('Tool handler execution failed', {
        toolName,
        error,
        context: context.metadata,
      });

      const err = error instanceof Error ? error : new Error(String(error));
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: err.message,
              code: 'HANDLER_ERROR',
              toolName,
            }, null, 2),
          },
        ],
        isError: true,
      };
    }
  }
}
