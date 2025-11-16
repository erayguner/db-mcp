import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';
import { EventEmitter } from 'events';

// Zod schemas for validation
export const ConnectionPoolConfigSchema = z.object({
  minConnections: z.number().min(1).default(2),
  maxConnections: z.number().min(1).default(10),
  acquireTimeoutMs: z.number().min(100).default(30000),
  idleTimeoutMs: z.number().min(1000).default(300000),
  healthCheckIntervalMs: z.number().min(1000).default(60000),
  maxRetries: z.number().min(0).default(3),
  retryDelayMs: z.number().min(100).default(1000),
  projectId: z.string().optional(),
  keyFilename: z.string().optional(),
  credentials: z.any().optional(),
});

export type ConnectionPoolConfig = z.infer<typeof ConnectionPoolConfigSchema>;

export interface PoolMetrics {
  totalConnections: number;
  activeConnections: number;
  idleConnections: number;
  waitingRequests: number;
  totalAcquired: number;
  totalReleased: number;
  totalFailed: number;
  totalTimeouts: number;
  averageAcquireTimeMs: number;
  uptime: number;
}

interface PooledConnection {
  client: BigQuery;
  id: string;
  createdAt: Date;
  lastUsedAt: Date;
  inUse: boolean;
  failureCount: number;
  queryCount: number;
}

interface AcquireRequest {
  resolve: (connection: PooledConnection) => void;
  reject: (error: Error) => void;
  requestedAt: Date;
  timeoutHandle?: NodeJS.Timeout;
}

export class ConnectionPoolError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ConnectionPoolError';
  }
}

export class ConnectionPool extends EventEmitter {
  private config: Required<ConnectionPoolConfig>;
  private connections: Map<string, PooledConnection> = new Map();
  private waitingQueue: AcquireRequest[] = [];
  private healthCheckInterval?: NodeJS.Timeout;
  private isShuttingDown = false;
  private startTime: Date;

  // Metrics
  private metrics = {
    totalAcquired: 0,
    totalReleased: 0,
    totalFailed: 0,
    totalTimeouts: 0,
    acquireTimes: [] as number[],
  };

  constructor(config: ConnectionPoolConfig) {
    super();
    this.config = ConnectionPoolConfigSchema.parse(config) as Required<ConnectionPoolConfig>;
    this.startTime = new Date();
    this.initialize();
  }

  private async initialize(): Promise<void> {
    try {
      // Create minimum connections
      for (let i = 0; i < this.config.minConnections; i++) {
        await this.createConnection();
      }

      // Start health check interval
      this.startHealthCheck();

      this.emit('initialized', {
        minConnections: this.config.minConnections,
        maxConnections: this.config.maxConnections,
      });
    } catch (error) {
      this.emit('error', new ConnectionPoolError(
        'Failed to initialize connection pool',
        'INIT_ERROR',
        error
      ));
      throw error;
    }
  }

  private async createConnection(): Promise<PooledConnection> {
    const connectionId = `conn_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

    try {
      const client = new BigQuery({
        projectId: this.config.projectId,
        keyFilename: this.config.keyFilename,
        credentials: this.config.credentials,
      });

      const connection: PooledConnection = {
        client,
        id: connectionId,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        inUse: false,
        failureCount: 0,
        queryCount: 0,
      };

      this.connections.set(connectionId, connection);
      this.emit('connection:created', { id: connectionId });

      return connection;
    } catch (error) {
      this.emit('error', new ConnectionPoolError(
        `Failed to create connection ${connectionId}`,
        'CREATE_ERROR',
        error
      ));
      throw error;
    }
  }

  public async acquire(): Promise<BigQuery> {
    if (this.isShuttingDown) {
      throw new ConnectionPoolError(
        'Cannot acquire connection: pool is shutting down',
        'POOL_SHUTDOWN'
      );
    }

    const startTime = Date.now();

    return new Promise<BigQuery>((resolve, reject) => {
      const request: AcquireRequest = {
        resolve: (connection: PooledConnection) => {
          const acquireTime = Date.now() - startTime;
          this.metrics.acquireTimes.push(acquireTime);
          if (this.metrics.acquireTimes.length > 100) {
            this.metrics.acquireTimes.shift();
          }
          this.metrics.totalAcquired++;

          connection.inUse = true;
          connection.lastUsedAt = new Date();
          connection.queryCount++;

          this.emit('connection:acquired', {
            id: connection.id,
            acquireTimeMs: acquireTime
          });

          resolve(connection.client);
        },
        reject: (error: Error) => {
          this.metrics.totalFailed++;
          this.emit('connection:acquire:failed', { error });
          reject(error);
        },
        requestedAt: new Date(),
      };

      // Set timeout for acquire request
      request.timeoutHandle = setTimeout(() => {
        const index = this.waitingQueue.indexOf(request);
        if (index !== -1) {
          this.waitingQueue.splice(index, 1);
          this.metrics.totalTimeouts++;
          request.reject(new ConnectionPoolError(
            `Connection acquisition timeout after ${this.config.acquireTimeoutMs}ms`,
            'ACQUIRE_TIMEOUT'
          ));
        }
      }, this.config.acquireTimeoutMs);

      // Try to get an available connection
      this.processAcquireRequest(request);
    });
  }

  private async processAcquireRequest(request: AcquireRequest): Promise<void> {
    // Check for idle connections
    const idleConnection = Array.from(this.connections.values()).find(
      conn => !conn.inUse && conn.failureCount < this.config.maxRetries
    );

    if (idleConnection) {
      if (request.timeoutHandle) {
        clearTimeout(request.timeoutHandle);
      }
      request.resolve(idleConnection);
      return;
    }

    // Create new connection if under max limit
    if (this.connections.size < this.config.maxConnections) {
      try {
        const newConnection = await this.createConnection();
        if (request.timeoutHandle) {
          clearTimeout(request.timeoutHandle);
        }
        request.resolve(newConnection);
        return;
      } catch (error) {
        request.reject(error as Error);
        return;
      }
    }

    // Add to waiting queue
    this.waitingQueue.push(request);
    this.emit('connection:queued', {
      queueLength: this.waitingQueue.length
    });
  }

  public release(client: BigQuery): void {
    const connection = Array.from(this.connections.values()).find(
      conn => conn.client === client
    );

    if (!connection) {
      this.emit('warning', new ConnectionPoolError(
        'Attempted to release unknown connection',
        'UNKNOWN_CONNECTION'
      ));
      return;
    }

    connection.inUse = false;
    connection.lastUsedAt = new Date();
    this.metrics.totalReleased++;

    this.emit('connection:released', { id: connection.id });

    // Process waiting requests
    if (this.waitingQueue.length > 0) {
      const nextRequest = this.waitingQueue.shift();
      if (nextRequest) {
        if (nextRequest.timeoutHandle) {
          clearTimeout(nextRequest.timeoutHandle);
        }
        nextRequest.resolve(connection);
      }
    }

    // Remove excess idle connections
    this.cleanupIdleConnections();
  }

  private cleanupIdleConnections(): void {
    const now = Date.now();
    const idleConnections = Array.from(this.connections.values()).filter(
      conn => !conn.inUse &&
      now - conn.lastUsedAt.getTime() > this.config.idleTimeoutMs
    );

    const excessConnections = this.connections.size - this.config.minConnections;
    const toRemove = Math.min(idleConnections.length, Math.max(0, excessConnections));

    for (let i = 0; i < toRemove; i++) {
      const conn = idleConnections[i];
      this.connections.delete(conn.id);
      this.emit('connection:removed', {
        id: conn.id,
        reason: 'idle_timeout'
      });
    }
  }

  private startHealthCheck(): void {
    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);
  }

  private async performHealthCheck(): Promise<void> {
    const healthChecks = Array.from(this.connections.values()).map(async (conn) => {
      if (conn.inUse) {
        return; // Skip connections in use
      }

      try {
        // Simple health check query
        await conn.client.query({
          query: 'SELECT 1',
          dryRun: true,
        });

        conn.failureCount = 0;
        this.emit('health:check:success', { id: conn.id });
      } catch (error) {
        conn.failureCount++;
        this.emit('health:check:failed', {
          id: conn.id,
          failureCount: conn.failureCount,
          error
        });

        // Remove connection if it has exceeded max retries
        if (conn.failureCount >= this.config.maxRetries) {
          this.connections.delete(conn.id);
          this.emit('connection:removed', {
            id: conn.id,
            reason: 'health_check_failed'
          });

          // Create replacement if below minimum
          if (this.connections.size < this.config.minConnections) {
            try {
              await this.createConnection();
            } catch (createError) {
              this.emit('error', new ConnectionPoolError(
                'Failed to create replacement connection',
                'REPLACEMENT_ERROR',
                createError
              ));
            }
          }
        }
      }
    });

    await Promise.allSettled(healthChecks);
  }

  public getMetrics(): PoolMetrics {
    const activeConnections = Array.from(this.connections.values()).filter(
      conn => conn.inUse
    ).length;

    const averageAcquireTime = this.metrics.acquireTimes.length > 0
      ? this.metrics.acquireTimes.reduce((a, b) => a + b, 0) / this.metrics.acquireTimes.length
      : 0;

    return {
      totalConnections: this.connections.size,
      activeConnections,
      idleConnections: this.connections.size - activeConnections,
      waitingRequests: this.waitingQueue.length,
      totalAcquired: this.metrics.totalAcquired,
      totalReleased: this.metrics.totalReleased,
      totalFailed: this.metrics.totalFailed,
      totalTimeouts: this.metrics.totalTimeouts,
      averageAcquireTimeMs: averageAcquireTime,
      uptime: Date.now() - this.startTime.getTime(),
    };
  }

  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.emit('shutdown:started');

    // Stop health checks
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
    }

    // Reject all waiting requests
    for (const request of this.waitingQueue) {
      if (request.timeoutHandle) {
        clearTimeout(request.timeoutHandle);
      }
      request.reject(new ConnectionPoolError(
        'Pool is shutting down',
        'POOL_SHUTDOWN'
      ));
    }
    this.waitingQueue = [];

    // Wait for active connections to be released (with timeout)
    const shutdownTimeout = 30000; // 30 seconds
    const startShutdown = Date.now();

    while (this.hasActiveConnections() && Date.now() - startShutdown < shutdownTimeout) {
      await new Promise(resolve => setTimeout(resolve, 100));
    }

    // Clear all connections
    this.connections.clear();

    this.emit('shutdown:completed');
  }

  private hasActiveConnections(): boolean {
    return Array.from(this.connections.values()).some(conn => conn.inUse);
  }

  public isHealthy(): boolean {
    return !this.isShuttingDown &&
           this.connections.size >= this.config.minConnections &&
           this.connections.size <= this.config.maxConnections;
  }
}
