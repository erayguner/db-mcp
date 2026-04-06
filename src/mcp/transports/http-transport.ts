import express, { Request, Response, NextFunction } from 'express';
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
});

/**
 * Configuration for the Streamable HTTP transport.
 */
export interface HttpTransportConfig {
  port: number;
  host: string;
  corsOrigins: string[];
  enableCompression: boolean;
  maxRequestBodyBytes: number;
}

/** Default configuration values. */
const DEFAULT_CONFIG: HttpTransportConfig = {
  port: 8080,
  host: '0.0.0.0',
  corsOrigins: [],
  enableCompression: true,
  maxRequestBodyBytes: 1_048_576, // 1 MiB
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
  private readonly handler: (request: JsonRpcRequest) => Promise<JsonRpcResponse>;
  private readonly app: express.Application;
  private server: HttpServer | null = null;
  private sseClients: Map<string, SseClient> = new Map();

  // Counters
  private activeConnections = 0;
  private totalRequests = 0;
  private totalErrors = 0;

  constructor(
    handler: (request: JsonRpcRequest) => Promise<JsonRpcResponse>,
    config?: Partial<HttpTransportConfig>,
  ) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.handler = handler;
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

    // --- CORS ---
    app.use((req: Request, res: Response, next: NextFunction) => {
      const origin = req.headers.origin;
      if (
        origin &&
        (this.config.corsOrigins.includes('*') || this.config.corsOrigins.includes(origin))
      ) {
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
    // Health / readiness probes
    app.get('/health', (_req: Request, res: Response) => {
      res.json({ status: 'healthy', timestamp: new Date().toISOString() });
    });

    app.get('/readiness', (_req: Request, res: Response) => {
      res.json({ ready: true, timestamp: new Date().toISOString() });
    });

    // Prometheus metrics
    app.get('/metrics', (_req: Request, res: Response) => {
      res.json({ message: 'Metrics available via OpenTelemetry exporter', activeConnections: this?.activeConnections ?? 0 });
    });

    // --- MCP JSON-RPC endpoint (POST) ---
    app.post('/mcp', (req: Request, res: Response) => {
      void this.handleJsonRpcPost(req, res);
    });

    // --- MCP SSE stream (GET) ---
    app.get('/mcp', (req: Request, res: Response) => {
      this.handleSseConnect(req, res);
    });

    logger.info('HTTP transport routes registered', {
      endpoints: ['/health', '/readiness', '/metrics', 'POST /mcp', 'GET /mcp'],
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

    try {
      let responses: JsonRpcResponse[];

      if (isBatchRequest(req.body)) {
        responses = await processBatch(validation.requests, this.handler);
      } else {
        // Single request — still use the first validated request
        const single = await this.handler(validation.requests[0]);
        responses = [single];
      }

      // If the incoming body was a single object, return a single response.
      const body = isBatchRequest(req.body) ? responses : responses[0];
      const serialized = JSON.stringify(body);

      // Optional gzip compression
      const acceptsGzip = (req.headers['accept-encoding'] ?? '').includes('gzip');
      if (
        this.config.enableCompression &&
        acceptsGzip &&
        shouldCompress(serialized)
      ) {
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

