import express, { Request, Response, NextFunction } from 'express';
import rateLimit from 'express-rate-limit';
import { createServer } from 'http';
import type { IncomingMessage, ServerResponse, Server as HttpServer } from 'http';
import { randomUUID } from 'crypto';
import { z } from 'zod';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import type { AuthInfo } from '@modelcontextprotocol/sdk/server/auth/types.js';
import { logger } from '../../utils/logger.js';
import {
  OAuthMetadataConfig,
  buildAuthorizationServerMetadata,
  buildProtectedResourceMetadata,
  buildWwwAuthenticateHeader,
  loadOAuthMetadataConfig,
} from '../../auth/oauth-metadata.js';
import {
  ReadinessRegistry,
  readinessRegistry,
  type ReadinessResult,
} from '../../monitoring/readiness.js';
import { getPrometheusExporter } from '../../telemetry/metrics.js';

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
   * Retained for configuration compatibility. The transport now always speaks
   * stateless Streamable HTTP (no standalone SSE channel), so `GET /mcp` returns
   * 405 regardless of this flag — required by Gemini Enterprise custom MCP
   * connectors, which only support Streamable HTTP and reject SSE.
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
  /**
   * Registry backing `/readiness` and `/health/ready`. Defaults to the
   * process-wide registry, so server bootstrap can register dependency probes
   * (see `registerBigQueryReadinessProbe`) without threading them through here.
   */
  readiness: ReadinessRegistry;
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
  readiness: readinessRegistry,
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
 * Opaque per-request context produced by the {@link AuthResolver}. The
 * principal + tenant context are attached to the request as MCP `AuthInfo` so
 * the SDK transport threads them to request handlers via `extra.authInfo`.
 */
export interface McpRequestContext {
  principal?: unknown;
  tenantContext?: unknown;
}

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
 * Returns a fresh, MCP `Server` with all request handlers registered, ready to
 * be connected to a transport. The transport runs in stateless mode and calls
 * this once per request (a stateless transport may not be reused across
 * requests — doing so risks JSON-RPC id collisions between clients).
 */
export type ServerProvider = () => Server;

/** Minimal MCP token shape attached to the request for the SDK transport. */
type RequestWithAuth = IncomingMessage & { auth?: AuthInfo };

/**
 * Streamable HTTP transport for production Cloud Run deployment.
 *
 * Built on the official `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`
 * in **stateless mode**: a fresh `Server` + transport is created per request and
 * torn down when the response closes. This keeps the service horizontally
 * scalable on Cloud Run (no sticky sessions) and delegates protocol concerns —
 * `MCP-Protocol-Version` header validation, version negotiation, rejection of
 * JSON-RPC batches (removed in spec 2025-06-18), and per-request SSE — to the SDK.
 *
 * Provides:
 * - `POST /mcp`  MCP Streamable HTTP endpoint (single JSON-RPC request/response)
 * - `GET/DELETE /mcp`  405 (no standalone SSE / sessions in stateless mode)
 * - `GET /health`, `/health/live`  liveness probe (dependency-free, always 200
 *   while the process can run code — a failure here restarts the container)
 * - `GET /readiness`, `/health/ready`  readiness probe (503 + failing check
 *   names when a registered dependency probe fails)
 * - `GET /metrics`  Prometheus scrape endpoint, serving the OpenTelemetry
 *   Prometheus exporter's registry in text exposition format
 * - `GET /.well-known/oauth-*`  RFC 8414 + RFC 9728 discovery
 * - Host allow-list (DNS-rebinding defense), CORS/Origin enforcement, security
 *   headers, request-id injection, and graceful shutdown with in-flight drain.
 */
export class StreamableHttpTransport {
  private readonly config: HttpTransportConfig;
  private readonly serverProvider: ServerProvider;
  private readonly authResolver?: AuthResolver;
  private readonly app: express.Application;
  private server: HttpServer | null = null;

  // Counters
  private activeConnections = 0;
  private totalRequests = 0;
  private totalErrors = 0;

  constructor(
    serverProvider: ServerProvider,
    config?: Partial<HttpTransportConfig>,
    authResolver?: AuthResolver
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.serverProvider = serverProvider;
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
          mode: 'stateless',
        });
        resolve();
      });
    });
  }

  /**
   * Gracefully shut down: stop accepting new connections and drain in-flight
   * requests. Per-request MCP transports/servers close on their own response's
   * `close` event, so there is no session/SSE registry to tear down.
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down HTTP transport', { activeConnections: this.activeConnections });

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
    // MCP spec 2025-11-25 §Transports: reject disallowed origins with HTTP 403.
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
        res.setHeader('Access-Control-Allow-Methods', 'POST, GET, DELETE, OPTIONS');
        res.setHeader(
          'Access-Control-Allow-Headers',
          'Content-Type, Authorization, Mcp-Session-Id, MCP-Protocol-Version'
        );
        res.setHeader('Access-Control-Expose-Headers', 'Mcp-Session-Id, MCP-Protocol-Version');
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
    // --- Liveness probe + deployment alias ---
    // Deliberately dependency-free: reaching this handler proves the event loop
    // is turning and the process can serve HTTP, which is all liveness should
    // assert. Failing liveness restarts the container, so a BigQuery outage
    // must NOT surface here — it belongs on readiness, which merely drains the
    // instance from the load balancer and self-heals when BigQuery recovers.
    const handleLiveness = (_req: Request, res: Response): void => {
      res.setHeader('Cache-Control', 'no-store');
      res.json({
        status: 'healthy',
        uptimeSeconds: Math.floor(process.uptime()),
        timestamp: new Date().toISOString(),
      });
    };

    // --- Readiness probe + deployment alias ---
    const handleReadiness = (_req: Request, res: Response): void => {
      void this.respondReadiness(res);
    };

    app.get('/health', handleLiveness);
    app.get('/health/live', handleLiveness);
    app.get('/readiness', handleReadiness);
    app.get('/health/ready', handleReadiness);

    // --- Prometheus metrics ---
    app.get('/metrics', (req: Request, res: Response) => {
      this.handleMetrics(req, res);
    });

    // --- OAuth 2.0 discovery (RFC 8414 + RFC 9728) ---
    this.registerOAuthDiscoveryRoutes(app);

    // Rate-limit the MCP endpoint — transport-layer defense-in-depth on top of
    // the app-level SecurityMiddleware, and satisfies CodeQL
    // js/missing-rate-limiting (this route performs authorization).
    const mcpLimiter = rateLimit({
      windowMs: 60_000,
      max: Number(process.env.MCP_HTTP_RATE_LIMIT_MAX ?? 600),
      standardHeaders: true,
      legacyHeaders: false,
    });

    // --- MCP Streamable HTTP endpoint (POST) ---
    app.post('/mcp', mcpLimiter, (req: Request, res: Response) => {
      void this.handleMcpPost(req, res);
    });

    // --- GET/DELETE /mcp: no standalone SSE / sessions in stateless mode ---
    const methodNotAllowed = (_req: Request, res: Response): void => {
      res.setHeader('Allow', 'POST');
      res.status(405).json({
        error: 'method_not_allowed',
        error_description:
          'This server uses stateless Streamable HTTP (no SSE channel or sessions). Use POST /mcp.',
      });
    };
    app.get('/mcp', mcpLimiter, methodNotAllowed);
    app.delete('/mcp', mcpLimiter, methodNotAllowed);

    const endpoints = [
      '/health',
      '/health/live',
      '/readiness',
      '/health/ready',
      '/metrics',
      'POST /mcp',
      'GET|DELETE /mcp (405 — stateless Streamable HTTP)',
    ];
    if (this.config.oauthMetadata) {
      endpoints.push(
        'GET /.well-known/oauth-authorization-server',
        'GET /.well-known/oauth-protected-resource'
      );
    }

    logger.info('HTTP transport routes registered', {
      endpoints,
      oauthDiscovery: !!this.config.oauthMetadata,
    });
  }

  /**
   * Evaluate registered readiness probes and answer the probe request.
   *
   * Ready responses are 200; a failed dependency yields 503 with the failing
   * check names and their causes, so an operator (or an incident dashboard)
   * can tell *why* an instance left the load balancer without reading logs.
   *
   * When no probes are registered the server has no dependency to report on and
   * answers 200 — but says so explicitly in `note` rather than implying that
   * dependencies were verified.
   */
  private async respondReadiness(res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');

    const registry = this.config.readiness;

    if (registry.size === 0) {
      res.status(200).json({
        ready: true,
        checks: [],
        note: 'No readiness probes registered; dependency health is unverified.',
        timestamp: new Date().toISOString(),
      });
      return;
    }

    // `check()` absorbs probe failures and timeouts into the result, so a
    // throw here would mean the registry itself is broken — still not-ready.
    let result: ReadinessResult;
    try {
      result = await registry.check();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error('Readiness evaluation failed', { error: message });
      res.status(503).json({
        ready: false,
        checks: [],
        failed: ['readiness-evaluation'],
        error: message,
        timestamp: new Date().toISOString(),
      });
      return;
    }

    const failed = result.checks.filter((check) => !check.ok);

    if (!result.ready) {
      logger.warn('Readiness probe reporting not ready', {
        failed: failed.map((check) => check.name),
      });
    }

    res.status(result.ready ? 200 : 503).json({
      ready: result.ready,
      checks: result.checks,
      failed: failed.map((check) => check.name),
      cached: result.cached,
      timestamp: result.checkedAt,
    });
  }

  /**
   * Serve the OpenTelemetry Prometheus exporter's registry in Prometheus text
   * exposition format (`text/plain; version=0.0.4`).
   *
   * The exporter is constructed with `preventServerStart: true` so it does not
   * bind its own port; this route is the mount point it expects. Metric
   * definitions live in the telemetry layer — this endpoint only exposes them.
   *
   * Before telemetry is initialised there is no registry to scrape, which is a
   * scrape failure rather than an empty result, so it answers 503.
   */
  private handleMetrics(req: Request, res: Response): void {
    // Guarded: some test suites mock the telemetry module without this export.
    const exporter = typeof getPrometheusExporter === 'function' ? getPrometheusExporter() : null;

    if (!exporter) {
      res
        .status(503)
        .type('text/plain; version=0.0.4; charset=utf-8')
        .send('# Prometheus metrics unavailable: telemetry is not initialised\n');
      return;
    }

    exporter.getMetricsRequestHandler(req as IncomingMessage, res as ServerResponse);
  }

  /**
   * Authenticate (if configured), then hand the request to a fresh stateless
   * SDK Streamable HTTP transport bound to a fresh MCP Server. The resolved
   * principal + tenant context are attached as MCP `AuthInfo` so request
   * handlers receive them via `extra.authInfo`. The inbound token is used only
   * to authenticate/resolve tenancy — it is never forwarded to BigQuery.
   */
  private async handleMcpPost(req: Request, res: Response): Promise<void> {
    this.totalRequests++;

    // Authentication / tenant resolution (when an auth resolver is wired).
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
      if (resolution.context) {
        const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
        const principal = resolution.context.principal as
          | { subject?: string; scopes?: string[] }
          | undefined;
        (req as RequestWithAuth).auth = {
          token,
          clientId: principal?.subject ?? 'mcp-client',
          scopes: principal?.scopes ?? [],
          extra: {
            principal: resolution.context.principal,
            tenantContext: resolution.context.tenantContext,
          },
        };
      }
    }

    // Stateless mode: a fresh Server + transport per request, torn down when
    // the response closes. The SDK owns protocol-version validation, version
    // negotiation, batch rejection, and (per-request) SSE streaming.
    const server = this.serverProvider();
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      // Return a single JSON-RPC response (Content-Type: application/json)
      // rather than opening an SSE stream — this server's tools are
      // request/response and clients expect a direct reply.
      enableJsonResponse: true,
    });

    const cleanup = (): void => {
      void transport.close();
      void server.close();
    };
    res.on('close', cleanup);

    try {
      await server.connect(transport);
      await transport.handleRequest(req as RequestWithAuth, res as ServerResponse, req.body);
    } catch (error) {
      this.totalErrors++;
      const message = error instanceof Error ? error.message : String(error);
      logger.error('MCP request handling failed', { error: message });
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: '2.0',
          id: null,
          error: { code: -32603, message: 'Internal server error' },
        });
      }
    }
  }

  /**
   * Register OAuth 2.0 discovery endpoints when metadata is configured.
   *
   * - `/.well-known/oauth-authorization-server` (RFC 8414)
   * - `/.well-known/oauth-protected-resource`   (RFC 9728)
   *
   * Required by the MCP 2025-11-25 auth flow and by Gemini Enterprise custom MCP
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
}
