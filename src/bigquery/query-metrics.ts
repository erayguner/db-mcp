import { recordQueryLatency, recordBigQueryBytes } from '../telemetry/metrics.js';
import { logger } from '../utils/logger.js';

/**
 * Query Performance Metrics
 */
export interface QueryMetrics {
  queryId: string;
  query: string;
  startTime: number;
  endTime?: number;
  duration?: number;
  bytesProcessed: number;
  rowCount?: number;
  cost: number;
  cached: boolean;
  success: boolean;
  errorMessage?: string;
}

/**
 * Aggregated Query Statistics
 */
export interface QueryStats {
  totalQueries: number;
  successfulQueries: number;
  failedQueries: number;
  cachedQueries: number;
  totalBytesProcessed: number;
  totalCost: number;
  averageDuration: number;
  averageCost: number;
  slowQueries: QueryMetrics[];
  expensiveQueries: QueryMetrics[];
  errorRate: number;
  cacheHitRate: number;
}

/**
 * Usage Pattern
 */
export interface UsagePattern {
  hour: number;
  queryCount: number;
  totalBytes: number;
  totalCost: number;
}

/**
 * Query Analytics Configuration
 */
export interface QueryMetricsConfig {
  slowQueryThresholdMs: number;
  expensiveCostThresholdUSD: number;
  retentionPeriodMs: number;
  enableDetailedTracking: boolean;
}

/**
 * Query Metrics Tracker
 *
 * Features:
 * - Query performance tracking
 * - Cost analysis and reporting
 * - Slow query detection
 * - Usage pattern analytics
 * - OpenTelemetry integration
 */
export class QueryMetricsTracker {
  private metrics: Map<string, QueryMetrics>;
  private config: QueryMetricsConfig;
  private cleanupInterval: NodeJS.Timeout | null;

  constructor(config?: Partial<QueryMetricsConfig>) {
    this.config = {
      slowQueryThresholdMs: config?.slowQueryThresholdMs ?? 5000,
      expensiveCostThresholdUSD: config?.expensiveCostThresholdUSD ?? 0.50,
      retentionPeriodMs: config?.retentionPeriodMs ?? 24 * 60 * 60 * 1000, // 24 hours
      enableDetailedTracking: config?.enableDetailedTracking ?? true,
    };

    this.metrics = new Map();
    this.cleanupInterval = null;

    // Start periodic cleanup
    this.startCleanup();

    logger.info('QueryMetricsTracker initialized', this.config);
  }

  /**
   * Start tracking a query
   */
  startQuery(queryId: string, query: string): void {
    const metric: QueryMetrics = {
      queryId,
      query: query.substring(0, 1000), // Store first 1000 chars to save memory
      startTime: Date.now(),
      bytesProcessed: 0,
      cost: 0,
      cached: false,
      success: false,
    };

    this.metrics.set(queryId, metric);

    logger.debug('Query tracking started', { queryId });
  }

  /**
   * End tracking a query
   */
  endQuery(
    queryId: string,
    result: {
      success: boolean;
      bytesProcessed?: number;
      rowCount?: number;
      cached?: boolean;
      errorMessage?: string;
      cost?: number;
    }
  ): void {
    const metric = this.metrics.get(queryId);
    if (!metric) {
      logger.warn('Query metric not found', { queryId });
      return;
    }

    const endTime = Date.now();
    const duration = endTime - metric.startTime;

    // Update metric
    metric.endTime = endTime;
    metric.duration = duration;
    metric.success = result.success;
    metric.bytesProcessed = result.bytesProcessed ?? 0;
    metric.rowCount = result.rowCount;
    metric.cached = result.cached ?? false;
    metric.errorMessage = result.errorMessage;

    // Calculate cost if not provided (BigQuery pricing: $6.25 per TB)
    metric.cost = result.cost ?? (metric.bytesProcessed / 1e12) * 6.25;

    // Record to OpenTelemetry
    recordQueryLatency(
      duration,
      metric.cached ? 'cached' : 'direct',
      result.success
    );

    if (result.bytesProcessed) {
      recordBigQueryBytes(result.bytesProcessed, 'query');
    }

    // Log slow queries
    if (duration > this.config.slowQueryThresholdMs) {
      logger.warn('Slow query detected', {
        queryId,
        duration: `${duration}ms`,
        query: metric.query.substring(0, 100),
      });
    }

    // Log expensive queries
    if (metric.cost > this.config.expensiveCostThresholdUSD) {
      logger.warn('Expensive query detected', {
        queryId,
        cost: `$${metric.cost.toFixed(4)}`,
        bytesProcessed: metric.bytesProcessed,
      });
    }

    logger.debug('Query tracking ended', {
      queryId,
      duration: `${duration}ms`,
      success: result.success,
    });
  }

  /**
   * Get query metric by ID
   */
  getMetric(queryId: string): QueryMetrics | null {
    return this.metrics.get(queryId) ?? null;
  }

  /**
   * Get all metrics
   */
  getAllMetrics(): QueryMetrics[] {
    return Array.from(this.metrics.values());
  }

  /**
   * Get aggregated statistics
   */
  getStats(): QueryStats {
    const allMetrics = this.getAllMetrics();
    const completedMetrics = allMetrics.filter(m => m.endTime !== undefined);

    const totalQueries = completedMetrics.length;
    const successfulQueries = completedMetrics.filter(m => m.success).length;
    const failedQueries = totalQueries - successfulQueries;
    const cachedQueries = completedMetrics.filter(m => m.cached).length;

    const totalBytesProcessed = completedMetrics.reduce(
      (sum, m) => sum + m.bytesProcessed,
      0
    );
    const totalCost = completedMetrics.reduce((sum, m) => sum + m.cost, 0);

    const totalDuration = completedMetrics.reduce(
      (sum, m) => sum + (m.duration ?? 0),
      0
    );
    const averageDuration = totalQueries > 0 ? totalDuration / totalQueries : 0;
    const averageCost = totalQueries > 0 ? totalCost / totalQueries : 0;

    // Get slow queries
    const slowQueries = completedMetrics
      .filter(m => (m.duration ?? 0) > this.config.slowQueryThresholdMs)
      .sort((a, b) => (b.duration ?? 0) - (a.duration ?? 0))
      .slice(0, 10);

    // Get expensive queries
    const expensiveQueries = completedMetrics
      .filter(m => m.cost > this.config.expensiveCostThresholdUSD)
      .sort((a, b) => b.cost - a.cost)
      .slice(0, 10);

    const errorRate = totalQueries > 0 ? (failedQueries / totalQueries) * 100 : 0;
    const cacheHitRate = totalQueries > 0 ? (cachedQueries / totalQueries) * 100 : 0;

    return {
      totalQueries,
      successfulQueries,
      failedQueries,
      cachedQueries,
      totalBytesProcessed,
      totalCost,
      averageDuration,
      averageCost,
      slowQueries,
      expensiveQueries,
      errorRate,
      cacheHitRate,
    };
  }

  /**
   * Analyze usage patterns by hour
   */
  analyzeUsagePatterns(): UsagePattern[] {
    const patterns = new Map<number, UsagePattern>();

    for (const metric of this.metrics.values()) {
      if (!metric.endTime) continue;

      const hour = new Date(metric.startTime).getHours();
      const existing = patterns.get(hour) ?? {
        hour,
        queryCount: 0,
        totalBytes: 0,
        totalCost: 0,
      };

      existing.queryCount++;
      existing.totalBytes += metric.bytesProcessed;
      existing.totalCost += metric.cost;

      patterns.set(hour, existing);
    }

    return Array.from(patterns.values()).sort((a, b) => a.hour - b.hour);
  }

  /**
   * Get top queries by a specific metric
   */
  getTopQueries(
    by: 'duration' | 'cost' | 'bytes',
    limit: number = 10
  ): QueryMetrics[] {
    const completedMetrics = this.getAllMetrics().filter(m => m.endTime !== undefined);

    const sorted = completedMetrics.sort((a, b) => {
      switch (by) {
        case 'duration':
          return (b.duration ?? 0) - (a.duration ?? 0);
        case 'cost':
          return b.cost - a.cost;
        case 'bytes':
          return b.bytesProcessed - a.bytesProcessed;
        default:
          return 0;
      }
    });

    return sorted.slice(0, limit);
  }

  /**
   * Generate performance report
   */
  generateReport(): {
    stats: QueryStats;
    usagePatterns: UsagePattern[];
    topSlowQueries: QueryMetrics[];
    topExpensiveQueries: QueryMetrics[];
    recommendations: string[];
  } {
    const stats = this.getStats();
    const usagePatterns = this.analyzeUsagePatterns();
    const topSlowQueries = this.getTopQueries('duration', 5);
    const topExpensiveQueries = this.getTopQueries('cost', 5);
    const recommendations: string[] = [];

    // Generate recommendations
    if (stats.errorRate > 10) {
      recommendations.push(
        `High error rate detected (${stats.errorRate.toFixed(1)}%). Review failed queries and improve error handling.`
      );
    }

    if (stats.cacheHitRate < 20) {
      recommendations.push(
        `Low cache hit rate (${stats.cacheHitRate.toFixed(1)}%). Consider increasing cache TTL or size.`
      );
    }

    if (stats.averageCost > 0.10) {
      recommendations.push(
        `High average query cost ($${stats.averageCost.toFixed(4)}). Optimize queries or use partitioned tables.`
      );
    }

    if (stats.slowQueries.length > 0) {
      recommendations.push(
        `${stats.slowQueries.length} slow queries detected. Review and optimize query performance.`
      );
    }

    if (stats.totalCost > 10) {
      recommendations.push(
        `Total query cost is $${stats.totalCost.toFixed(2)}. Monitor usage to stay within budget.`
      );
    }

    logger.info('Performance report generated', {
      totalQueries: stats.totalQueries,
      totalCost: `$${stats.totalCost.toFixed(2)}`,
      recommendationsCount: recommendations.length,
    });

    return {
      stats,
      usagePatterns,
      topSlowQueries,
      topExpensiveQueries,
      recommendations,
    };
  }

  /**
   * Clear old metrics based on retention period
   */
  cleanup(): number {
    const now = Date.now();
    const cutoff = now - this.config.retentionPeriodMs;
    let removed = 0;

    for (const [queryId, metric] of this.metrics.entries()) {
      if (metric.startTime < cutoff) {
        this.metrics.delete(queryId);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info('Metrics cleanup completed', { removedCount: removed });
    }

    return removed;
  }

  /**
   * Start periodic cleanup
   */
  private startCleanup(): void {
    // Run cleanup every hour
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 60 * 60 * 1000);

    logger.debug('Periodic metrics cleanup started');
  }

  /**
   * Stop periodic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
      logger.debug('Periodic metrics cleanup stopped');
    }
  }

  /**
   * Clear all metrics
   */
  clear(): void {
    this.metrics.clear();
    logger.info('All metrics cleared');
  }

  /**
   * Export metrics to JSON
   */
  export(): {
    metrics: QueryMetrics[];
    stats: QueryStats;
    exportTime: number;
  } {
    return {
      metrics: this.getAllMetrics(),
      stats: this.getStats(),
      exportTime: Date.now(),
    };
  }

  /**
   * Get configuration
   */
  getConfig(): QueryMetricsConfig {
    return { ...this.config };
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QueryMetricsConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Metrics configuration updated', this.config);
  }
}
