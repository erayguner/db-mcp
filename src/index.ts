/**
 * MCP BigQuery Server - Refactored with Factory Patterns
 *
 * This refactored version demonstrates several architectural improvements:
 *
 * 1. **Factory Pattern**: MCPServerFactory for server lifecycle management
 * 2. **Handler Factory**: ToolHandlerFactory eliminates switch-case routing
 * 3. **Zod Validation**: Type-safe argument validation with detailed error messages
 * 4. **Structured Errors**: Comprehensive error codes and consistent error handling
 * 5. **Dependency Injection**: Better testability and separation of concerns
 * 6. **Lifecycle Management**: Proper initialization, health checks, and graceful shutdown
 * 7. **Security First**: Security middleware integrated at request level
 * 8. **Telemetry**: Built-in observability with metrics and tracing
 */

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
import { recordException, setSpanAttributes } from './telemetry/tracing.js';
import { MCPServerFactory, ServerState } from './mcp/server-factory.js';
import { ToolHandlerFactory, ToolHandlerContext } from './mcp/handlers/tool-handlers.js';
import { validateToolArgs, ToolName } from './mcp/schemas/tool-schemas.js';
import { generateToolDefinitions } from './mcp/tools/definitions.js';
import {
  initializeMcpMetrics,
  startToolTimer,
  recordProtocolMethod,
  recordPayloadSize,
  recordSecurityEvent,
  recordErrorByCode,
} from './mcp/mcp-metrics.js';

/** Server version — single source of truth */
const SERVER_VERSION = '1.0.0';

/** Tool descriptions — single source of truth */
const TOOL_DESCRIPTIONS: Record<string, string> = {
  query_bigquery: 'Execute a SQL query on BigQuery datasets',
  list_datasets: 'List all available BigQuery datasets',
  list_tables: 'List tables in a dataset',
  get_table_schema: 'Get schema for a specific table',
};

/**
 * Event payload interfaces for MCPServerFactory events
 */
interface StateChangedEvent {
  oldState: ServerState;
  newState: ServerState;
}

interface ShutdownStartedEvent {
  reason?: string;
}

interface HealthCheckEvent {
  healthy: boolean;
  state: ServerState;
}

/**
 * Generic request structure with optional userId
 */
interface RequestWithUserId {
  userId?: string;
  [key: string]: unknown;
}

/**
 * Structured Error Codes
 */
export enum ErrorCode {
  // Initialization Errors
  INIT_BIGQUERY_FAILED = 'INIT_BIGQUERY_FAILED',
  INIT_TELEMETRY_FAILED = 'INIT_TELEMETRY_FAILED',
  INIT_SECURITY_FAILED = 'INIT_SECURITY_FAILED',

  // Request Errors
  SECURITY_VALIDATION_FAILED = 'SECURITY_VALIDATION_FAILED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  INVALID_TOOL = 'INVALID_TOOL',
  VALIDATION_ERROR = 'VALIDATION_ERROR',

  // Execution Errors
  TOOL_EXECUTION_FAILED = 'TOOL_EXECUTION_FAILED',
  BIGQUERY_ERROR = 'BIGQUERY_ERROR',
  RESPONSE_VALIDATION_FAILED = 'RESPONSE_VALIDATION_FAILED',

  // Lifecycle Errors
  SHUTDOWN_ERROR = 'SHUTDOWN_ERROR',
  HEALTH_CHECK_FAILED = 'HEALTH_CHECK_FAILED',
}

/**
 * Application Error with structured code
 */
export class MCPApplicationError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'MCPApplicationError';
  }
}

/**
 * MCP BigQuery Server Application
 *
 * Orchestrates all components using factory patterns:
 * - MCPServerFactory: Server lifecycle management
 * - ToolHandlerFactory: Dynamic tool routing
 * - SecurityMiddleware: Request/response validation
 * - BigQueryClient: Data access layer
 */
export class MCPBigQueryServer {
  private serverFactory: MCPServerFactory;
  private toolHandlerFactory: ToolHandlerFactory;
  private env: ReturnType<typeof getEnvironment>;
  private bigQueryClient: BigQueryClient | null = null;
  private security: SecurityMiddleware;
  private initialized = false;

  constructor() {
    this.env = getEnvironment();

    // Initialize Security Middleware
    this.security = new SecurityMiddleware({
      rateLimitEnabled: true,
      rateLimitMaxRequests: this.env.NODE_ENV === 'production' ? 100 : 1000,
      promptInjectionDetection: true,
      toolValidationEnabled: true,
      securityLoggingEnabled: true,
    });

    // Register tools with security validator (for change detection)
    this.registerSecurityTools();

    // Initialize MCP Server Factory with comprehensive config
    this.serverFactory = new MCPServerFactory({
      name: 'gcp-bigquery-mcp-server',
      version: SERVER_VERSION,
      description: 'MCP server for BigQuery with Workload Identity Federation',
      capabilities: {
        tools: true,
        resources: true,
        prompts: false,
        logging: true,
      },
      transport: 'stdio',
      gracefulShutdownTimeoutMs: 30000,
      healthCheckIntervalMs: 60000, // Health check every minute
    });

    // Initialize Tool Handler Factory
    this.toolHandlerFactory = new ToolHandlerFactory();

    // Setup event listeners for server lifecycle
    this.setupServerEventListeners();

    logger.info('MCP BigQuery Server constructed', {
      version: SERVER_VERSION,
      environment: this.env.NODE_ENV,
      securityEnabled: true,
    });
  }

  /**
   * Register security tools for validation and change detection
   */
  private registerSecurityTools(): void {
    const validator = this.security.getToolValidator();
    for (const [name, description] of Object.entries(TOOL_DESCRIPTIONS)) {
      validator.registerTool(name, description);
    }

    logger.info('Registered security tools', { count: Object.keys(TOOL_DESCRIPTIONS).length });
  }

  /**
   * Setup event listeners for server lifecycle events
   */
  private setupServerEventListeners(): void {
    this.serverFactory.on('state:changed', (event: StateChangedEvent) => {
      const { oldState, newState } = event;
      logger.info('Server state changed', { oldState, newState });
      setSpanAttributes({
        'server.state': newState,
        'server.state.previous': oldState,
      });
    });

    this.serverFactory.on('started', () => {
      logger.info('Server started event received');
    });

    this.serverFactory.on('shutdown:started', (event: ShutdownStartedEvent) => {
      const { reason } = event;
      logger.info('Server shutdown initiated', { reason });
    });

    this.serverFactory.on('shutdown:completed', () => {
      logger.info('Server shutdown completed');
    });

    this.serverFactory.on('error', (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error('Server error event', { error: err });
      recordException(err);
    });

    this.serverFactory.on('health:check', (event: HealthCheckEvent) => {
      const { healthy, state } = event;
      if (!healthy) {
        logger.warn('Health check failed', { state });
      }
    });
  }

  /**
   * Initialize BigQuery client with Workload Identity
   */
  private async initializeBigQuery(): Promise<void> {
    try {
      if (this.bigQueryClient) {
        logger.debug('BigQuery client already initialized');
        return;
      }

      logger.info('Initializing BigQuery client with Workload Identity');

      this.bigQueryClient = new BigQueryClient({
        projectId: this.env.GCP_PROJECT_ID,
        retry: {
          maxRetries: this.env.BIGQUERY_MAX_RETRIES,
        },
        queryDefaults: {
          location: this.env.BIGQUERY_LOCATION,
          timeoutMs: this.env.BIGQUERY_TIMEOUT,
        },
      });

      // Test connection
      const connected = await this.bigQueryClient.testConnection();
      if (!connected) {
        throw new Error('BigQuery connection test failed');
      }

      logger.info('BigQuery client initialized successfully', {
        projectId: this.env.GCP_PROJECT_ID,
        location: this.env.BIGQUERY_LOCATION,
      });
    } catch (error) {
      logger.error('Failed to initialize BigQuery client', { error });
      throw new MCPApplicationError(
        'Failed to initialize BigQuery client',
        ErrorCode.INIT_BIGQUERY_FAILED,
        error
      );
    }
  }

  /**
   * Initialize telemetry system
   */
  private initializeTelemetrySystem(): void {
    try {
      initializeTelemetry(
        'mcp-bigquery-server',
        SERVER_VERSION,
        this.env.GCP_PROJECT_ID
      );

      logger.info('Telemetry initialized successfully');
    } catch (error) {
      logger.error('Failed to initialize telemetry', { error });
      throw new MCPApplicationError(
        'Failed to initialize telemetry',
        ErrorCode.INIT_TELEMETRY_FAILED,
        error
      );
    }
  }

  /**
   * Setup MCP request handlers using factory pattern
   */
  private setupHandlers(): void {
    const server = this.serverFactory.getServer();

    // Removed direct capability mutation to avoid unsafe any assignments

    // ==========================================
    // List Tools Handler
    // ==========================================
    try {
      server.setRequestHandler(ListToolsRequestSchema, () => {
        logger.debug('Handling list_tools request');
        recordProtocolMethod('list_tools');
        const tools = generateToolDefinitions(this.getToolDescription.bind(this));
        logger.info('Listed tools', { count: tools.length });
        return { tools };
      });
    } catch (err) {
      logger.warn('Skipping list_tools handler registration', { error: (err as Error).message });
    }

    // ==========================================
    // Call Tool Handler (Factory Pattern)
    // ==========================================
    interface MCPGenericRequest<Params> { params: Params; userId?: string }

    /**
     * Safely extract userId from request object
     */
    function extractUserId(req: unknown): string | undefined {
      if (typeof req === 'object' && req !== null && 'userId' in req) {
        const reqWithUserId = req as RequestWithUserId;
        return typeof reqWithUserId.userId === 'string' ? reqWithUserId.userId : undefined;
      }
      return undefined;
    }

    server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const typedReq = request as MCPGenericRequest<{ name: string; arguments?: unknown }>;
      const { name, arguments: args } = typedReq.params;
      const requestId = crypto.randomUUID();

      const requestBytes = args ? JSON.stringify(args).length : 0;

      logger.info('Handling tool call', {
        tool: name,
        requestId,
        hasArgs: !!args,
        requestBytes,
      });

      // Track connection and start latency timer
      recordProtocolMethod('call_tool');
      trackConnection(1);
      const stopTimer = startToolTimer(name);

      try {
        // ==========================================
        // 1. Security Validation
        // ==========================================
        const validation = this.security.validateRequest({
          toolName: name,
          userId: extractUserId(request),
          arguments: args,
        });

        if (!validation.allowed) {
          logger.error('Request blocked by security middleware', {
            tool: name,
            error: validation.error,
            requestId,
          });
          recordRequest(name, false);
          stopTimer(false);
          recordSecurityEvent(
            validation.error?.includes('rate') ? 'rate_limited' :
            validation.error?.includes('injection') ? 'injection_blocked' :
            'unauthorized',
            name
          );
          recordErrorByCode(ErrorCode.SECURITY_VALIDATION_FAILED, name);

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: validation.error,
                code: ErrorCode.SECURITY_VALIDATION_FAILED,
                requestId,
              }, null, 2),
            }],
            isError: true,
          };
        }

        // Log warnings if any
        if (validation.warnings?.length) {
          logger.warn('Security warnings for request', {
            tool: name,
            warnings: validation.warnings,
            requestId,
          });
        }

        // ==========================================
        // 2. Ensure BigQuery is initialized
        // ==========================================
        if (!this.bigQueryClient) {
          await this.initializeBigQuery();
        }

        // ==========================================
        // 3. Validate Arguments with Zod
        // ==========================================
        let validatedArgs: unknown;
        try {
          validatedArgs = validateToolArgs(name as ToolName, args);
          logger.debug('Arguments validated', { tool: name, requestId });
        } catch (error) {
          logger.error('Argument validation failed', {
            tool: name,
            error: (error as Error).message,
            requestId,
          });
          recordRequest(name, false);
          stopTimer(false);
          recordErrorByCode(ErrorCode.VALIDATION_ERROR, name);

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                error: 'Invalid arguments',
                details: (error as Error).message,
                code: ErrorCode.VALIDATION_ERROR,
                requestId,
              }, null, 2),
            }],
            isError: true,
          };
        }

        // ==========================================
        // 4. Execute Tool via Handler Factory
        // ==========================================
        const context: ToolHandlerContext = {
          bigQueryClient: this.bigQueryClient!,
          userId: extractUserId(request),
          requestId,
          metadata: {
            timestamp: new Date().toISOString(),
            environment: this.env.NODE_ENV,
          },
        };

        setSpanAttributes({
          'tool.name': name,
          'tool.request_id': requestId,
          'tool.has_user_id': !!context.userId,
        });

        const result = await this.toolHandlerFactory.execute(
          name as ToolName,
          validatedArgs,
          context
        );

        // ==========================================
        // 5. Validate Response for Sensitive Data
        // ==========================================
        if (result.content && Array.isArray(result.content)) {
          const responseValidation = this.security.validateResponse(result.content);

          if (responseValidation.redacted && Array.isArray(responseValidation.redacted)) {
            // Type guard: ensure redacted content matches ToolResponse.content structure
            const isValidContent = responseValidation.redacted.every((item: unknown) => {
              return (
                typeof item === 'object' &&
                item !== null &&
                'type' in item &&
                typeof (item as { type: unknown }).type === 'string'
              );
            });

            if (isValidContent) {
              logger.info('Response data redacted', {
                tool: name,
                warnings: responseValidation.warnings,
                requestId,
              });
              result.content = responseValidation.redacted as typeof result.content;
            }
          }
        }

        // ==========================================
        // 6. Record Success Metrics
        // ==========================================
        const success = !result.isError;
        recordRequest(name, success);
        stopTimer(success);

        const responseBytes = result.content ? JSON.stringify(result.content).length : 0;
        recordPayloadSize('call_tool', requestBytes, responseBytes);

        logger.info('Tool execution completed', {
          tool: name,
          success,
          requestId,
          responseBytes,
        });

        return result;

      } catch (error) {
        logger.error('Tool execution error', {
          tool: name,
          error: (error as Error).message,
          requestId,
        });
        recordRequest(name, false);
        recordException(error as Error);
        stopTimer(false);
        recordErrorByCode(ErrorCode.TOOL_EXECUTION_FAILED, name);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              error: 'Tool execution failed',
              details: (error as Error).message,
              code: ErrorCode.TOOL_EXECUTION_FAILED,
              requestId,
            }, null, 2),
          }],
          isError: true,
        };
      } finally {
        trackConnection(-1);
      }
    });

    // ==========================================
    // List Resources Handler
    // ==========================================
    try {
      server.setRequestHandler(ListResourcesRequestSchema, () => {
        logger.debug('Handling list_resources request');
        recordProtocolMethod('list_resources');

        return {
          resources: [
            {
              uri: 'bigquery://datasets',
              name: 'BigQuery Datasets',
              description: 'List of available BigQuery datasets',
              mimeType: 'application/json',
            },
          ],
        };
      });
    } catch (err) {
      logger.warn('Skipping list_resources handler registration', { error: (err as Error).message });
    }

    // ==========================================
    // Read Resource Handler
    // ==========================================
    try {
      server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
       const typedReq = request as MCPGenericRequest<{ uri: string }>;
       const { uri } = typedReq.params;

       logger.info('Handling read_resource request', { uri });
       recordProtocolMethod('read_resource');

       // Ensure BigQuery is initialized
       if (!this.bigQueryClient) {
         await this.initializeBigQuery();
       }

       if (uri === 'bigquery://datasets') {
         const datasets = await this.bigQueryClient!.listDatasets();

         return {
           contents: [{
             uri,
             mimeType: 'application/json',
             text: JSON.stringify({ datasets }, null, 2),
           }],
         };
       }

       throw new Error(`Unknown resource: ${uri}`);
      });
    } catch (err) {
      logger.warn('Skipping read_resource handler registration', { error: (err as Error).message });
    }

    logger.info('Request handlers configured');
  }

  /**
   * Get tool description by name
   */
  private getToolDescription(name: string): string {
    return TOOL_DESCRIPTIONS[name] || 'BigQuery tool';
  }

  /**
   * Initialize and start the server
   */
  async start(): Promise<void> {
    try {
      if (this.initialized) {
        logger.warn('Server already initialized');
        return;
      }

      logger.info('Starting MCP BigQuery Server');

      // 1. Initialize telemetry first (for observability during startup)
      this.initializeTelemetrySystem();

      // 1b. Initialize MCP-layer metrics (requires meter provider from step 1)
      initializeMcpMetrics('mcp-bigquery-server');

      // 2. Setup MCP request handlers
      this.setupHandlers();

      // 3. Start the MCP server (handles transport and lifecycle)
      await this.serverFactory.start();

      this.initialized = true;

      logger.info('MCP BigQuery Server started successfully', {
        version: SERVER_VERSION,
        state: this.serverFactory.getState(),
        metadata: this.serverFactory.getMetadata(),
      });

    } catch (error) {
      logger.error('Failed to start server', { error });
      recordException(error as Error);

      // Ensure cleanup on startup failure
      await this.shutdown('startup_failure');

      throw error;
    }
  }

  /**
   * Gracefully shutdown the server
   */
  async shutdown(reason?: string): Promise<void> {
    try {
      logger.info('Initiating server shutdown', { reason });

      // 1. Shutdown MCP server (handles transport closure)
      await this.serverFactory.shutdown(reason);

      // 2. Shutdown telemetry
      await shutdownTelemetry();

      // 3. Close BigQuery client connections (if any)
      // BigQuery client doesn't have explicit close, connections auto-managed
      this.bigQueryClient = null;

      logger.info('Server shutdown complete');

    } catch (error) {
      logger.error('Error during shutdown', { error });
      recordException(error as Error);

      throw new MCPApplicationError(
        'Shutdown failed',
        ErrorCode.SHUTDOWN_ERROR,
        error
      );
    }
  }

  /**
   * Get server health status
   */
  getHealthStatus(): {
    healthy: boolean;
    state: ServerState;
    components: Record<string, boolean>;
  } {
    return {
      healthy: this.serverFactory.isHealthy(),
      state: this.serverFactory.getState(),
      components: {
        server: this.serverFactory.isHealthy(),
        bigQuery: this.bigQueryClient !== null,
        security: true, // Security is always initialized
        telemetry: true, // Assume telemetry is healthy if server is running
      },
    };
  }

  /**
   * Get server metadata
   */
  getMetadata() {
    return {
      ...this.serverFactory.getMetadata(),
      initialized: this.initialized,
      bigQueryConnected: this.bigQueryClient !== null,
      environment: this.env.NODE_ENV,
      projectId: this.env.GCP_PROJECT_ID,
    };
  }
}

// ==========================================
// Application Entry Point
// ==========================================

/**
 * Main function to bootstrap and run the server
 */
async function main() {
  let server: MCPBigQueryServer | null = null;

  try {
    // Create server instance
    server = new MCPBigQueryServer();

    // Start server
    await server.start();

    // Log health status
    const health = server.getHealthStatus();
    logger.info('Server health check', health);

  } catch (error) {
    logger.error('Fatal error during server startup', { error });

    // Attempt cleanup if server was created
    if (server) {
      await server.shutdown('fatal_error').catch((shutdownError: unknown) => {
        const err = shutdownError instanceof Error ? shutdownError : new Error(String(shutdownError));
        logger.error('Error during emergency shutdown', { error: err });
      });
    }

    // Only exit the process if not running under tests
    const isTestEnv = process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';
    if (!isTestEnv) {
      process.exit(1);
    }
  }
}

// Run the server only outside of test environments
const isTestEnv = process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';
if (!isTestEnv) {
  main().catch((error: unknown) => {
    const err = error instanceof Error ? error : new Error(String(error));
    logger.error('Unhandled error in main', { error: err });
    // Avoid exiting during tests
    if (!isTestEnv) {
      process.exit(1);
    }
  });
}

// Export main for potential programmatic control in tests or scripts
export { main };
