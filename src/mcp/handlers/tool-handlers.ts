import { BigQueryClient } from '../../bigquery/client.js';
import { logger } from '../../utils/logger.js';
import {
  validateToolArgs,
  ToolName,
} from '../schemas/tool-schemas.js';
import { TenantContext } from '../../tenancy/tenant-context.js';
import type { Provenance, SchemaContext } from '../schemas/output-schemas.js';
import { getKillSwitch, SessionHaltedError } from '../../governance/kill-switch.js';

/** Safely coerce an unknown schema field value to string */
function fieldStr(value: unknown, fallback: string): string {
  if (typeof value === 'string') return value;
  if (value == null) return fallback;
  return JSON.stringify(value);
}

/** Safely coerce an unknown schema field value to optional string */
function fieldStrOpt(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  return undefined;
}

/** Build SchemaContext from a raw BigQuery schema array */
function buildSchemaContext(
  schema: unknown,
  tableDescription?: string,
  datasetDescription?: string,
): SchemaContext | undefined {
  if (!schema || !Array.isArray(schema)) return undefined;
  return {
    columns: (schema as Array<Record<string, unknown>>).map(f => ({
      name: fieldStr(f.name, ''),
      type: fieldStr(f.type, 'UNKNOWN'),
      description: fieldStrOpt(f.description),
      mode: fieldStr(f.mode, 'NULLABLE'),
    })),
    tableDescription,
    datasetDescription,
  };
}

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
  structuredContent?: unknown; // added
}

/**
 * Tool Handler Request Metadata
 */
export interface ToolRequestMetadata {
  userId?: string;
  requestId?: string;
  timestamp?: string;
  correlationId?: string;
  source?: string;
  [key: string]: string | undefined;
}

/**
 * Tool Handler Context
 */
export interface ToolHandlerContext {
  bigQueryClient: BigQueryClient;
  userId?: string;
  requestId?: string;
  metadata?: ToolRequestMetadata;
  tenantContext?: TenantContext;
}

/**
 * Base Tool Handler
 */
export abstract class BaseToolHandler {
  constructor(protected context: ToolHandlerContext) { }

  /**
   * Execute the tool
   */
  abstract execute(args: unknown): Promise<ToolResponse>;

  /**
   * Build a GCP Console URL for a BigQuery resource
   */
  protected buildConsoleUrl(opts: { projectId: string; datasetId?: string; tableId?: string }): string {
    const base = `https://console.cloud.google.com/bigquery?project=${encodeURIComponent(opts.projectId)}`;
    if (opts.datasetId && opts.tableId) {
      return `${base}&d=${encodeURIComponent(opts.datasetId)}&t=${encodeURIComponent(opts.tableId)}&page=table`;
    }
    if (opts.datasetId) {
      return `${base}&d=${encodeURIComponent(opts.datasetId)}&page=dataset`;
    }
    return base;
  }

  /**
   * Format success response with provenance and optional schema context
   */
  protected formatSuccess(
    data: unknown,
    meta?: Record<string, unknown>,
    provenance?: Provenance,
    schemaContext?: SchemaContext,
  ): ToolResponse {
    const auditEventId = crypto.randomUUID();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(data, null, 2),
        },
      ],
      structuredContent: data,
      _meta: {
        ...meta,
        timestamp: new Date().toISOString(),
        auditEventId,
        ...(provenance ? { provenance } : {}),
        ...(schemaContext ? { schemaContext } : {}),
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
      structuredContent: errorData,
      isError: true,
    };
  }

  /**
   * Format streaming response (for large result sets)
   */
  protected formatStreamingResponse(
    items: QueryRow[],
    meta?: Record<string, unknown>
  ): ToolResponse {
    const chunks: string[] = [];
    const chunkSize = 100; // Process in chunks of 100 items

    for (let i = 0; i < items.length; i += chunkSize) {
      const chunk = items.slice(i, i + chunkSize);
      chunks.push(JSON.stringify(chunk));
    }
    const streamingSummary = {
      totalItems: items.length,
      chunks: chunks.length,
      items,
    };
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(streamingSummary, null, 2),
        },
      ],
      structuredContent: streamingSummary,
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

      // Enforce tenant dataset policy
      if (this.context.tenantContext) {
        const policyResult = this.context.tenantContext.policy.validateQuery(query);
        if (!policyResult.allowed) {
          logger.warn('Query blocked by tenant policy', {
            tenant: this.context.tenantContext.tenantId,
            reason: policyResult.reason,
            requestId: this.context.requestId,
          });
          return this.formatError(
            policyResult.reason || 'Query not allowed by tenant policy',
            'TENANT_POLICY_VIOLATION'
          );
        }
      }

      logger.info('Executing BigQuery query', {
        queryLength: query.length,
        dryRun,
        requestId: this.context.requestId,
        tenant: this.context.tenantContext?.tenantId,
      });

      // Apply per-tenant maxBytesBilled
      const maxBytesBilled = this.context.tenantContext?.policy.getMaxBytesBilled();

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
        maximumBytesBilled: maxBytesBilled,
      });

      const projectId = this.context.tenantContext?.projectId
        ?? this.context.bigQueryClient.getProjectId();

      const provenance: Provenance = {
        source: 'bigquery',
        projectId,
        retrievedAt: new Date().toISOString(),
        freshness: result.cacheHit ? 'cached' : 'real-time',
        jobId: result.jobId,
        bytesProcessed: result.totalBytesProcessed,
        query: query.length > 500 ? query.slice(0, 500) + '...' : query,
      };

      // Build schema context from result schema for copilot consumption
      const schemaContext = buildSchemaContext(result.schema);

      // Use streaming response for large result sets
      if (result.rows.length > 1000) {
        return this.formatStreamingResponse(result.rows as QueryRow[], {
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
      }, undefined, provenance, schemaContext);
    } catch (error) {
      return this.formatError(error as Error, 'QUERY_ERROR');
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

      const resolvedProject = projectId
        ?? this.context.tenantContext?.projectId
        ?? this.context.bigQueryClient.getProjectId();

      const provenance: Provenance = {
        source: 'bigquery',
        projectId: resolvedProject,
        retrievedAt: new Date().toISOString(),
        freshness: 'real-time',
        consoleUrl: this.buildConsoleUrl({ projectId: resolvedProject }),
      };

      return this.formatSuccess({
        count: datasets.length,
        datasets: datasets.map(ds => ({
          id: ds.id,
          projectId: ds.projectId,
          location: ds.location,
          creationTime: ds.createdAt.toISOString(),
          lastModifiedTime: ds.modifiedAt.toISOString(),
          description: ds.description,
        })),
      }, {
        projectId: resolvedProject,
      }, provenance);
    } catch (error) {
      return this.formatError(error as Error, 'LIST_DATASETS_ERROR');
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

      const resolvedProject = projectId
        ?? this.context.tenantContext?.projectId
        ?? this.context.bigQueryClient.getProjectId();

      const provenance: Provenance = {
        source: 'bigquery',
        projectId: resolvedProject,
        datasetId,
        retrievedAt: new Date().toISOString(),
        freshness: 'real-time',
        consoleUrl: this.buildConsoleUrl({ projectId: resolvedProject, datasetId }),
      };

      return this.formatSuccess({
        datasetId,
        count: tables.length,
        tables: tables.map(table => ({
          id: table.id,
          tableId: table.id, // tableId is same as id in metadata
          type: table.type,
          creationTime: table.createdAt.toISOString(),
          numRows: table.numRows,
          numBytes: table.numBytes,
          description: table.description,
        })),
      }, {
        datasetId,
        projectId: resolvedProject,
      }, provenance);
    } catch (error) {
      return this.formatError(error as Error, 'LIST_TABLES_ERROR');
    }
  }
}

/**
 * Table Metadata Information
 */
export interface TableMetadataInfo {
  type: string;
  creationTime: string;
  lastModifiedTime: string;
  numRows: number | undefined;
  numBytes: number | undefined;
  description?: string;
}

/**
 * Table Schema Response
 */
export interface TableSchemaResponse {
  datasetId: string;
  tableId: string;
  schema: unknown;
  metadata?: TableMetadataInfo;
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

      const response: TableSchemaResponse = {
        datasetId,
        tableId,
        schema: table.schema,
      };

      if (includeMetadata) {
        response.metadata = {
          type: table.type,
          creationTime: table.createdAt.toISOString(),
          lastModifiedTime: table.modifiedAt.toISOString(),
          numRows: table.numRows,
          numBytes: table.numBytes,
          // location is not on TableMetadata, use dataset location if needed or omit
          description: table.description,
        };
      }

      const resolvedProject = projectId
        ?? this.context.tenantContext?.projectId
        ?? this.context.bigQueryClient.getProjectId();

      const provenance: Provenance = {
        source: 'bigquery',
        projectId: resolvedProject,
        datasetId,
        tableId,
        retrievedAt: new Date().toISOString(),
        freshness: 'real-time',
        consoleUrl: this.buildConsoleUrl({ projectId: resolvedProject, datasetId, tableId }),
      };

      // Build schema context for copilot consumption
      const schemaContext = buildSchemaContext(table.schema, table.description);

      return this.formatSuccess(response, {
        datasetId,
        tableId,
        projectId: resolvedProject,
      }, provenance, schemaContext);
    } catch (error) {
      return this.formatError(error as Error, 'GET_SCHEMA_ERROR');
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
    this.handlers.set('execute_query', QueryBigQueryHandler); // alias
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
      // §14.1 Kill-switch: deny tool calls on halted sessions before any work.
      const sessionId = context.metadata?.correlationId ?? context.requestId;
      if (sessionId) getKillSwitch().enforce(sessionId);
      const handler = this.create(toolName, context);
      return await handler.execute(args);
    } catch (error) {
      if (error instanceof SessionHaltedError) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            error: error.message, code: 'SESSION_HALTED', haltReason: error.haltReason, toolName,
          }, null, 2) }],
          isError: true,
        };
      }
      logger.error('Tool handler execution failed', {
        toolName,
        error,
        context: context.metadata,
      });

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              error: (error as Error).message,
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

export type QueryRow = Record<string, unknown>;
