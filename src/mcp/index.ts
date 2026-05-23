/**
 * MCP Server Core Module
 *
 * This module provides the core infrastructure for the BigQuery MCP server:
 * - Server lifecycle management with graceful shutdown
 * - BigQuery client factory with connection pooling
 * - Tool handlers with validation and response formatting
 * - Comprehensive error handling and monitoring
 */

export {
  MCPServerFactory,
  ServerFactoryConfig,
  ServerState,
  ServerFactoryError,
} from './server-factory.js';
export {
  BigQueryClientFactory,
  BigQueryClientFactoryConfig,
  ClientFactoryError,
} from './bigquery-client-factory.js';

export {
  BaseToolHandler,
  ToolResponse,
  ToolHandlerContext,
  ToolHandlerFactory,
  QueryBigQueryHandler,
  ListDatasetsHandler,
  ListTablesHandler,
  GetTableSchemaHandler,
} from './handlers/tool-handlers.js';

export {
  initializeMcpMetrics,
  startToolTimer,
  recordProtocolMethod,
  recordPayloadSize,
  recordSecurityEvent,
  recordErrorByCode,
  recordHttpRequest,
  trackHttpConnection,
} from './mcp-metrics.js';

export {
  TOOL_SCHEMAS,
  ToolName,
  validateToolArgs,
  getToolInputSchema,
  QueryBigQueryArgs,
  ListDatasetsArgs,
  ListTablesArgs,
  GetTableSchemaArgs,
} from './schemas/tool-schemas.js';
