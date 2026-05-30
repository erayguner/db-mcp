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
  ListResourceTemplatesRequestSchema,
  ReadResourceRequestSchema,
  ListPromptsRequestSchema,
  GetPromptRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import {
  BIGQUERY_RESOURCE_TEMPLATES,
  URI_MATCHERS,
  ALLOWED_INFORMATION_SCHEMA_VIEWS,
} from './mcp/resources/templates.js';
import { getEnvironment } from './config/environment.js';
import { BigQueryClient } from './bigquery/client.js';
import { logger } from './utils/logger.js';
import { SecurityMiddleware } from './security/middleware.js';
import { ModelArmorProvider, createModelArmorProvider } from './security/model-armor.js';
import { initializeTelemetry, shutdownTelemetry } from './telemetry/index.js';
import { recordRequest, recordToolCall, trackConnection } from './telemetry/metrics.js';
import { recordException, setSpanAttributes } from './telemetry/tracing.js';
import { MCPServerFactory, ServerState } from './mcp/server-factory.js';
import {
  ToolHandlerFactory,
  ToolHandlerContext,
  ToolResponse,
} from './mcp/handlers/tool-handlers.js';
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
import { PromptRegistry } from './mcp/handlers/prompt-handlers.js';
import { SessionManager } from './mcp/handlers/session-manager.js';
import { ProgressNotifier } from './mcp/handlers/progress-notifier.js';
import { BehavioralAnomalyDetector } from './security/anomaly-detector.js';
import { EffectivenessTracker } from './monitoring/effectiveness-metrics.js';
import { GracefulDegradationHandler } from './bigquery/graceful-degradation.js';
import { readFileSync } from 'node:fs';
import { AuthMiddleware } from './auth/auth-middleware.js';
import { OIDCAuthenticator, AuthenticatedPrincipal } from './auth/oidc-authenticator.js';
import { loadOAuthMetadataConfig } from './auth/oauth-metadata.js';
import { TenantRegistry } from './tenancy/tenant-registry.js';
import { TenantContextFactory, TenantContext } from './tenancy/tenant-context.js';
import {
  StreamableHttpTransport,
  McpRequestContext,
  AuthResolver,
} from './mcp/transports/http-transport.js';
import {
  JsonRpcRequest,
  JsonRpcResponse,
  JSON_RPC_ERRORS,
} from './mcp/middleware/batch-handler.js';

/** Server version — single source of truth */
const SERVER_VERSION = '1.0.0';

/** MCP protocol revision advertised on `initialize` over the HTTP transport. */
const MCP_PROTOCOL_VERSION = '2025-11-25';

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
 * Input accepted by the shared call-tool pipeline (`callToolHandler`), so the
 * exact same code path runs for stdio requests and HTTP JSON-RPC requests.
 * `tenantContext` is populated only on the authenticated HTTP path.
 */
interface CallToolInput {
  params: { name: string; arguments?: unknown };
  userId?: string;
  tenantContext?: TenantContext;
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

  // MCP protocol compliance gap implementations
  private promptRegistry: PromptRegistry;
  private sessionManager: SessionManager;
  public progressNotifier: ProgressNotifier;
  private anomalyDetector: BehavioralAnomalyDetector;
  private effectivenessTracker: EffectivenessTracker;
  private degradationHandler: GracefulDegradationHandler;
  private modelArmor: ModelArmorProvider;

  // Transport + HTTP auth/tenancy wiring
  private readonly transportMode: 'stdio' | 'http';
  private httpTransport: StreamableHttpTransport | null = null;
  private authMiddleware: AuthMiddleware | null = null;
  private tenantRegistry: TenantRegistry | null = null;
  private tenantContextFactory: TenantContextFactory | null = null;

  // Shared request pipelines (assigned in setupHandlers; invoked by both the
  // stdio SDK request handlers and the HTTP JSON-RPC dispatcher).
  private callToolHandler!: (request: CallToolInput) => Promise<ToolResponse>;
  private readResourceHandler!: (request: { params: { uri: string } }) => Promise<{
    contents: Array<{ uri: string; mimeType: string; text: string }>;
  }>;

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

    // Model Armor pre-flight screening — no-op unless MODEL_ARMOR_TEMPLATE is set
    this.modelArmor = createModelArmorProvider();

    // Initialize gap implementation components
    this.promptRegistry = new PromptRegistry();
    this.sessionManager = new SessionManager();
    this.progressNotifier = new ProgressNotifier();
    this.anomalyDetector = new BehavioralAnomalyDetector();
    this.effectivenessTracker = new EffectivenessTracker();
    this.degradationHandler = new GracefulDegradationHandler({
      enabled: true,
      staleCacheMaxAgeMs: Number(process.env.MCP_STALE_CACHE_MAX_AGE_MS) || 1800000,
      circuitBreakerThreshold: Number(process.env.MCP_CIRCUIT_BREAKER_THRESHOLD) || 5,
      circuitBreakerResetMs: Number(process.env.MCP_CIRCUIT_BREAKER_RESET_MS) || 60000,
      fallbackMessage: 'BigQuery is temporarily unavailable. Serving cached results.',
    });

    // Determine transport from env
    const transport = process.env.MCP_TRANSPORT === 'http' ? ('http' as const) : ('stdio' as const);
    this.transportMode = transport;

    // Initialize MCP Server Factory with comprehensive config
    this.serverFactory = new MCPServerFactory({
      name: 'gcp-bigquery-mcp-server',
      version: SERVER_VERSION,
      description: 'MCP server for BigQuery with Workload Identity Federation',
      capabilities: {
        tools: true,
        resources: true,
        prompts: true,
        logging: true,
      },
      transport,
      gracefulShutdownTimeoutMs: 30000,
      healthCheckIntervalMs: 60000,
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
      initializeTelemetry('mcp-bigquery-server', SERVER_VERSION, this.env.GCP_PROJECT_ID);

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

    // Call-tool pipeline — stored as a field so the identical code path serves
    // both the stdio request handler (registered below) and the HTTP dispatcher.
    this.callToolHandler = async (request: CallToolInput): Promise<ToolResponse> => {
      const { name, arguments: args } = request.params;
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
      const toolStartMs = Date.now();
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
            validation.error?.includes('rate')
              ? 'rate_limited'
              : validation.error?.includes('injection')
                ? 'injection_blocked'
                : 'unauthorized',
            name
          );
          recordErrorByCode(ErrorCode.SECURITY_VALIDATION_FAILED, name);

          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    error: validation.error,
                    code: ErrorCode.SECURITY_VALIDATION_FAILED,
                    requestId,
                  },
                  null,
                  2
                ),
              },
            ],
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
        // 1b. Per-tenant tool allow-list (defense-in-depth)
        // ==========================================
        const allowedTools = request.tenantContext?.config.allowedTools;
        if (allowedTools && allowedTools.length > 0 && !allowedTools.includes(name)) {
          logger.warn('Tool blocked by tenant allow-list', {
            tool: name,
            tenant: request.tenantContext?.tenantId,
            requestId,
          });
          recordRequest(name, false, request.tenantContext?.tenantId);
          stopTimer(false);
          recordErrorByCode(ErrorCode.SECURITY_VALIDATION_FAILED, name);
          return {
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    error: `Tool "${name}" is not permitted for this tenant`,
                    code: 'TENANT_TOOL_NOT_ALLOWED',
                    requestId,
                  },
                  null,
                  2
                ),
              },
            ],
            isError: true,
          };
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
            content: [
              {
                type: 'text' as const,
                text: JSON.stringify(
                  {
                    error: 'Invalid arguments',
                    details: (error as Error).message,
                    code: ErrorCode.VALIDATION_ERROR,
                    requestId,
                  },
                  null,
                  2
                ),
              },
            ],
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
          modelArmor: this.modelArmor,
          // Tenant context is resolved at the HTTP auth boundary and threaded
          // through here so DatasetPolicy + per-tenant maxBytesBilled enforce.
          tenantContext: request.tenantContext,
        };

        const tenantId = context.tenantContext?.tenantId;
        setSpanAttributes({
          'tool.name': name,
          'tool.request_id': requestId,
          'tool.has_user_id': !!context.userId,
          // OpenTelemetry GenAI + MCP semantic conventions (R14) so spans line
          // up with Cloud Trace agent/MCP dashboards and Observability Analytics.
          'gen_ai.operation.name': 'execute_tool',
          'gen_ai.tool.name': name,
          'mcp.method.name': 'tools/call',
          ...(tenantId ? { 'tenant.id': tenantId } : {}),
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
        // 6. Record Success Metrics & Track Behavior
        // ==========================================
        const success = !result.isError;
        recordRequest(name, success, tenantId);
        recordToolCall(name, success ? 'allow' : 'block', Date.now() - toolStartMs, tenantId);
        stopTimer(success);

        const responseBytes = result.content ? JSON.stringify(result.content).length : 0;
        recordPayloadSize('call_tool', requestBytes, responseBytes);

        // Track intelligence effectiveness
        this.effectivenessTracker.recordToolCall({
          toolName: name,
          timestamp: new Date(),
          success,
          executionTimeMs: Date.now() - toolStartMs,
          wasRetry: false,
        });

        // Record behavioral anomaly detection
        const userId = extractUserId(request) || 'anonymous';
        const anomalies = this.anomalyDetector.recordQuery({
          userId,
          toolName: name,
          timestamp: new Date(),
          datasetsAccessed: [],
          isWrite: false,
        });
        if (anomalies.length > 0) {
          logger.warn('Behavioral anomalies detected', {
            userId,
            tool: name,
            anomalyCount: anomalies.length,
            types: anomalies.map((a) => a.type),
          });
        }

        logger.info('Tool execution completed', {
          tool: name,
          tenant: tenantId,
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
        recordToolCall(name, 'error', Date.now() - toolStartMs);
        recordException(error as Error);
        stopTimer(false);
        recordErrorByCode(ErrorCode.TOOL_EXECUTION_FAILED, name);

        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(
                {
                  error: 'Tool execution failed',
                  details: (error as Error).message,
                  code: ErrorCode.TOOL_EXECUTION_FAILED,
                  requestId,
                },
                null,
                2
              ),
            },
          ],
          isError: true,
        };
      } finally {
        trackConnection(-1);
      }
    };

    server.setRequestHandler(CallToolRequestSchema, (request) =>
      this.callToolHandler(request as CallToolInput)
    );

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
              name: 'BigQuery Dataset Catalog',
              description:
                'Discoverable catalog of all available BigQuery datasets with descriptions and metadata',
              mimeType: 'application/json',
            },
          ],
        };
      });
    } catch (err) {
      logger.warn('Skipping list_resources handler registration', {
        error: (err as Error).message,
      });
    }

    // ==========================================
    // List Resource Templates Handler (MCP 2025-11-25)
    // ==========================================
    try {
      server.setRequestHandler(ListResourceTemplatesRequestSchema, () => {
        logger.debug('Handling list_resource_templates request');
        recordProtocolMethod('list_resource_templates');
        return { resourceTemplates: BIGQUERY_RESOURCE_TEMPLATES };
      });
    } catch (err) {
      logger.warn('Skipping list_resource_templates handler registration', {
        error: (err as Error).message,
      });
    }

    // ==========================================
    // List Prompts Handler
    // ==========================================
    try {
      server.setRequestHandler(ListPromptsRequestSchema, () => {
        logger.debug('Handling list_prompts request');
        recordProtocolMethod('list_prompts');
        const prompts = this.promptRegistry.listPrompts();
        logger.info('Listed prompts', { count: prompts.length });
        return { prompts };
      });
    } catch (err) {
      logger.warn('Skipping list_prompts handler registration', { error: (err as Error).message });
    }

    // ==========================================
    // Get Prompt Handler
    // ==========================================
    try {
      server.setRequestHandler(GetPromptRequestSchema, (request) => {
        const typedReq = request as {
          params: { name: string; arguments?: Record<string, string> };
        };
        const { name, arguments: args } = typedReq.params;

        logger.info('Handling get_prompt request', { name, hasArgs: !!args });
        recordProtocolMethod('get_prompt');

        const result = this.promptRegistry.getPrompt(name, args || {});

        // Map to SDK-expected format: { description, messages: [{role, content}] }
        return {
          description: result.description,
          messages: result.messages.map(
            (m: { role: string; content: { type: string; text: string } }) => ({
              role: m.role as 'user' | 'assistant',
              content: m.content,
            })
          ),
        };
      });
    } catch (err) {
      logger.warn('Skipping get_prompt handler registration', { error: (err as Error).message });
    }

    // ==========================================
    // Read Resource Handler
    // ==========================================
    try {
      // Read-resource pipeline — stored as a field so it is reusable from the
      // HTTP dispatcher as well as the stdio handler registered below.
      this.readResourceHandler = async (request: { params: { uri: string } }) => {
        const { uri } = request.params;

        logger.info('Handling read_resource request', { uri });
        recordProtocolMethod('read_resource');

        // Ensure BigQuery is initialized
        if (!this.bigQueryClient) {
          await this.initializeBigQuery();
        }

        const projectId = this.env.GCP_PROJECT_ID;
        const now = new Date().toISOString();

        // bigquery://datasets — full catalog
        if (uri === 'bigquery://datasets') {
          const datasets = await this.bigQueryClient!.listDatasets();

          const response = {
            datasets: datasets.map((ds) => ({
              id: ds.id,
              projectId: ds.projectId,
              location: ds.location,
              description: ds.description,
              creationTime: ds.createdAt.toISOString(),
              lastModifiedTime: ds.modifiedAt.toISOString(),
            })),
            provenance: {
              source: 'bigquery',
              projectId,
              retrievedAt: now,
              freshness: 'real-time',
              consoleUrl: `https://console.cloud.google.com/bigquery?project=${encodeURIComponent(projectId)}`,
            },
          };

          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(response, null, 2),
              },
            ],
          };
        }

        // bigquery://datasets/{datasetId}/tables/{tableId}/schema — schema only
        const schemaMatch = uri.match(URI_MATCHERS.schema);
        if (schemaMatch) {
          const [, datasetId, tableId] = schemaMatch;
          const table = await this.bigQueryClient!.getTable(datasetId, tableId);
          const columns = Array.isArray(table.schema)
            ? (table.schema as Array<Record<string, unknown>>).map((f) => ({
                name: typeof f.name === 'string' ? f.name : '',
                type: typeof f.type === 'string' ? f.type : 'UNKNOWN',
                mode: typeof f.mode === 'string' ? f.mode : 'NULLABLE',
                description: typeof f.description === 'string' ? f.description : undefined,
              }))
            : [];
          const response = {
            datasetId,
            tableId,
            columns,
            tableDescription: table.description,
            provenance: {
              source: 'bigquery',
              projectId,
              datasetId,
              tableId,
              retrievedAt: now,
              freshness: 'real-time',
              consoleUrl: `https://console.cloud.google.com/bigquery?project=${encodeURIComponent(projectId)}&d=${encodeURIComponent(datasetId)}&t=${encodeURIComponent(tableId)}&page=table`,
            },
          };
          return {
            contents: [
              { uri, mimeType: 'application/json', text: JSON.stringify(response, null, 2) },
            ],
          };
        }

        // bigquery://datasets/{datasetId}/tables/{tableId}/sample — preview rows
        const sampleMatch = uri.match(URI_MATCHERS.sample);
        if (sampleMatch) {
          const [, datasetId, tableId] = sampleMatch;
          // Validate identifiers per BigQuery rules to prevent SQL injection.
          if (!/^[A-Za-z0-9_]+$/.test(datasetId) || !/^[A-Za-z0-9_]+$/.test(tableId)) {
            throw new Error(`Invalid dataset/table identifier in URI: ${uri}`);
          }
          const sampleSql = `SELECT * FROM \`${projectId}.${datasetId}.${tableId}\` LIMIT 10`;
          const result = await this.bigQueryClient!.query({ query: sampleSql });
          const response = {
            datasetId,
            tableId,
            rows: result.rows,
            rowCount: Array.isArray(result.rows) ? result.rows.length : 0,
            provenance: {
              source: 'bigquery',
              projectId,
              datasetId,
              tableId,
              retrievedAt: now,
              freshness: 'real-time',
              note: 'Up to 10 rows; honors tenant column-masking policies if applied at query time.',
              consoleUrl: `https://console.cloud.google.com/bigquery?project=${encodeURIComponent(projectId)}&d=${encodeURIComponent(datasetId)}&t=${encodeURIComponent(tableId)}&page=table`,
            },
          };
          return {
            contents: [
              { uri, mimeType: 'application/json', text: JSON.stringify(response, null, 2) },
            ],
          };
        }

        // bigquery://jobs/{jobId} — query job result handle
        const jobMatch = uri.match(URI_MATCHERS.job);
        if (jobMatch) {
          const [, jobId] = jobMatch;
          if (!/^[A-Za-z0-9_\-:.]+$/.test(jobId)) {
            throw new Error(`Invalid job id in URI: ${uri}`);
          }
          // Defer to the BigQuery client; if it lacks a getJob helper, surface a clear error.
          const client = this.bigQueryClient as unknown as {
            getJob?: (id: string) => Promise<unknown>;
          };
          if (typeof client.getJob !== 'function') {
            throw new Error(
              'Job resource requires BigQueryClient.getJob() — not implemented in this build'
            );
          }
          const job = await client.getJob(jobId);
          const response = {
            jobId,
            job,
            provenance: {
              source: 'bigquery',
              projectId,
              jobId,
              retrievedAt: now,
              freshness: 'real-time',
              consoleUrl: `https://console.cloud.google.com/bigquery?project=${encodeURIComponent(projectId)}&j=bq:${encodeURIComponent(jobId)}&page=queryresults`,
            },
          };
          return {
            contents: [
              { uri, mimeType: 'application/json', text: JSON.stringify(response, null, 2) },
            ],
          };
        }

        // bigquery://datasets/{datasetId}/information_schema/{view} — catalog browse
        const isMatch = uri.match(URI_MATCHERS.informationSchema);
        if (isMatch) {
          const [, datasetId, view] = isMatch;
          if (!/^[A-Za-z0-9_]+$/.test(datasetId)) {
            throw new Error(`Invalid dataset identifier in URI: ${uri}`);
          }
          if (!ALLOWED_INFORMATION_SCHEMA_VIEWS.has(view)) {
            throw new Error(`Unsupported INFORMATION_SCHEMA view: ${view}`);
          }
          const sql = `SELECT * FROM \`${projectId}.${datasetId}.INFORMATION_SCHEMA.${view}\` LIMIT 1000`;
          const result = await this.bigQueryClient!.query({ query: sql });
          const response = {
            datasetId,
            view,
            rows: result.rows,
            provenance: {
              source: 'bigquery.information_schema',
              projectId,
              datasetId,
              view,
              retrievedAt: now,
              freshness: 'real-time',
            },
          };
          return {
            contents: [
              { uri, mimeType: 'application/json', text: JSON.stringify(response, null, 2) },
            ],
          };
        }

        // bigquery://datasets/{datasetId}/tables/{tableId} — table detail (check before dataset)
        const tableMatch = uri.match(/^bigquery:\/\/datasets\/([^/]+)\/tables\/([^/]+)$/);
        if (tableMatch) {
          const [, datasetId, tableId] = tableMatch;
          const table = await this.bigQueryClient!.getTable(datasetId, tableId);

          const schemaContext = Array.isArray(table.schema)
            ? {
                columns: (table.schema as Array<Record<string, unknown>>).map((f) => ({
                  name: typeof f.name === 'string' ? f.name : '',
                  type: typeof f.type === 'string' ? f.type : 'UNKNOWN',
                  description: typeof f.description === 'string' ? f.description : undefined,
                  mode: typeof f.mode === 'string' ? f.mode : 'NULLABLE',
                })),
                tableDescription: table.description,
              }
            : undefined;

          const response = {
            datasetId,
            tableId,
            schema: table.schema,
            metadata: {
              type: table.type,
              creationTime: table.createdAt.toISOString(),
              lastModifiedTime: table.modifiedAt.toISOString(),
              numRows: table.numRows,
              numBytes: table.numBytes,
              description: table.description,
            },
            schemaContext,
            provenance: {
              source: 'bigquery',
              projectId,
              datasetId,
              tableId,
              retrievedAt: now,
              freshness: 'real-time',
              consoleUrl: `https://console.cloud.google.com/bigquery?project=${encodeURIComponent(projectId)}&d=${encodeURIComponent(datasetId)}&t=${encodeURIComponent(tableId)}&page=table`,
            },
          };

          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(response, null, 2),
              },
            ],
          };
        }

        // bigquery://datasets/{datasetId} — dataset detail with table listing
        const datasetMatch = uri.match(/^bigquery:\/\/datasets\/([^/]+)$/);
        if (datasetMatch) {
          const [, datasetId] = datasetMatch;
          const tables = await this.bigQueryClient!.listTables(datasetId);

          const response = {
            datasetId,
            tables: tables.map((t) => ({
              id: t.id,
              type: t.type,
              numRows: t.numRows,
              numBytes: t.numBytes,
              description: t.description,
              creationTime: t.createdAt.toISOString(),
            })),
            provenance: {
              source: 'bigquery',
              projectId,
              datasetId,
              retrievedAt: now,
              freshness: 'real-time',
              consoleUrl: `https://console.cloud.google.com/bigquery?project=${encodeURIComponent(projectId)}&d=${encodeURIComponent(datasetId)}&page=dataset`,
            },
          };

          return {
            contents: [
              {
                uri,
                mimeType: 'application/json',
                text: JSON.stringify(response, null, 2),
              },
            ],
          };
        }

        throw new Error(`Unknown resource: ${uri}`);
      };

      server.setRequestHandler(ReadResourceRequestSchema, (request) =>
        this.readResourceHandler(request as { params: { uri: string } })
      );
    } catch (err) {
      logger.warn('Skipping read_resource handler registration', { error: (err as Error).message });
    }

    logger.info('Request handlers configured');
  }

  /**
   * Build the OIDC auth middleware and tenant registry/factory for the HTTP
   * transport. Auth is enforced only when an OIDC issuer is configured (via
   * OAUTH_* metadata env vars or OIDC_ISSUER/OIDC_AUDIENCE); otherwise the
   * server logs a prominent warning and serves unauthenticated (dev only).
   */
  private setupAuthAndTenancy(): void {
    // --- Tenant registry + context factory ---
    this.tenantRegistry = new TenantRegistry();
    const tenantPath = this.env.TENANT_CONFIG_PATH;
    try {
      const yamlContent = readFileSync(tenantPath, 'utf-8');
      this.tenantRegistry.loadFromYaml(yamlContent);
      logger.info('Tenant registry loaded', {
        tenantPath,
        tenants: this.tenantRegistry.size(),
      });
    } catch (error) {
      logger.warn(
        'Failed to load tenant config; tenant isolation will use the default tenant only',
        { tenantPath, error: (error as Error).message }
      );
    }
    this.tenantContextFactory = new TenantContextFactory(
      this.tenantRegistry,
      this.env.DEFAULT_TENANT_ID
    );

    // --- OIDC authentication ---
    try {
      const oauthCfg = loadOAuthMetadataConfig();
      if (oauthCfg) {
        this.authMiddleware = new AuthMiddleware({
          oidc: OIDCAuthenticator.configFromOAuthMetadata(oauthCfg),
          bypassTools: [],
          requireAuth: this.env.MCP_AUTH_REQUIRED,
        });
        // Do not log issuer/audience (CodeQL js/clear-text-logging treats
        // resolved auth config as sensitive). The method + flag are sufficient.
        logger.info('HTTP authentication enabled', {
          method: 'oauth-metadata',
          requireAuth: this.env.MCP_AUTH_REQUIRED,
        });
      } else if (this.env.OIDC_ISSUER && this.env.OIDC_AUDIENCE) {
        this.authMiddleware = new AuthMiddleware({
          oidc: {
            issuer: this.env.OIDC_ISSUER,
            audience: this.env.OIDC_AUDIENCE,
            requiredScopes: [],
            clockToleranceSec: 30,
            ...(this.env.OIDC_JWKS_URI ? { jwksUri: this.env.OIDC_JWKS_URI } : {}),
          },
          bypassTools: [],
          requireAuth: this.env.MCP_AUTH_REQUIRED,
        });
        logger.info('HTTP authentication enabled', {
          method: 'oidc-env',
          requireAuth: this.env.MCP_AUTH_REQUIRED,
        });
      } else {
        logger.warn(
          'HTTP transport starting WITHOUT authentication — set OAUTH_* or ' +
            'OIDC_ISSUER/OIDC_AUDIENCE to verify inbound Bearer tokens'
        );
      }
    } catch (error) {
      logger.error(
        'Failed to initialize OIDC authentication; HTTP transport will be UNAUTHENTICATED',
        { error: (error as Error).message }
      );
      this.authMiddleware = null;
    }
  }

  /**
   * Build the auth resolver passed to the HTTP transport. Verifies the inbound
   * Bearer token and resolves the tenant context. The inbound token is used
   * ONLY to authenticate and resolve the tenant — it is NEVER forwarded to
   * BigQuery (no token passthrough). BigQuery is reached via the service's own
   * ADC / per-tenant service-account identity.
   */
  private buildAuthResolver(): AuthResolver {
    return async (headers) => {
      if (!this.authMiddleware) {
        // No OIDC configured — allow through with no principal/tenant (dev).
        return { authorized: true };
      }
      const result = await this.authMiddleware.authenticate(headers);
      if (!result.authenticated) {
        return { authorized: false, error: result.error, errorCode: result.errorCode };
      }
      let tenantContext: TenantContext | undefined;
      if (result.principal && this.tenantContextFactory) {
        try {
          tenantContext = this.tenantContextFactory.createContext(result.principal);
        } catch (error) {
          return {
            authorized: false,
            error: (error as Error).message,
            errorCode: 'TENANT_RESOLUTION_FAILED',
          };
        }
      }
      return {
        authorized: true,
        context: { principal: result.principal, tenantContext },
      };
    };
  }

  /**
   * Dispatch a single JSON-RPC request to the matching MCP method (HTTP path).
   * Mirrors the stdio handlers but threads the authenticated tenant context
   * into tool execution. Never throws: protocol errors become JSON-RPC error
   * objects; tool-level errors are returned as tool results with `isError`.
   */
  private async dispatch(
    req: JsonRpcRequest,
    context?: McpRequestContext
  ): Promise<JsonRpcResponse> {
    const ok = (result: unknown): JsonRpcResponse => ({ jsonrpc: '2.0', id: req.id, result });
    const fail = (code: number, message: string, data?: unknown): JsonRpcResponse => ({
      jsonrpc: '2.0',
      id: req.id,
      error: { code, message, ...(data !== undefined ? { data } : {}) },
    });

    const params = (req.params ?? {}) as Record<string, unknown>;
    const principal = context?.principal as AuthenticatedPrincipal | undefined;
    const tenantContext = context?.tenantContext as TenantContext | undefined;

    try {
      switch (req.method) {
        case 'initialize':
          return ok({
            protocolVersion:
              typeof params.protocolVersion === 'string'
                ? params.protocolVersion
                : MCP_PROTOCOL_VERSION,
            capabilities: { tools: {}, resources: {}, prompts: {}, logging: {} },
            serverInfo: { name: 'gcp-bigquery-mcp-server', version: SERVER_VERSION },
          });

        case 'ping':
          return ok({});

        case 'tools/list':
          return ok({ tools: generateToolDefinitions(this.getToolDescription.bind(this)) });

        case 'tools/call': {
          const name = typeof params.name === 'string' ? params.name : '';
          if (!name) return fail(JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing tool name');
          recordProtocolMethod('call_tool');
          const result = await this.callToolHandler({
            params: { name, arguments: params.arguments },
            ...(principal?.subject ? { userId: principal.subject } : {}),
            ...(tenantContext ? { tenantContext } : {}),
          });
          return ok(result);
        }

        case 'resources/list':
          return ok({
            resources: [
              {
                uri: 'bigquery://datasets',
                name: 'BigQuery Dataset Catalog',
                description:
                  'Discoverable catalog of all available BigQuery datasets with descriptions and metadata',
                mimeType: 'application/json',
              },
            ],
          });

        case 'resources/templates/list':
          return ok({ resourceTemplates: BIGQUERY_RESOURCE_TEMPLATES });

        case 'resources/read': {
          const uri = typeof params.uri === 'string' ? params.uri : '';
          if (!uri) return fail(JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing resource uri');
          return ok(await this.readResourceHandler({ params: { uri } }));
        }

        case 'prompts/list':
          return ok({ prompts: this.promptRegistry.listPrompts() });

        case 'prompts/get': {
          const name = typeof params.name === 'string' ? params.name : '';
          if (!name) return fail(JSON_RPC_ERRORS.INVALID_PARAMS, 'Missing prompt name');
          const prompt = this.promptRegistry.getPrompt(
            name,
            (params.arguments as Record<string, string>) ?? {}
          );
          return ok({
            description: prompt.description,
            messages: prompt.messages.map(
              (m: { role: string; content: { type: string; text: string } }) => ({
                role: m.role,
                content: m.content,
              })
            ),
          });
        }

        default:
          // notifications/* carry no id and need no response — return a benign
          // result the transport drops (HTTP 202). Unknown requests → error.
          if (req.method.startsWith('notifications/')) return ok({});
          return fail(JSON_RPC_ERRORS.METHOD_NOT_FOUND, `Method not found: ${req.method}`);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Dispatch error', { method: req.method, id: req.id, error: message });
      recordException(error as Error);
      return fail(JSON_RPC_ERRORS.INTERNAL_ERROR, 'Internal error', message);
    }
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

      // 3b. For HTTP, set up auth + tenancy and start the Streamable HTTP
      // listener (exposes /health for Cloud Run probes and POST /mcp). The
      // stdio path needs none of this.
      if (this.transportMode === 'http') {
        this.setupAuthAndTenancy();
        this.httpTransport = new StreamableHttpTransport(
          (req, ctx) => this.dispatch(req, ctx),
          {
            port: this.env.MCP_HTTP_PORT,
            strictStreamableHttp: process.env.MCP_TRANSPORT_STRICT === 'streamable',
          },
          this.buildAuthResolver()
        );
        await this.httpTransport.start();
        logger.info('Streamable HTTP transport listening', {
          port: this.env.MCP_HTTP_PORT,
          authEnabled: this.authMiddleware !== null,
          strictStreamableHttp: process.env.MCP_TRANSPORT_STRICT === 'streamable',
        });
      }

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

      // 1. Stop accepting HTTP requests first (drains in-flight + closes SSE),
      // then stop tenant config watching.
      if (this.httpTransport) {
        await this.httpTransport.shutdown();
        this.httpTransport = null;
      }
      this.tenantRegistry?.stopWatching();

      // 2. Shutdown MCP server (handles transport closure)
      await this.serverFactory.shutdown(reason);

      // 2. Shutdown telemetry
      await shutdownTelemetry();

      // 3. Close BigQuery client connections (if any)
      // BigQuery client doesn't have explicit close, connections auto-managed
      this.bigQueryClient = null;

      // 4. Cleanup gap components
      this.sessionManager.dispose();
      this.anomalyDetector.destroy();

      logger.info('Server shutdown complete');
    } catch (error) {
      logger.error('Error during shutdown', { error });
      recordException(error as Error);

      throw new MCPApplicationError('Shutdown failed', ErrorCode.SHUTDOWN_ERROR, error);
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
        security: true,
        telemetry: true,
        prompts: true,
        sessions: true,
        anomalyDetection: true,
        circuitBreaker: this.degradationHandler.getCircuitState() !== 'open',
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
        const err =
          shutdownError instanceof Error ? shutdownError : new Error(String(shutdownError));
        logger.error('Error during emergency shutdown', { error: err });
      });
    }

    // Only exit the process if not running under tests
    const isTestEnv =
      process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';
    if (!isTestEnv) {
      process.exit(1);
    }
  }
}

// Run the server only outside of test environments
const isTestEnv =
  process.env.NODE_ENV === 'test' || typeof process.env.JEST_WORKER_ID !== 'undefined';
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
