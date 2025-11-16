import { EventEmitter } from 'events';
import { ConnectionPool } from '../bigquery/connection-pool.js';
import { DatasetManager } from '../bigquery/dataset-manager.js';
import { WorkloadIdentityFederation } from '../auth/workload-identity.js';
import { QueryMetricsTracker } from '../bigquery/query-metrics.js';
import { logger } from '../utils/logger.js';

/**
 * Health Check Status
 */
export enum HealthStatus {
  HEALTHY = 'healthy',
  DEGRADED = 'degraded',
  UNHEALTHY = 'unhealthy',
}

/**
 * Health Check Result
 */
export interface HealthCheckResult {
  status: HealthStatus;
  message: string;
  details?: Record<string, unknown>;
  timestamp: number;
  duration?: number;
}

/**
 * Component Health
 */
export interface ComponentHealth {
  name: string;
  status: HealthStatus;
  checks: Record<string, HealthCheckResult>;
  lastCheck: number;
}

/**
 * System Health Report
 */
export interface SystemHealthReport {
  status: HealthStatus;
  timestamp: number;
  uptime: number;
  components: ComponentHealth[];
  metrics: {
    totalChecks: number;
    healthyChecks: number;
    degradedChecks: number;
    unhealthyChecks: number;
  };
  version: string;
}

/**
 * Readiness Check Result
 */
export interface ReadinessCheckResult {
  ready: boolean;
  components: Record<string, boolean>;
  timestamp: number;
}

/**
 * Liveness Check Result
 */
export interface LivenessCheckResult {
  alive: boolean;
  timestamp: number;
  uptime: number;
}

/**
 * Health Monitor Configuration
 */
export interface HealthMonitorConfig {
  checkInterval: number;
  enableAutoChecks: boolean;
  connectionPoolThresholds: {
    minHealthyConnections: number;
    maxWaitingRequests: number;
    maxFailureRate: number;
  };
  cacheThresholds: {
    minHitRate: number;
    maxEvictionRate: number;
  };
  queryThresholds: {
    maxErrorRate: number;
    maxAverageLatency: number;
  };
  wifTokenThresholds: {
    minTokenLifetime: number;
  };
}

/**
 * Comprehensive Health Monitor for BigQuery MCP Server
 *
 * Features:
 * - Connection pool health monitoring
 * - Dataset manager cache health
 * - WIF token validation
 * - Query performance tracking
 * - Readiness and liveness probes
 * - Performance metrics
 * - Alert integration
 */
export class HealthMonitor extends EventEmitter {
  private config: HealthMonitorConfig;
  private startTime: number;
  private checkInterval?: NodeJS.Timeout;
  private lastHealthReport?: SystemHealthReport;
  private connectionPool?: ConnectionPool;
  private datasetManager?: DatasetManager;
  private wifAuth?: WorkloadIdentityFederation;
  private queryMetrics?: QueryMetricsTracker;

  constructor(config?: Partial<HealthMonitorConfig>) {
    super();

    this.config = {
      checkInterval: config?.checkInterval ?? 30000, // 30 seconds
      enableAutoChecks: config?.enableAutoChecks ?? true,
      connectionPoolThresholds: {
        minHealthyConnections: 1,
        maxWaitingRequests: 10,
        maxFailureRate: 0.1, // 10%
        ...config?.connectionPoolThresholds,
      },
      cacheThresholds: {
        minHitRate: 0.3, // 30%
        maxEvictionRate: 0.5, // 50%
        ...config?.cacheThresholds,
      },
      queryThresholds: {
        maxErrorRate: 0.1, // 10%
        maxAverageLatency: 5000, // 5 seconds
        ...config?.queryThresholds,
      },
      wifTokenThresholds: {
        minTokenLifetime: 300, // 5 minutes
        ...config?.wifTokenThresholds,
      },
    };

    this.startTime = Date.now();

    logger.info('HealthMonitor initialized', {
      checkInterval: this.config.checkInterval,
      autoChecks: this.config.enableAutoChecks,
    });
  }

  /**
   * Register components for monitoring
   */
  registerComponents(components: {
    connectionPool?: ConnectionPool;
    datasetManager?: DatasetManager;
    wifAuth?: WorkloadIdentityFederation;
    queryMetrics?: QueryMetricsTracker;
  }): void {
    this.connectionPool = components.connectionPool;
    this.datasetManager = components.datasetManager;
    this.wifAuth = components.wifAuth;
    this.queryMetrics = components.queryMetrics;

    logger.info('Components registered for health monitoring', {
      connectionPool: !!this.connectionPool,
      datasetManager: !!this.datasetManager,
      wifAuth: !!this.wifAuth,
      queryMetrics: !!this.queryMetrics,
    });

    if (this.config.enableAutoChecks) {
      this.startAutoChecks();
    }
  }

  /**
   * Start automatic health checks
   */
  private startAutoChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.checkInterval = setInterval(async () => {
      try {
        await this.performHealthCheck();
      } catch (error) {
        logger.error('Auto health check failed', { error });
      }
    }, this.config.checkInterval);

    logger.info('Automatic health checks started', {
      interval: `${this.config.checkInterval}ms`,
    });
  }

  /**
   * Stop automatic health checks
   */
  stopAutoChecks(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = undefined;
      logger.info('Automatic health checks stopped');
    }
  }

  /**
   * Perform comprehensive health check
   */
  async performHealthCheck(): Promise<SystemHealthReport> {
    const startTime = Date.now();
    const components: ComponentHealth[] = [];

    // Check connection pool
    if (this.connectionPool) {
      components.push(await this.checkConnectionPool());
    }

    // Check dataset manager cache
    if (this.datasetManager) {
      components.push(await this.checkDatasetManagerCache());
    }

    // Check WIF token
    if (this.wifAuth) {
      components.push(await this.checkWIFToken());
    }

    // Check query metrics
    if (this.queryMetrics) {
      components.push(await this.checkQueryPerformance());
    }

    // Aggregate status
    const status = this.aggregateHealth(components);
    const checks = components.flatMap(c => Object.values(c.checks));

    const report: SystemHealthReport = {
      status,
      timestamp: Date.now(),
      uptime: Date.now() - this.startTime,
      components,
      metrics: {
        totalChecks: checks.length,
        healthyChecks: checks.filter(c => c.status === HealthStatus.HEALTHY).length,
        degradedChecks: checks.filter(c => c.status === HealthStatus.DEGRADED).length,
        unhealthyChecks: checks.filter(c => c.status === HealthStatus.UNHEALTHY).length,
      },
      version: process.env.npm_package_version ?? '1.0.0',
    };

    this.lastHealthReport = report;

    const duration = Date.now() - startTime;
    logger.debug('Health check completed', {
      status,
      duration: `${duration}ms`,
      components: components.length,
    });

    this.emit('health:check', report);

    // Emit alerts for unhealthy components
    if (status === HealthStatus.UNHEALTHY || status === HealthStatus.DEGRADED) {
      this.emit('health:alert', {
        severity: status === HealthStatus.UNHEALTHY ? 'critical' : 'warning',
        report,
      });
    }

    return report;
  }

  /**
   * Check connection pool health
   */
  private async checkConnectionPool(): Promise<ComponentHealth> {
    const startTime = Date.now();
    const checks: Record<string, HealthCheckResult> = {};

    try {
      const metrics = this.connectionPool!.getMetrics();
      const thresholds = this.config.connectionPoolThresholds;

      // Check active connections
      checks.activeConnections = {
        status: metrics.totalConnections >= thresholds.minHealthyConnections
          ? HealthStatus.HEALTHY
          : HealthStatus.UNHEALTHY,
        message: `${metrics.activeConnections}/${metrics.totalConnections} connections active`,
        details: {
          active: metrics.activeConnections,
          idle: metrics.idleConnections,
          total: metrics.totalConnections,
        },
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };

      // Check waiting requests
      checks.waitingRequests = {
        status: metrics.waitingRequests <= thresholds.maxWaitingRequests
          ? HealthStatus.HEALTHY
          : metrics.waitingRequests <= thresholds.maxWaitingRequests * 1.5
          ? HealthStatus.DEGRADED
          : HealthStatus.UNHEALTHY,
        message: `${metrics.waitingRequests} requests waiting`,
        details: { waitingRequests: metrics.waitingRequests },
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };

      // Check failure rate
      const totalOperations = metrics.totalAcquired + metrics.totalFailed;
      const failureRate = totalOperations > 0 ? metrics.totalFailed / totalOperations : 0;

      checks.failureRate = {
        status: failureRate <= thresholds.maxFailureRate
          ? HealthStatus.HEALTHY
          : failureRate <= thresholds.maxFailureRate * 1.5
          ? HealthStatus.DEGRADED
          : HealthStatus.UNHEALTHY,
        message: `${(failureRate * 100).toFixed(2)}% failure rate`,
        details: {
          failureRate,
          totalFailed: metrics.totalFailed,
          totalAcquired: metrics.totalAcquired,
        },
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };

      // Check pool availability
      checks.poolAvailability = {
        status: this.connectionPool!.isHealthy()
          ? HealthStatus.HEALTHY
          : HealthStatus.UNHEALTHY,
        message: this.connectionPool!.isHealthy() ? 'Pool is healthy' : 'Pool is unhealthy',
        details: {
          uptime: metrics.uptime,
          averageAcquireTime: metrics.averageAcquireTimeMs,
        },
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };
    } catch (error) {
      checks.error = {
        status: HealthStatus.UNHEALTHY,
        message: `Connection pool check failed: ${error}`,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };
    }

    return {
      name: 'connection-pool',
      status: this.aggregateComponentHealth(Object.values(checks)),
      checks,
      lastCheck: Date.now(),
    };
  }

  /**
   * Check dataset manager cache health
   */
  private async checkDatasetManagerCache(): Promise<ComponentHealth> {
    const startTime = Date.now();
    const checks: Record<string, HealthCheckResult> = {};

    try {
      const cacheStats = this.datasetManager!.getCacheStats();
      const thresholds = this.config.cacheThresholds;

      // Check dataset cache hit rate
      checks.datasetCacheHitRate = {
        status: cacheStats.datasets.hitRate >= thresholds.minHitRate
          ? HealthStatus.HEALTHY
          : cacheStats.datasets.hitRate >= thresholds.minHitRate * 0.5
          ? HealthStatus.DEGRADED
          : HealthStatus.UNHEALTHY,
        message: `Dataset cache hit rate: ${(cacheStats.datasets.hitRate * 100).toFixed(1)}%`,
        details: cacheStats.datasets,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };

      // Check table cache hit rate
      checks.tableCacheHitRate = {
        status: cacheStats.tables.hitRate >= thresholds.minHitRate
          ? HealthStatus.HEALTHY
          : cacheStats.tables.hitRate >= thresholds.minHitRate * 0.5
          ? HealthStatus.DEGRADED
          : HealthStatus.UNHEALTHY,
        message: `Table cache hit rate: ${(cacheStats.tables.hitRate * 100).toFixed(1)}%`,
        details: cacheStats.tables,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };

      // Check cache utilization
      const datasetUtilization = cacheStats.datasets.size / cacheStats.datasets.maxSize;
      const tableUtilization = cacheStats.tables.size / cacheStats.tables.maxSize;

      checks.cacheUtilization = {
        status: datasetUtilization < 0.9 && tableUtilization < 0.9
          ? HealthStatus.HEALTHY
          : datasetUtilization < 0.95 && tableUtilization < 0.95
          ? HealthStatus.DEGRADED
          : HealthStatus.UNHEALTHY,
        message: `Cache utilization: datasets ${(datasetUtilization * 100).toFixed(1)}%, tables ${(tableUtilization * 100).toFixed(1)}%`,
        details: {
          datasetUtilization,
          tableUtilization,
          lruQueueLength: cacheStats.lruQueue,
        },
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };
    } catch (error) {
      checks.error = {
        status: HealthStatus.UNHEALTHY,
        message: `Dataset manager cache check failed: ${error}`,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };
    }

    return {
      name: 'dataset-manager-cache',
      status: this.aggregateComponentHealth(Object.values(checks)),
      checks,
      lastCheck: Date.now(),
    };
  }

  /**
   * Check WIF token health
   */
  private async checkWIFToken(): Promise<ComponentHealth> {
    const startTime = Date.now();
    const checks: Record<string, HealthCheckResult> = {};

    try {
      // Check if WIF is configured
      checks.wifConfiguration = {
        status: HealthStatus.HEALTHY,
        message: 'WIF authentication configured',
        details: {
          poolResourceName: this.wifAuth!.getPoolResourceName(),
          providerResourceName: this.wifAuth!.getProviderResourceName(),
        },
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };

      // Note: Token validation would require actual token exchange
      // This is a placeholder for when tokens are actively being used
      checks.tokenValidity = {
        status: HealthStatus.HEALTHY,
        message: 'WIF token system operational',
        details: {
          note: 'Token validation occurs during actual token exchange',
        },
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };
    } catch (error) {
      checks.error = {
        status: HealthStatus.UNHEALTHY,
        message: `WIF token check failed: ${error}`,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };
    }

    return {
      name: 'wif-authentication',
      status: this.aggregateComponentHealth(Object.values(checks)),
      checks,
      lastCheck: Date.now(),
    };
  }

  /**
   * Check query performance
   */
  private async checkQueryPerformance(): Promise<ComponentHealth> {
    const startTime = Date.now();
    const checks: Record<string, HealthCheckResult> = {};

    try {
      const stats = this.queryMetrics!.getStats();
      const thresholds = this.config.queryThresholds;

      // Check error rate
      checks.errorRate = {
        status: stats.errorRate <= thresholds.maxErrorRate * 100
          ? HealthStatus.HEALTHY
          : stats.errorRate <= thresholds.maxErrorRate * 150
          ? HealthStatus.DEGRADED
          : HealthStatus.UNHEALTHY,
        message: `Query error rate: ${stats.errorRate.toFixed(2)}%`,
        details: {
          errorRate: stats.errorRate,
          totalQueries: stats.totalQueries,
          failedQueries: stats.failedQueries,
        },
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };

      // Check average latency
      checks.averageLatency = {
        status: stats.averageDuration <= thresholds.maxAverageLatency
          ? HealthStatus.HEALTHY
          : stats.averageDuration <= thresholds.maxAverageLatency * 1.5
          ? HealthStatus.DEGRADED
          : HealthStatus.UNHEALTHY,
        message: `Average query latency: ${stats.averageDuration.toFixed(0)}ms`,
        details: {
          averageDuration: stats.averageDuration,
          slowQueries: stats.slowQueries.length,
        },
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };

      // Check cache effectiveness
      checks.cacheHitRate = {
        status: stats.cacheHitRate >= 20
          ? HealthStatus.HEALTHY
          : stats.cacheHitRate >= 10
          ? HealthStatus.DEGRADED
          : HealthStatus.UNHEALTHY,
        message: `Query cache hit rate: ${stats.cacheHitRate.toFixed(1)}%`,
        details: {
          cacheHitRate: stats.cacheHitRate,
          cachedQueries: stats.cachedQueries,
          totalQueries: stats.totalQueries,
        },
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };

      // Check cost efficiency
      checks.costEfficiency = {
        status: stats.averageCost <= 0.10
          ? HealthStatus.HEALTHY
          : stats.averageCost <= 0.50
          ? HealthStatus.DEGRADED
          : HealthStatus.UNHEALTHY,
        message: `Average query cost: $${stats.averageCost.toFixed(4)}`,
        details: {
          averageCost: stats.averageCost,
          totalCost: stats.totalCost,
          expensiveQueries: stats.expensiveQueries.length,
        },
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };
    } catch (error) {
      checks.error = {
        status: HealthStatus.UNHEALTHY,
        message: `Query performance check failed: ${error}`,
        timestamp: Date.now(),
        duration: Date.now() - startTime,
      };
    }

    return {
      name: 'query-performance',
      status: this.aggregateComponentHealth(Object.values(checks)),
      checks,
      lastCheck: Date.now(),
    };
  }

  /**
   * Readiness probe - checks if service is ready to accept requests
   */
  async checkReadiness(): Promise<ReadinessCheckResult> {
    const components: Record<string, boolean> = {};

    // Connection pool must have minimum connections
    if (this.connectionPool) {
      const metrics = this.connectionPool.getMetrics();
      components.connectionPool =
        metrics.totalConnections >= this.config.connectionPoolThresholds.minHealthyConnections;
    }

    // Dataset manager must be operational (cache initialized)
    if (this.datasetManager) {
      const stats = this.datasetManager.getCacheStats();
      components.datasetManager = stats.datasets.maxSize > 0;
    }

    // WIF auth must be configured
    if (this.wifAuth) {
      components.wifAuth = true; // If registered, it's configured
    }

    // Query metrics must be tracking
    if (this.queryMetrics) {
      components.queryMetrics = true;
    }

    const ready = Object.values(components).every(c => c);

    logger.debug('Readiness check', { ready, components });

    return {
      ready,
      components,
      timestamp: Date.now(),
    };
  }

  /**
   * Liveness probe - checks if service is alive and not deadlocked
   */
  async checkLiveness(): Promise<LivenessCheckResult> {
    const alive = true; // If we can execute this, we're alive
    const uptime = Date.now() - this.startTime;

    logger.debug('Liveness check', { alive, uptime });

    return {
      alive,
      timestamp: Date.now(),
      uptime,
    };
  }

  /**
   * Get last health report
   */
  getLastHealthReport(): SystemHealthReport | null {
    return this.lastHealthReport ?? null;
  }

  /**
   * Get component health by name
   */
  getComponentHealth(name: string): ComponentHealth | null {
    if (!this.lastHealthReport) {
      return null;
    }

    return this.lastHealthReport.components.find(c => c.name === name) ?? null;
  }

  /**
   * Aggregate component health status
   */
  private aggregateComponentHealth(checks: HealthCheckResult[]): HealthStatus {
    if (checks.some(c => c.status === HealthStatus.UNHEALTHY)) {
      return HealthStatus.UNHEALTHY;
    }

    if (checks.some(c => c.status === HealthStatus.DEGRADED)) {
      return HealthStatus.DEGRADED;
    }

    return HealthStatus.HEALTHY;
  }

  /**
   * Aggregate overall health status
   */
  private aggregateHealth(components: ComponentHealth[]): HealthStatus {
    if (components.some(c => c.status === HealthStatus.UNHEALTHY)) {
      return HealthStatus.UNHEALTHY;
    }

    if (components.some(c => c.status === HealthStatus.DEGRADED)) {
      return HealthStatus.DEGRADED;
    }

    return HealthStatus.HEALTHY;
  }

  /**
   * Get uptime in milliseconds
   */
  getUptime(): number {
    return Date.now() - this.startTime;
  }

  /**
   * Shutdown health monitor
   */
  shutdown(): void {
    this.stopAutoChecks();
    this.removeAllListeners();
    logger.info('HealthMonitor shutdown complete');
  }
}
