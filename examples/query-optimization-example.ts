/**
 * Query Optimization and Caching Example
 *
 * Demonstrates how to use the QueryCache, QueryOptimizer, and QueryMetricsTracker
 * components together for optimal BigQuery performance.
 */

import { BigQueryClient } from '../src/bigquery/client.js';
import { QueryCache } from '../src/bigquery/query-cache.js';
import { QueryOptimizer } from '../src/bigquery/query-optimizer.js';
import { QueryMetricsTracker } from '../src/bigquery/query-metrics.js';
import { logger } from '../src/utils/logger.js';

/**
 * Optimized BigQuery Query Executor
 *
 * Combines caching, optimization, and metrics tracking
 */
export class OptimizedQueryExecutor {
  private client: BigQueryClient;
  private cache: QueryCache;
  private optimizer: QueryOptimizer;
  private metrics: QueryMetricsTracker;

  constructor(client: BigQueryClient) {
    this.client = client;

    // Initialize cache with 100MB limit and 1-hour TTL
    this.cache = new QueryCache({
      maxSize: 100 * 1024 * 1024,
      ttl: 60 * 60 * 1000,
      maxEntries: 1000,
    });

    // Initialize optimizer with auto-limit injection
    this.optimizer = new QueryOptimizer(client, {
      autoAddLimit: true,
      maxAutoLimit: 1000,
      costThresholdUSD: 0.50,
      enableQueryRewrite: true,
    });

    // Initialize metrics tracker
    this.metrics = new QueryMetricsTracker({
      slowQueryThresholdMs: 5000,
      expensiveCostThresholdUSD: 0.50,
      retentionPeriodMs: 24 * 60 * 60 * 1000,
    });

    logger.info('OptimizedQueryExecutor initialized');
  }

  /**
   * Execute query with full optimization pipeline
   */
  async executeQuery(query: string, parameters?: any[]): Promise<{
    rows: any[];
    metadata: {
      cached: boolean;
      duration: number;
      bytesProcessed: number;
      cost: number;
      optimizations: string[];
    };
  }> {
    const queryId = `query-${Date.now()}-${Math.random()}`;
    const startTime = Date.now();
    const optimizations: string[] = [];

    try {
      // Step 1: Validate and optimize query
      logger.info('Optimizing query', { queryId });
      const optimizationResult = await this.optimizer.optimize(query);

      if (optimizationResult.optimized !== query) {
        optimizations.push('Query optimized with automatic improvements');
      }

      const optimizedQuery = optimizationResult.optimized;

      // Log optimization suggestions
      for (const suggestion of optimizationResult.suggestions) {
        logger.info('Optimization suggestion', {
          queryId,
          type: suggestion.type,
          severity: suggestion.severity,
          message: suggestion.message,
        });
        optimizations.push(suggestion.message);
      }

      // Step 2: Check cache
      const cacheKey = this.cache.generateKey(optimizedQuery, parameters);
      const cachedResult = this.cache.get(cacheKey);

      if (cachedResult) {
        logger.info('Cache hit', { queryId, cacheKey: cacheKey.substring(0, 16) });

        const duration = Date.now() - startTime;

        // Track metrics for cached query
        this.metrics.startQuery(queryId, query);
        this.metrics.endQuery(queryId, {
          success: true,
          cached: true,
          rowCount: cachedResult.length,
          bytesProcessed: 0,
        });

        optimizations.push('Result served from cache');

        return {
          rows: cachedResult,
          metadata: {
            cached: true,
            duration,
            bytesProcessed: 0,
            cost: 0,
            optimizations,
          },
        };
      }

      // Step 3: Execute query
      logger.info('Executing query', { queryId });
      this.metrics.startQuery(queryId, query);

      const rows = await this.client.query(optimizedQuery, { parameters });
      const duration = Date.now() - startTime;

      // Step 4: Get query metadata
      const costEstimate = optimizationResult.costEstimate;
      const bytesProcessed = parseInt(costEstimate.totalBytesProcessed);
      const cost = costEstimate.estimatedCostUSD;

      // Step 5: Cache result
      this.cache.set(cacheKey, rows);
      logger.info('Result cached', { queryId, cacheKey: cacheKey.substring(0, 16) });
      optimizations.push('Result stored in cache for future use');

      // Step 6: Track metrics
      this.metrics.endQuery(queryId, {
        success: true,
        cached: false,
        rowCount: rows.length,
        bytesProcessed,
        cost,
      });

      return {
        rows,
        metadata: {
          cached: false,
          duration,
          bytesProcessed,
          cost,
          optimizations,
        },
      };
    } catch (error) {
      const duration = Date.now() - startTime;

      // Track failed query
      this.metrics.endQuery(queryId, {
        success: false,
        errorMessage: error instanceof Error ? error.message : 'Unknown error',
      });

      logger.error('Query execution failed', {
        queryId,
        error,
        duration,
      });

      throw error;
    }
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Get query performance statistics
   */
  getPerformanceStats() {
    return this.metrics.getStats();
  }

  /**
   * Generate comprehensive performance report
   */
  generateReport() {
    const report = this.metrics.generateReport();
    const cacheStats = this.cache.getStats();

    return {
      ...report,
      cache: {
        hitRate: cacheStats.hitRate,
        size: `${(cacheStats.currentSize / 1024 / 1024).toFixed(2)}MB`,
        entries: cacheStats.entryCount,
      },
    };
  }

  /**
   * Clear cache (useful for testing or forced refresh)
   */
  clearCache() {
    this.cache.clear();
    logger.info('Cache cleared');
  }

  /**
   * Invalidate cache entries matching a pattern
   */
  invalidateCache(pattern: RegExp | string) {
    const count = this.cache.invalidate(pattern);
    logger.info('Cache invalidated', { pattern: pattern.toString(), count });
    return count;
  }

  /**
   * Cleanup old metrics and cache entries
   */
  cleanup() {
    const metricsRemoved = this.metrics.cleanup();
    const cacheRemoved = this.cache.cleanup();

    logger.info('Cleanup completed', {
      metricsRemoved,
      cacheRemoved,
    });

    return { metricsRemoved, cacheRemoved };
  }

  /**
   * Shutdown and cleanup
   */
  async shutdown() {
    this.metrics.stopCleanup();
    this.cache.clear();
    logger.info('OptimizedQueryExecutor shutdown complete');
  }
}

/**
 * Example usage
 */
async function example() {
  // Initialize BigQuery client
  const client = new BigQueryClient({
    projectId: 'your-project-id',
    location: 'EU',
  });

  // Create optimized executor
  const executor = new OptimizedQueryExecutor(client);

  try {
    // Execute a query
    const result = await executor.executeQuery(`
      SELECT
        user_id,
        COUNT(*) as order_count,
        SUM(total_amount) as total_spent
      FROM orders
      WHERE order_date >= '2024-01-01'
      GROUP BY user_id
      ORDER BY total_spent DESC
    `);

    console.log('Query Results:');
    console.log(`- Rows: ${result.rows.length}`);
    console.log(`- Cached: ${result.metadata.cached}`);
    console.log(`- Duration: ${result.metadata.duration}ms`);
    console.log(`- Cost: $${result.metadata.cost.toFixed(4)}`);
    console.log(`- Optimizations applied: ${result.metadata.optimizations.length}`);

    for (const optimization of result.metadata.optimizations) {
      console.log(`  * ${optimization}`);
    }

    // Get performance report
    const report = executor.generateReport();
    console.log('\nPerformance Report:');
    console.log(`- Total queries: ${report.stats.totalQueries}`);
    console.log(`- Cache hit rate: ${report.stats.cacheHitRate.toFixed(2)}%`);
    console.log(`- Error rate: ${report.stats.errorRate.toFixed(2)}%`);
    console.log(`- Average duration: ${report.stats.averageDuration.toFixed(2)}ms`);
    console.log(`- Total cost: $${report.stats.totalCost.toFixed(2)}`);

    if (report.recommendations.length > 0) {
      console.log('\nRecommendations:');
      for (const recommendation of report.recommendations) {
        console.log(`  - ${recommendation}`);
      }
    }

  } finally {
    await executor.shutdown();
  }
}

// Run example if this file is executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  example().catch(console.error);
}
