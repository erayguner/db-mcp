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
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
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
        const validation = await this.security.validateRequest({
          toolName: name,
          userId: (request as any).userId, // Extract from request context if available
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
          await this.initializeBigQuery();
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
            result.content = responseValidation.redacted;
          }
        }

        recordRequest(name, true);
        return result;
      } catch (error) {
        logger.error('Tool execution error', { tool: name, error });
        recordRequest(name, false);
        throw error;
      } finally {
        trackConnection(-1);
      }
    });

    // List resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
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
        await this.initializeBigQuery();
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

  private async initializeBigQuery() {
    try {
      // Use Application Default Credentials (Workload Identity on Cloud Run)
      this.bigquery = new BigQueryClient({
        projectId: this.env.GCP_PROJECT_ID,
        location: this.env.BIGQUERY_LOCATION,
        maxRetries: this.env.BIGQUERY_MAX_RETRIES,
        timeout: this.env.BIGQUERY_TIMEOUT,
      });

      // Test connection
      const connected = await this.bigquery.testConnection();
      if (!connected) {
        throw new Error('Failed to connect to BigQuery');
      }

      logger.info('BigQuery client initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize BigQuery client', { error });
      throw error;
    }
  }

  private async handleQuery(args: { query: string; dryRun?: boolean }) {
    try {
      if (args.dryRun) {
        const result = await this.bigquery!.dryRun(args.query);
        return {
          content: [
            {
              type: 'text',
              text: `Query dry run complete:\n- Bytes processed: ${result.totalBytesProcessed}\n- Estimated cost: $${result.estimatedCost.toFixed(4)}`,
            },
          ],
        };
      }

      const rows = await this.bigquery!.query(args.query);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ rowCount: rows.length, rows }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Query execution failed', { error });
      return {
        content: [{ type: 'text', text: `Error: ${error}` }],
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
      logger.error('Failed to list datasets', { error });
      return {
        content: [{ type: 'text', text: `Error: ${error}` }],
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
      logger.error('Failed to list tables', { error });
      return {
        content: [{ type: 'text', text: `Error: ${error}` }],
        isError: true,
      };
    }
  }

  private async handleGetTableSchema(args: { datasetId: string; tableId: string }) {
    try {
      const schema = await this.bigquery!.getTableSchema(args.datasetId, args.tableId);
      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({ dataset: args.datasetId, table: args.tableId, schema }, null, 2),
          },
        ],
      };
    } catch (error) {
      logger.error('Failed to get table schema', { error });
      return {
        content: [{ type: 'text', text: `Error: ${error}` }],
        isError: true,
      };
    }
  }

  async start() {
    try {
      // Initialize telemetry
      await initializeTelemetry(
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
      logger.error('Failed to start server', { error });
      throw error;
    }
  }

  async shutdown() {
    try {
      logger.info('Shutting down MCP BigQuery Server');
      await shutdownTelemetry();
      logger.info('Server shutdown complete');
    } catch (error) {
      logger.error('Error during shutdown', { error });
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

server.start().catch((error) => {
  logger.error('Failed to start server', { error });
  process.exit(1);
});
