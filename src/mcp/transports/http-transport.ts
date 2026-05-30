import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import type { IncomingMessage, ServerResponse } from 'http';
import type { Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { logger } from '../../utils/logger.js';
import {
  JsonRpcRequest,
  JsonRpcResponse,
  validateJsonRpc,
  isBatchRequest,
  processBatch,
  JSON_RPC_ERRORS,
} from '../middleware/batch-handler.js';
import { shouldCompress, compressResponse } from '../middleware/compression.js';
import {
  OAuthMetadataConfig,
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  buildWwwAuthenticateHeader,
  loadOAuthMetadataConfig,
} from '../../auth/oauth-metadata.js';

/**
 * Zod schema for HTTP transport configuration — used by tests and validation.
 */
export const HttpTransportConfigSchema = z.object({
  port: z.number().int().min(1).max(65535).default(8080),
  host: z.string().default('0.0.0.0'),
  basePath: z.string().default('/mcp'),
  corsOrigins: z.array(z.string()).default([]),
  enableCompression: z.boolean().default(true),
  maxRequestBodyBytes: z.number().int().positive().default(1_048_576),
  /**
   * Allow-list of acceptable `Host` header values (host[:port]). When non-empty,
   * requests with any other Host are rejected with 403 — a DNS-rebinding defense
   * (cf. the MCP HTTP SDK CVE class, e.g. CVE-2025-66414). Empty = disabled.
   */
  allowedHosts: z.array(z.string()).default([]),
  /**
   * When `true`, GET /mcp returns 405 instead of opening an SSE stream.
   * Required by Gemini Enterprise custom MCP connectors, which only support
   * Streamable HTTP and explicitly reject SSE.
   */
  strictStreamableHttp: z.boolean().default(false),
  /** Optional OAuth 2.0 discovery configuration. */
  oauthMetadata: z.unknown().optional(),
});

/**
 * Configuration for the Streamable HTTP transport.
 */
export interface HttpTransportConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  allowedHosts: string[];
  enableCompression: boolean;
  maxRequestBodyBytes: number;
  strictStreamableHttp: boolean;
  oauthMetadata: OAuthMetadataConfig | null;
}

/** Default configuration values. */
const DEFAULT_CONFIG: HttpTransportConfig = {
  port: 8080,
  host: '0.0.0.0',
  corsOrigins: [],
  allowedHosts: (process.env.MCP_ALLOWED_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim().toLowerCase())
    .filter(Boolean),
  enableCompression: true,
  maxRequestBodyBytes: 1_048_576, // 1 MiB
  strictStreamableHttp: process.env.MCP_TRANSPORT_STRICT === 'streamable',
  oauthMetadata: loadOAuthMetadataConfig(),
};

/**
 * Metrics snapshot returned by `getMetrics()`.
 */
export interface TransportMetrics {
  activeConnections: number;
  totalRequests: number;
  totalErrors: number;
}

/**
 * Opaque per-request context produced by the {@link AuthResolver} and passed
 * to the JSON-RPC handler. Kept structurally loose so the transport stays
 * decoupled from the auth/tenancy modules (the handler casts as needed).
 */
export interface McpRequestContext {
  principal?: unknown;
  tenantContext?: unknown;
}

/**
 * JSON-RPC request handler. Receives the validated request plus the optional
 * authenticated context resolved for the connection.
 */
export type JsonRpcHandler = (
  request: JsonRpcRequest,
  context?: McpRequestContext
) => Promise<JsonRpcResponse>;

/**
 * Outcome of authenticating/authorizing an inbound HTTP request.
 * `context` is forwarded to the handler only when `authorized` is true.
 */
export interface AuthResolution {
  authorized: boolean;
  error?: string;
  errorCode?: string;
  context?: McpRequestContext;
}

/**
 * Resolves authentication + tenant context from request headers. Returning
 * `{ authorized: false }` causes an RFC 6750 / MCP 2025-11-25 401 response.
 */
export type AuthResolver = (headers: Record<string, string | undefined>) => Promise<AuthResolution>;

/**
 * Represents a connected SSE client.
 */
interface SseClient {
  id: string;
  res: Response;
  connectedAt: number;
}

/**
 * Streamable HTTP transport for production Cloud Run deployment.
 *
 * Provides:
 * - `POST /mcp`  JSON-RPC request endpoint (single and batched)
 * - `GET  /mcp`  SSE stream for server-to-client notifications
 * - `GET  /health` and `GET /readiness` health probes
 * - `GET  /metrics` Prometheus scrape endpoint
 * - Optional gzip response compression (built-in `zlib`)
 * - Request-id injection on every response
 * - Graceful shutdown with in-flight drain
 */
export class StreamableHttpTransport {
  private readonly config: HttpTransportConfig;
  private readonly handler: JsonRpcHandler;
  private readonly authResolver?: AuthResolver;
  private readonly app: express.Application;
  private server: HttpServer | null = null;
  private sseClients: Map<string, SseClient> = new Map();

  // Counters
  private activeConnections = 0;
  private totalRequests = 0;
  private totalErrors = 0;

  constructor(
    handler: JsonRpcHandler,
    config?: Partial<HttpTransportConfig>,
    authResolver?: AuthResolver
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.handler = handler;
    this.authResolver = authResolver;
    this.app = this.buildApp();
  }

  // ---------- public API ----------

  /**
   * Start listening for HTTP connections.
   */
  async start(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server = createServer(this.app as (req: IncomingMessage, res: ServerResponse) => void);

      this.server.on('error', (err) => {
        logger.error('HTTP server error', { error: err.message });
        reject(err);
      });

      this.server.listen(this.config.port, this.config.host, () => {
        logger.info('Streamable HTTP transport started', {
          host: this.config.host,
          port: this.config.port,
          compression: this.config.enableCompression,
        });
        resolve();
      });
    });
  }

  /**
   * Gracefully shut down: close SSE streams, stop accepting new
   * connections, and drain in-flight requests.
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down HTTP transport', {
      activeConnections: this.activeConnections,
      sseClients: this.sseClients.size,
    });

    // Close all SSE streams
    for (const [id, client] of this.sseClients) {
      try {
        client.res.end();
      } catch {
        // client already disconnected
      }
      this.sseClients.delete(id);
    }

    // Close the HTTP server
    if (this.server) {
      await new Promise<void>((resolve, reject) => {
        this.server!.close((err) => {
          if (err) {
            logger.error('Error closing HTTP server', { error: err.message });
            reject(err);
          } else {
            logger.info('HTTP server closed');
            resolve();
          }
        });
      });
      this.server = null;
    }
  }

  /**
   * Broadcast a notification object to every connected SSE client.
   */
  broadcast(notification: object): void {
    const payload = `data: ${JSON.stringify(notification)}\n\n`;
    const deadClients: string[] = [];

    for (const [id, client] of this.sseClients) {
      try {
        client.res.write(payload);
      } catch {
        deadClients.push(id);
      }
    }

    // Prune disconnected clients
    for (const id of deadClients) {
      this.sseClients.delete(id);
    }

    if (deadClients.length > 0) {
      logger.debug('Pruned dead SSE clients', { count: deadClients.length });
    }
  }

  /**
   * Return a snapshot of transport-level metrics.
   */
  getMetrics(): TransportMetrics {
    return {
      activeConnections: this.activeConnections,
      totalRequests: this.totalRequests,
      totalErrors: this.totalErrors,
    };
  }

  /**
   * Expose the underlying Express application (useful for testing or
   * mounting additional middleware externally).
   */
  getApp(): express.Application {
    return this.app;
  }

  // ---------- private ----------

  /**
   * Construct the fully-configured Express application.
   */
  private buildApp(): express.Application {
    const app = express();

    // --- Security headers ---
    app.use((_req: Request, res: Response, next: NextFunction) => {
      res.setHeader('X-Content-Type-Options', 'nosniff');
      res.setHeader('X-Frame-Options', 'DENY');
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
      next();
    });

    // --- Host allow-list (DNS-rebinding protection) ---
    // When MCP_ALLOWED_HOSTS is configured, reject requests whose Host header
    // is not allow-listed. Mitigates the MCP HTTP DNS-rebinding CVE class.
    app.use((req: Request, res: Response, next: NextFunction) => {
      if (this.config.allowedHosts.length > 0) {
        const host = (req.headers.host ?? '').toLowerCase();
        if (!this.config.allowedHosts.includes(host)) {
          res.status(403).json({
            error: 'forbidden',
            error_description: 'Host header not allowed',
          });
          return;
        }
      }
      next();
    });

    // --- CORS ---
    // MCP spec 2025-11-25 §6.4: reject disallowed origins with HTTP 403.
    // When no corsOrigins are configured all origins are permitted (open mode).
    app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;
      if (origin && this.config.corsOrigins.length > 0) {
        const allowed =
          this.config.corsOrigins.includes('*') || this.config.corsOrigins.includes(origin);
        if (!allowed) {
          res.status(403).json({
            error: 'forbidden',
            error_description: 'Origin not allowed by CORS policy',
          });
          return;
        }
      }
      if (origin) {
        res.setHeader('Access-Control-Allow-Origin', origin);
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS');
        res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
        res.setHeader('Access-Control-Max-Age', '86400');
      }
      if (req.method === 'OPTIONS') {
        res.status(204).end();
        return;
      }
      next();
    });

    // --- Request-ID injection ---
    app.use((_req: Request, res: Response, next: NextFunction) => {
      const requestId = randomUUID();
      res.setHeader('X-Request-Id', requestId);
      (res as Response & { locals: { requestId: string } }).locals.requestId = requestId;
      next();
    });

    // --- Connection tracking & latency instrumentation ---
    app.use((req: Request, res: Response, next: NextFunction) => {
      this.activeConnections++;
      const start = performance.now();

      res.on('finish', () => {
        this.activeConnections--;
        const durationMs = performance.now() - start;
        logger.debug('HTTP request completed', {
          method: req.method,
          path: req.path,
          status: res.statusCode,
          durationMs: Math.round(durationMs),
        });
      });

      next();
    });

    // --- Body parser ---
    app.use(express.json({ limit: this.config.maxRequestBodyBytes }));

    // --- Routes ---
    this.registerRoutes(app);

    return app;
  }

  /**
   * Register all HTTP routes on the given Express app.
   */
  private registerRoutes(app: express.Application): void {
    // Health / readiness probes + deployment-probe aliases.
    // /health and /health/live both return the liveness payload (full+live).
    // /readiness and /health/ready both return the readiness payload.
    // This satisfies all probe configurations used by Terraform and Cloud Run.
    const handleHealth = (_req: Request, res: Response): void => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    };
    const handleReadiness = (_req: Request, res: Response): void => {
      res.json({ ready: true, timestamp: new Date().toISOString() });
    };

    app.get('/health', handleHealth);
    app.get('/health/live', handleHealth);
    app.get('/readiness', handleReadiness);
    app.get('/health/ready', handleReadiness);

    // Prometheus metrics
    app.get('/metrics', (_req: Request, res: Response) => {
      res.json({
        message: 'Metrics available via OpenTelemetry exporter',
        activeConnections: this?.activeConnections ?? 0,
      });
    });

    // --- OAuth 2.0 discovery (RFC 8414 + RFC 9728) ---
    this.registerOAuthDiscoveryRoutes(app);

    // --- MCP JSON-RPC endpoint (POST) ---
    app.post('/mcp', (req: Request, res: Response) => {
      void this.handleJsonRpcPost(req, res);
    });

    // --- MCP SSE stream (GET) — disabled in strict Streamable HTTP mode ---
    app.get('/mcp', (req: Request, res: Response) => {
      if (this.config.strictStreamableHttp) {
        res.setHeader('Allow', 'POST');
        res.status(405).json({
          error: 'method_not_allowed',
          error_description:
            'SSE is disabled; this server runs in strict Streamable HTTP mode. Use POST /mcp.',
        });
        return;
      }
      this.handleSseConnect(req, res);
    });

    const endpoints = [
      '/health',
      '/health/live',
      '/readiness',
      '/health/ready',
      '/metrics',
      'POST /mcp',
    ];
    if (this.config.oauthMetadata) {
      endpoints.push(
        'GET /.well-known/oauth-authorization-server',
        'GET /.well-known/oauth-protected-resource'
      );
    }
    if (this.config.strictStreamableHttp) {
      endpoints.push('GET /mcp (405 — strict mode)');
    } else {
      endpoints.push('GET /mcp (SSE)');
    }

    logger.info('HTTP transport routes registered', {
      endpoints,
      strictStreamableHttp: this.config.strictStreamableHttp,
      oauthDiscovery: !!this.config.oauthMetadata,
    });
  }

  /**
   * Register OAuth 2.0 discovery endpoints when metadata is configured.
   *
   * - `/.well-known/oauth-authorization-server` (RFC 8414)
   * - `/.well-known/oauth-protected-resource`   (RFC 9728)
   *
   * Required by MCP 2025-11-25 auth flow and by Gemini Enterprise custom MCP
   * connector registration.
   */
  private registerOAuthDiscoveryRoutes(app: express.Application): void {
    const cfg = this.config.oauthMetadata;
    if (!cfg) {
      logger.info('OAuth discovery endpoints not mounted (no OAUTH_* env vars set)');
      return;
    }

    const oauthDiscoveryLimiter = rateLimit({
      windowMs: 15 * 60 * 1000,
      max: 100,
      standardHeaders: true,
      legacyHeaders: false,
    });

    app.get(
      '/.well-known/oauth-authorization-server',
      oauthDiscoveryLimiter,
      (_req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.json(buildAuthorizationServerMetadata(cfg));
      }
    );

    app.get(
      '/.well-known/oauth-protected-resource',
      oauthDiscoveryLimiter,
      (_req: Request, res: Response) => {
        res.setHeader('Cache-Control', 'public, max-age=3600');
        res.json(buildProtectedResourceMetadata(cfg));
      }
    );
  }

  /**
   * Emit an RFC 6750 / MCP 2025-11-25-compliant 401 response.
   *
   * Sets `WWW-Authenticate: Bearer ... resource_metadata="..."` so MCP clients
   * can discover the bound authorization server.
   */
  public sendUnauthorized(
    res: Response,
    opts: { error?: string; errorDescription?: string } = {}
  ): void {
    const cfg = this.config.oauthMetadata;
    const resourceMetadataUrl = cfg
      ? `${cfg.resourceUrl.replace(/\/$/, '')}/.well-known/oauth-protected-resource`
      : '';
    const header = buildWwwAuthenticateHeader(resourceMetadataUrl, {
      realm: 'mcp',
      error: opts.error ?? 'invalid_token',
      errorDescription: opts.errorDescription,
    });
    res.setHeader('WWW-Authenticate', header);
    res.status(401).json({
      error: opts.error ?? 'invalid_token',
      error_description: opts.errorDescription ?? 'Authentication required',
      resource_metadata: resourceMetadataUrl || undefined,
    });
  }

  /**
   * Handle an incoming JSON-RPC POST request at `/mcp`.
   *
   * Accepts either a single request object or a batch array.
   * Responses may optionally be gzip-compressed when the client
   * indicates support via `Accept-Encoding`.
   */
  private async handleJsonRpcPost(req: Request, res: Response): Promise<void> {
    this.totalRequests++;

    // Validate the payload
    const validation = validateJsonRpc(req.body as unknown);
    if (!validation.valid) {
      this.totalErrors++;
      res.status(400).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: JSON_RPC_ERRORS.INVALID_REQUEST,
          message: validation.error ?? 'Invalid JSON-RPC request',
        },
      });
      return;
    }

    // Authentication / tenant resolution (when an auth resolver is wired).
    // The resolved context is forwarded to the handler so tool execution can
    // enforce per-tenant policy. The inbound token is never forwarded
    // downstream to BigQuery (no token passthrough).
    let context: McpRequestContext | undefined;
    if (this.authResolver) {
      let resolution: AuthResolution;
      try {
        resolution = await this.authResolver(req.headers as Record<string, string | undefined>);
      } catch (err) {
        this.totalErrors++;
        logger.error('Auth resolver threw', {
          error: err instanceof Error ? err.message : String(err),
        });
        this.sendUnauthorized(res, {
          error: 'invalid_token',
          errorDescription: 'Authentication failed',
        });
        return;
      }
      if (!resolution.authorized) {
        this.totalErrors++;
        this.sendUnauthorized(res, {
          error: resolution.errorCode ?? 'invalid_token',
          errorDescription: resolution.error,
        });
        return;
      }
      context = resolution.context;
    }

    try {
      let responses: JsonRpcResponse[];

      if (isBatchRequest(req.body)) {
        responses = await processBatch(validation.requests, (r) => this.handler(r, context));
      } else {
        // Single request — still use the first validated request
        const single = await this.handler(validation.requests[0], context);
        responses = [single];
      }

      // JSON-RPC: notifications (requests without an `id`) get no response.
      // MCP Streamable HTTP: a POST consisting solely of notifications/responses
      // is acknowledged with 202 Accepted and an empty body.
      const answerable = responses.filter((r) => r.id !== undefined);
      if (answerable.length === 0) {
        res.status(202).end();
        return;
      }

      // If the incoming body was a single object, return a single response.
      const body = isBatchRequest(req.body) ? answerable : answerable[0];
      const serialized = JSON.stringify(body);

      // Optional gzip compression
      const acceptsGzip = (req.headers['accept-encoding'] ?? '').includes('gzip');
      if (this.config.enableCompression && acceptsGzip && shouldCompress(serialized)) {
        const { compressed } = await compressResponse(serialized);
        res.setHeader('Content-Encoding', 'gzip');
        res.setHeader('Content-Type', 'application/json');
        res.send(compressed);
      } else {
        res.setHeader('Content-Type', 'application/json');
        res.send(serialized);
      }
    } catch (error) {
      this.totalErrors++;
      const message = error instanceof Error ? error.message : String(error);
      logger.error('JSON-RPC handler error', { error: message });

      res.status(500).json({
        jsonrpc: '2.0',
        id: null,
        error: {
          code: JSON_RPC_ERRORS.INTERNAL_ERROR,
          message: 'Internal server error',
        },
      });
    }
  }

  /**
   * Upgrade a GET request at `/mcp` into a Server-Sent Events stream.
   *
   * The connection stays open until the client disconnects or the
   * transport is shut down.
   */
  private handleSseConnect(_req: Request, res: Response): void {
    const clientId = randomUUID();

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-SSE-Client-Id', clientId);
    res.flushHeaders();

    // Send an initial connection event
    res.write(`event: connected\ndata: ${JSON.stringify({ clientId })}\n\n`);

    const client: SseClient = { id: clientId, res, connectedAt: Date.now() };
    this.sseClients.set(clientId, client);

    logger.info('SSE client connected', {
      clientId,
      totalClients: this.sseClients.size,
    });

    // Clean up when the client disconnects
    _req.on('close', () => {
      this.sseClients.delete(clientId);
      logger.info('SSE client disconnected', {
        clientId,
        totalClients: this.sseClients.size,
      });
    });
  }
}
