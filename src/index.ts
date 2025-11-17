import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { getEnvironment } from './config/environment.js';
import { BigQueryClient } from './bigquery/client.js';
import { logger } from './utils/logger.js';
import { SecurityMiddleware } from './security/middleware.js';
import { initializeTelemetry, shutdownTelemetry } from './telemetry/index.js';
import { recordRequest, trackConnection } from './telemetry/metrics.js';

/**
 * MCP BigQuery Server with Workload Identity Federation and Security
 */

class MCPBigQueryServer {
  private server: Server;
  private env: ReturnType<typeof getEnvironment>;
  private bigquery: BigQueryClient | null = null;
  private security: SecurityMiddleware;

  constructor() {
    this.env = getEnvironment();

    // Initialize security middleware
    this.security = new SecurityMiddleware({
      rateLimitEnabled: true,
      rateLimitMaxRequests: this.env.NODE_ENV === 'production' ? 100 : 1000,
      promptInjectionDetection: true,
      toolValidationEnabled: true,
      securityLoggingEnabled: true,
    });

    // Register tool descriptions for change detection
    this.security.getToolValidator().registerTool(
      'query_bigquery',
      'Execute a SQL query on BigQuery datasets'
    );
    this.security.getToolValidator().registerTool(
      'list_datasets',
      'List all available BigQuery datasets'
    );
    this.security.getToolValidator().registerTool(
      'list_tables',
      'List tables in a dataset'
    );
    this.security.getToolValidator().registerTool(
      'get_table_schema',
      'Get schema for a specific table'
    );

    // Initialize server
    this.server = new Server({
      name: 'gcp-bigquery-mcp-server',
      version: '1.0.0',
    });

    this.setupHandlers();

    logger.info('MCP BigQuery Server initialized', {
      version: '1.0.0',
      environment: this.env.NODE_ENV,
      securityEnabled: true,
    });
  }

  private setupHandlers() {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, () => ({
      tools: [
        {
          name: 'query_bigquery',
          description: 'Execute a SQL query on BigQuery datasets',
          inputSchema: {
            type: 'object',
            properties: {
              query: { type: 'string', description: 'SQL query to execute' },
              dryRun: { type: 'boolean', description: 'Estimate cost without executing' },
            },
            required: ['query'],
          },
        },
        {
          name: 'list_datasets',
          description: 'List all available BigQuery datasets',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'list_tables',
          description: 'List tables in a dataset',
          inputSchema: {
            type: 'object',
            properties: {
              datasetId: { type: 'string', description: 'Dataset ID' },
            },
            required: ['datasetId'],
          },
        },
        {
          name: 'get_table_schema',
          description: 'Get schema for a specific table',
          inputSchema: {
            type: 'object',
            properties: {
              datasetId: { type: 'string' },
              tableId: { type: 'string' },
            },
            required: ['datasetId', 'tableId'],
          },
        },
      ],
    }));

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      // Track connection
      trackConnection(1);

      try {
        // Security validation
        const requestWithUser = request as { userId?: string };
        const validation = this.security.validateRequest({
          toolName: name,
          userId: requestWithUser.userId, // Extract from request context if available
          arguments: args,
        });

        if (!validation.allowed) {
          logger.error('Request blocked by security middleware', {
            tool: name,
            error: validation.error,
          });
          recordRequest(name, false);
          return {
            content: [
              {
                type: 'text',
                text: `Security Error: ${validation.error}`,
              },
            ],
            isError: true,
          };
        }

        if (validation.warnings && validation.warnings.length > 0) {
          logger.warn('Security warnings for request', {
            tool: name,
            warnings: validation.warnings,
          });
        }

        // Ensure BigQuery client is initialized
        if (!this.bigquery) {
          this.initializeBigQuery();
        }

        let result;

        switch (name) {
          case 'query_bigquery':
            result = await this.handleQuery(args as { query: string; dryRun?: boolean });
            break;
          case 'list_datasets':
            result = await this.handleListDatasets();
            break;
          case 'list_tables':
            result = await this.handleListTables(args as { datasetId: string });
            break;
          case 'get_table_schema':
            result = await this.handleGetTableSchema(args as { datasetId: string; tableId: string });
            break;
          default:
            recordRequest(name, false);
            throw new Error(`Unknown tool: ${name}`);
        }

        // Validate response for sensitive data
        if (result && result.content) {
          const responseValidation = this.security.validateResponse(result.content);
          if (responseValidation.redacted) {
            logger.info('Response data redacted', {
              tool: name,
              warnings: responseValidation.warnings,
            });
            result.content = Array.isArray(responseValidation.redacted)
              ? responseValidation.redacted
              : [];
          }
        }

        recordRequest(name, true);
        return result;
      } catch (error) {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Tool execution error', { tool: name, error: err.message });
        recordRequest(name, false);
        throw err;
      } finally {
        trackConnection(-1);
      }
    });

    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, () => ({
      resources: [
        {
          uri: 'bigquery://datasets',
          name: 'BigQuery Datasets',
          description: 'List of available BigQuery datasets',
          mimeType: 'application/json',
        },
      ],
    }));

    // Read resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (!this.bigquery) {
        this.initializeBigQuery();
      }

      if (uri === 'bigquery://datasets') {
        const datasets = await this.bigquery!.listDatasets();
        return {
          contents: [
            {
              uri,
              mimeType: 'application/json',
              text: JSON.stringify({ datasets }, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });
  }

  private initializeBigQuery() {
    try {
      // Use Application Default Credentials (Workload Identity on Cloud Run)
      this.bigquery = new BigQueryClient({
        projectId: this.env.GCP_PROJECT_ID,
        queryDefaults: {
          location: this.env.BIGQUERY_LOCATION,
          useLegacySql: false,
        },
        retry: {
          maxRetries: this.env.BIGQUERY_MAX_RETRIES,
          initialDelayMs: 1000,
          maxDelayMs: 32000,
          backoffMultiplier: 2,
          retryableErrors: ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'RATE_LIMIT_EXCEEDED', 'BACKEND_ERROR'],
        },
      });

      // Connection is tested lazily on first query
      // No need to test connection here

      logger.info('BigQuery client initialized successfully');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to initialize BigQuery client', { error: err.message });
      throw err;
    }
  }

  private async handleQuery(args: { query: string; dryRun?: boolean }) {
    try {
      if (args.dryRun) {
        const result = await this.bigquery!.dryRun(args.query);
        const estimatedCostRaw = result.estimatedCostUSD;
        const costNumber = typeof estimatedCostRaw === 'number' ? estimatedCostRaw : 0;
        return {
          content: [
            {
              type: 'text',
              text: `Query dry run complete:\n- Bytes processed: ${result.totalBytesProcessed}\n- Estimated cost: $${costNumber.toFixed(4)}`,
            },
          ],
        };
      }

      const queryResult = await this.bigquery!.query({ query: args.query });
      const rows = Array.isArray(queryResult) ? queryResult : [];
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ rowCount: rows.length, rows }, null, 2),
          },
        ],
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Query execution failed', { error: err.message });
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }

  private async handleListDatasets() {
    try {
      const datasets = await this.bigquery!.listDatasets();
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ count: datasets.length, datasets }, null, 2),
          },
        ],
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to list datasets', { error: err.message });
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }

  private async handleListTables(args: { datasetId: string }) {
    try {
      const tables = await this.bigquery!.listTables(args.datasetId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ dataset: args.datasetId, count: tables.length, tables }, null, 2),
          },
        ],
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to list tables', { error: err.message });
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }

  private async handleGetTableSchema(args: { datasetId: string; tableId: string }) {
    try {
      const tableMetadata = await this.bigquery!.getTable(args.datasetId, args.tableId);
      const schemaData = tableMetadata.schema as { fields?: unknown[] } | unknown[] | undefined;
      let schema: unknown[] = [];
      if (schemaData && typeof schemaData === 'object') {
        if (Array.isArray(schemaData)) {
          schema = schemaData;
        } else if ('fields' in schemaData && Array.isArray(schemaData.fields)) {
          schema = schemaData.fields;
        }
      }
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ dataset: args.datasetId, table: args.tableId, schema }, null, 2),
          },
        ],
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to get table schema', { error: err.message });
      return {
        content: [{ type: 'text', text: `Error: ${err.message}` }],
        isError: true,
      };
    }
  }

  async start() {
    try {
      // Initialize telemetry
      initializeTelemetry(
        'mcp-bigquery-server',
        '1.0.0',
        this.env.GCP_PROJECT_ID
      );

      const transport = new StdioServerTransport();
      await this.server.connect(transport);
      logger.info('MCP BigQuery Server started on stdio', {
        securityEnabled: true,
        telemetryEnabled: true,
      });
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Failed to start server', { error: err.message });
      throw err;
    }
  }

  async shutdown() {
    try {
      logger.info('Shutting down MCP BigQuery Server');
      await shutdownTelemetry();
      logger.info('Server shutdown complete');
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Error during shutdown', { error: err.message });
    }
  }
}

// Start server
const server = new MCPBigQueryServer();

// Graceful shutdown
process.on('SIGTERM', async () => {
  await server.shutdown();
  process.exit(0);
});

process.on('SIGINT', async () => {
  await server.shutdown();
  process.exit(0);
});

server.start().catch((error: unknown) => {
  const err = error instanceof Error ? error : new Error(String(error));
  logger.error('Failed to start server', { error: err.message });
  process.exit(1);
});
