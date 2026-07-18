import { BigQueryClient, BigQueryClientInputConfig } from '../bigquery/client.js';
import { logger } from '../utils/logger.js';
import { EventEmitter } from 'events';

/**
 * BigQuery Client Factory Configuration
 */
export interface BigQueryClientFactoryConfig {
  defaultProjectId?: string;
  defaultLocation?: string;
  defaultKeyFilename?: string;
  defaultCredentials?: Record<string, unknown>;
  pooling: {
    enabled: boolean;
    minConnections?: number;
    maxConnections?: number;
    acquireTimeoutMs?: number;
    idleTimeoutMs?: number;
  };
  caching: {
    enabled: boolean;
    cacheSize?: number;
    cacheTTLMs?: number;
  };
  retry: {
    enabled: boolean;
    maxRetries?: number;
    initialDelayMs?: number;
  };
  monitoring: {
    enabled: boolean;
    healthCheckIntervalMs?: number;
  };
}

/**
 * Client Instance Metadata
 */
interface ClientMetadata {
  client: BigQueryClient;
  projectId: string;
  createdAt: Date;
  lastUsedAt: Date;
  queryCount: number;
  errorCount: number;
}

/**
 * BigQuery Client Factory Error
 */
export class ClientFactoryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ClientFactoryError';
  }
}

/**
 * BigQuery Client Factory
 *
 * Manages BigQuery client instances with:
 * - Connection pooling
 * - Client caching per project
 * - Automatic health monitoring
 * - Metrics tracking
 */
export class BigQueryClientFactory extends EventEmitter {
  private config: BigQueryClientFactoryConfig;
  private clients: Map<string, ClientMetadata> = new Map();
  private healthCheckInterval?: NodeJS.Timeout;
  private isShuttingDown = false;

  constructor(config: BigQueryClientFactoryConfig) {
    super();
    this.config = this.validateConfig(config);

    if (this.config.monitoring.enabled) {
      this.startHealthMonitoring();
    }

    logger.info('BigQuery Client Factory initialized', {
      pooling: this.config.pooling.enabled,
      caching: this.config.caching.enabled,
    });
  }

  private validateConfig(config: BigQueryClientFactoryConfig): BigQueryClientFactoryConfig {
    return {
      ...config,
      pooling: {
        enabled: config.pooling.enabled ?? true,
        minConnections: config.pooling.minConnections ?? 2,
        maxConnections: config.pooling.maxConnections ?? 10,
        acquireTimeoutMs: config.pooling.acquireTimeoutMs ?? 30000,
        idleTimeoutMs: config.pooling.idleTimeoutMs ?? 300000,
      },
      caching: {
        enabled: config.caching.enabled ?? true,
        cacheSize: config.caching.cacheSize ?? 100,
        cacheTTLMs: config.caching.cacheTTLMs ?? 3600000,
      },
      retry: {
        enabled: config.retry.enabled ?? true,
        maxRetries: config.retry.maxRetries ?? 3,
        initialDelayMs: config.retry.initialDelayMs ?? 1000,
      },
      monitoring: {
        enabled: config.monitoring.enabled ?? true,
        healthCheckIntervalMs: config.monitoring.healthCheckIntervalMs ?? 60000,
      },
    };
  }

  /**
   * Get or create BigQuery client for a project
   */
  public getClient(projectId?: string): BigQueryClient {
    if (this.isShuttingDown) {
      throw new ClientFactoryError(
        'Cannot get client: factory is shutting down',
        'FACTORY_SHUTDOWN'
      );
    }

    const targetProjectId = projectId || this.config.defaultProjectId;

    if (!targetProjectId) {
      throw new ClientFactoryError(
        'No project ID specified and no default configured',
        'NO_PROJECT_ID'
      );
    }

    // Check if client exists and is healthy
    const existingClient = this.clients.get(targetProjectId);
    if (existingClient && existingClient.client.isHealthy()) {
      existingClient.lastUsedAt = new Date();
      existingClient.queryCount++;

      logger.debug('Reusing existing BigQuery client', { projectId: targetProjectId });
      return existingClient.client;
    }

    // Create new client
    return this.createClient(targetProjectId);
  }

  /**
   * Create new BigQuery client instance
   */
  private createClient(projectId: string): BigQueryClient {
    try {
      logger.info('Creating new BigQuery client', { projectId });

      const clientConfig: BigQueryClientInputConfig = {
        projectId,
        keyFilename: this.config.defaultKeyFilename,
        credentials: this.config.defaultCredentials,
        connectionPool: this.config.pooling.enabled
          ? {
              minConnections: this.config.pooling.minConnections!,
              maxConnections: this.config.pooling.maxConnections!,
              acquireTimeoutMs: this.config.pooling.acquireTimeoutMs!,
              idleTimeoutMs: this.config.pooling.idleTimeoutMs!,
              healthCheckIntervalMs: 60000,
              maxRetries: 3,
              retryDelayMs: 1000,
            }
          : undefined,
        datasetManager: this.config.caching.enabled
          ? {
              cacheSize: this.config.caching.cacheSize!,
              cacheTTLMs: this.config.caching.cacheTTLMs!,
              autoDiscovery: true,
              discoveryIntervalMs: 300000,
            }
          : undefined,
        retry: this.config.retry.enabled
          ? {
              maxRetries: this.config.retry.maxRetries!,
              initialDelayMs: this.config.retry.initialDelayMs!,
              maxDelayMs: 32000,
              backoffMultiplier: 2,
              retryableErrors: [
                'ECONNRESET',
                'ETIMEDOUT',
                'ENOTFOUND',
                'RATE_LIMIT_EXCEEDED',
                'BACKEND_ERROR',
              ],
            }
          : undefined,
        queryDefaults: {
          useLegacySql: false,
          location: this.config.defaultLocation,
        },
      };

      const client = new BigQueryClient(clientConfig);

      // Forward client events
      this.forwardClientEvents(client, projectId);

      // Store client metadata
      const metadata: ClientMetadata = {
        client,
        projectId,
        createdAt: new Date(),
        lastUsedAt: new Date(),
        queryCount: 0,
        errorCount: 0,
      };

      this.clients.set(projectId, metadata);

      this.emit('client:created', { projectId });

      return client;
    } catch (error) {
      logger.error('Failed to create BigQuery client', { projectId, error });

      throw new ClientFactoryError(
        `Failed to create client for project ${projectId}`,
        'CLIENT_CREATE_ERROR',
        error
      );
    }
  }

  /**
   * Forward client events to factory
   */
  private forwardClientEvents(client: BigQueryClient, projectId: string): void {
    client.on('query:started', (data: unknown) => {
      const eventData = data as Record<string, unknown>;
      this.emit('query:started', { projectId, ...eventData });
    });

    client.on('query:completed', (data: unknown) => {
      const eventData = data as Record<string, unknown>;
      this.emit('query:completed', { projectId, ...eventData });
    });

    client.on('error', (error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error));
      const metadata = this.clients.get(projectId);
      if (metadata) {
        metadata.errorCount++;
      }
      this.emit('client:error', { projectId, error: err });
    });

    client.on('cache:hit', (data: unknown) => {
      const eventData = data as Record<string, unknown>;
      this.emit('cache:hit', { projectId, ...eventData });
    });

    client.on('cache:miss', (data: unknown) => {
      const eventData = data as Record<string, unknown>;
      this.emit('cache:miss', { projectId, ...eventData });
    });
  }

  /**
   * Remove client for a project
   */
  public async removeClient(projectId: string): Promise<void> {
    const metadata = this.clients.get(projectId);

    if (!metadata) {
      logger.warn('Attempted to remove non-existent client', { projectId });
      return;
    }

    try {
      await metadata.client.shutdown();
      this.clients.delete(projectId);

      this.emit('client:removed', { projectId });
      logger.info('Removed BigQuery client', { projectId });
    } catch (error) {
      logger.error('Error removing client', { projectId, error });
      throw new ClientFactoryError(
        `Failed to remove client for project ${projectId}`,
        'CLIENT_REMOVE_ERROR',
        error
      );
    }
  }

  /**
   * Start health monitoring for all clients
   */
  private startHealthMonitoring(): void {
    if (!this.config.monitoring.healthCheckIntervalMs) {
      return;
    }

    this.healthCheckInterval = setInterval(() => {
      this.performHealthCheck().catch((error: unknown) => {
        const err = error instanceof Error ? error : new Error(String(error));
        logger.error('Health check error', { error: err.message });
      });
    }, this.config.monitoring.healthCheckIntervalMs);
    // A background health sweep must never be the reason the process stays
    // alive. Without this, every factory that is constructed but not shut down
    // pins the event loop for its full interval — which is why Jest reported
    // "A worker process has failed to exit gracefully". Matches ConnectionPool,
    // MCPServerFactory and DatasetManager, all of which already unref.
    if (typeof this.healthCheckInterval.unref === 'function') {
      this.healthCheckInterval.unref();
    }

    logger.info('Health monitoring started', {
      intervalMs: this.config.monitoring.healthCheckIntervalMs,
    });
  }

  /**
   * Perform health check on all clients
   */
  private async performHealthCheck(): Promise<void> {
    // Announce each sweep so consumers can observe that monitoring is alive
    // (and that it stops on shutdown), mirroring MCPServerFactory.
    this.emit('health:check', { clientCount: this.clients.size });

    const checks = Array.from(this.clients.entries()).map(async ([projectId, metadata]) => {
      try {
        const healthy = metadata.client.isHealthy();

        if (!healthy) {
          logger.warn('Unhealthy client detected', {
            projectId,
            errorCount: metadata.errorCount,
          });

          this.emit('client:unhealthy', { projectId, metadata });

          // Remove unhealthy clients
          if (metadata.errorCount > 5) {
            await this.removeClient(projectId);
          }
        } else {
          this.emit('client:healthy', { projectId });
        }
      } catch (error) {
        logger.error('Health check failed', { projectId, error });
        this.emit('health:check:error', { projectId, error });
      }
    });

    await Promise.allSettled(checks);
  }

  /**
   * Get factory metrics
   */
  public getMetrics() {
    const clientMetrics = Array.from(this.clients.entries()).map(([projectId, metadata]) => ({
      projectId,
      queryCount: metadata.queryCount,
      errorCount: metadata.errorCount,
      uptime: Date.now() - metadata.createdAt.getTime(),
      lastUsed: Date.now() - metadata.lastUsedAt.getTime(),
      poolMetrics: metadata.client.getPoolMetrics(),
      cacheStats: metadata.client.getCacheStats(),
    }));

    return {
      totalClients: this.clients.size,
      clients: clientMetrics,
      config: {
        pooling: this.config.pooling.enabled,
        caching: this.config.caching.enabled,
        monitoring: this.config.monitoring.enabled,
      },
    };
  }

  /**
   * Get all active clients
   */
  public getActiveClients(): string[] {
    return Array.from(this.clients.keys());
  }

  /**
   * Check if factory has client for project
   */
  public hasClient(projectId: string): boolean {
    return this.clients.has(projectId);
  }

  /**
   * Invalidate cache for all clients
   */
  public invalidateAllCaches(pattern?: string): void {
    for (const [projectId, metadata] of this.clients.entries()) {
      metadata.client.invalidateCache(pattern);
      logger.info('Cache invalidated', { projectId, pattern });
    }

    this.emit('cache:invalidated', { pattern });
  }

  /**
   * Shutdown factory and all clients
   */
  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.emit('shutdown:started');

    logger.info('Shutting down BigQuery Client Factory');

    // Stop health monitoring
    if (this.healthCheckInterval) {
      clearInterval(this.healthCheckInterval);
      this.healthCheckInterval = undefined;
    }

    // Shutdown all clients
    const shutdownPromises = Array.from(this.clients.keys()).map((projectId) =>
      this.removeClient(projectId)
    );

    await Promise.allSettled(shutdownPromises);

    this.emit('shutdown:completed');
    logger.info('BigQuery Client Factory shutdown complete');
  }

  /**
   * Check if factory is healthy
   */
  public isHealthy(): boolean {
    if (this.isShuttingDown) {
      return false;
    }

    // Factory is healthy if at least one client is healthy
    for (const metadata of this.clients.values()) {
      if (metadata.client.isHealthy()) {
        return true;
      }
    }

    return this.clients.size === 0; // Empty factory is considered healthy
  }
}
