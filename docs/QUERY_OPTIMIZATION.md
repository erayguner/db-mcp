# Query Optimization and Caching Layer

This document describes the query optimization and caching layer for the BigQuery MCP server.

## Overview

The optimization layer consists of three main components:

1. **QueryCache** - LRU cache with TTL for query results
2. **QueryOptimizer** - Query validation, cost estimation, and optimization
3. **QueryMetricsTracker** - Performance monitoring and analytics

## Components

### QueryCache

Memory-based LRU (Least Recently Used) cache for query results.

#### Features

- **LRU Eviction**: Automatically removes least recently used entries when cache is full
- **TTL Support**: Entries expire after configurable time period
- **Size-based Eviction**: Prevents cache from exceeding memory limits
- **Pattern Invalidation**: Invalidate multiple entries matching a pattern
- **Hit/Miss Tracking**: Monitor cache effectiveness
- **Automatic Cleanup**: Periodic removal of expired entries

#### Configuration

```typescript
const cache = new QueryCache({
  maxSize: 100 * 1024 * 1024, // 100MB
  ttl: 60 * 60 * 1000, // 1 hour
  maxEntries: 1000, // Max number of entries
  enableCompression: false, // Value compression
});
```

#### Usage

```typescript
// Generate cache key from query
const key = cache.generateKey('SELECT * FROM users', [param1, param2]);

// Check cache
const result = cache.get(key);
if (result) {
  return result; // Cache hit
}

// Execute query and cache result
const data = await executeQuery();
cache.set(key, data);

// Invalidate related entries
cache.invalidate(/^users:/);

// Get statistics
const stats = cache.getStats();
console.log(`Hit rate: ${stats.hitRate}%`);
```

#### Cache Key Generation

Keys are generated using SHA-256 hash of:

- Normalized SQL query (lowercase, no extra whitespace, no comments)
- Query parameters (if any)

This ensures consistent caching for equivalent queries.

#### Statistics

```typescript
interface CacheStats {
  totalHits: number;
  totalMisses: number;
  totalEvictions: number;
  hitRate: number;
  currentSize: number;
  maxSize: number;
  entryCount: number;
  averageHits: number;
}
```

### QueryOptimizer

Validates, analyzes, and optimizes SQL queries before execution.

#### Features

- **SQL Validation**: Syntax checking and dangerous pattern detection
- **Cost Estimation**: Dry run analysis to estimate query cost
- **Automatic LIMIT**: Inject LIMIT clause for expensive queries
- **Security Checks**: SQL injection prevention
- **Query Plan Analysis**: Complexity assessment
- **Optimization Suggestions**: Actionable recommendations

#### Configuration

```typescript
const optimizer = new QueryOptimizer(client, {
  autoAddLimit: true,
  maxAutoLimit: 1000,
  costThresholdUSD: 0.5,
  enableQueryRewrite: true,
  enablePartitionPruning: true,
});
```

#### Usage

```typescript
// Validate query
const validation = await optimizer.validate(query);
if (!validation.valid) {
  console.error('Validation errors:', validation.errors);
}

// Estimate cost
const cost = await optimizer.estimateCost(query);
console.log(`Will process ${cost.processedGB}GB, cost $${cost.estimatedCostUSD}`);

// Optimize query
const result = await optimizer.optimize(query);
console.log('Optimized query:', result.optimized);
console.log('Suggestions:', result.suggestions);

// Generate comprehensive report
const report = await optimizer.generateReport(query);
console.log(`Optimization score: ${report.score}/100`);
```

#### Validation

The optimizer checks for:

- Empty queries
- Dangerous SQL patterns (DROP, DELETE, TRUNCATE, etc.)
- Expensive operations (SELECT \*, CROSS JOIN, etc.)
- Unbalanced parentheses
- Valid SQL structure

#### Cost Estimation

Uses BigQuery's dry run feature to estimate:

- Total bytes processed
- Estimated cost in USD
- Whether query exceeds cost threshold

Pricing: $6.25 per TB processed (as of 2024)

#### Optimization Suggestions

```typescript
interface OptimizationSuggestion {
  type: 'limit' | 'partition' | 'clustering' | 'caching' | 'indexing' | 'query_structure';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  estimatedSavings?: number; // Percentage
}
```

### QueryMetricsTracker

Tracks query performance and generates analytics.

#### Features

- **Performance Tracking**: Duration, cost, bytes processed
- **Slow Query Detection**: Identify queries exceeding threshold
- **Cost Analysis**: Monitor spending patterns
- **Usage Analytics**: Hourly usage patterns
- **Error Tracking**: Monitor failure rates
- **OpenTelemetry Integration**: Export to Cloud Monitoring

#### Configuration

```typescript
const tracker = new QueryMetricsTracker({
  slowQueryThresholdMs: 5000,
  expensiveCostThresholdUSD: 0.5,
  retentionPeriodMs: 24 * 60 * 60 * 1000, // 24 hours
  enableDetailedTracking: true,
});
```

#### Usage

```typescript
// Start tracking
const queryId = 'query-123';
tracker.startQuery(queryId, 'SELECT * FROM users');

// Execute query...

// End tracking
tracker.endQuery(queryId, {
  success: true,
  bytesProcessed: 1000000,
  rowCount: 100,
  cached: false,
  cost: 0.00625,
});

// Get statistics
const stats = tracker.getStats();
console.log(`Total queries: ${stats.totalQueries}`);
console.log(`Cache hit rate: ${stats.cacheHitRate}%`);
console.log(`Error rate: ${stats.errorRate}%`);

// Generate report
const report = tracker.generateReport();
console.log('Recommendations:', report.recommendations);
```

#### Metrics Tracked

```typescript
interface QueryMetrics {
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
```

#### Analytics

The tracker provides:

- **Aggregated Statistics**: Total queries, costs, durations
- **Top Queries**: By duration, cost, or bytes processed
- **Usage Patterns**: Query distribution by hour
- **Performance Reports**: With actionable recommendations
- **Slow/Expensive Query Identification**

## Integration Example

```typescript
import { BigQueryClient } from './bigquery/client.js';
import { QueryCache } from './bigquery/query-cache.js';
import { QueryOptimizer } from './bigquery/query-optimizer.js';
import { QueryMetricsTracker } from './bigquery/query-metrics.js';

class OptimizedQueryExecutor {
  private cache: QueryCache;
  private optimizer: QueryOptimizer;
  private metrics: QueryMetricsTracker;

  constructor(private client: BigQueryClient) {
    this.cache = new QueryCache({
      maxSize: 100 * 1024 * 1024,
      ttl: 60 * 60 * 1000,
    });

    this.optimizer = new QueryOptimizer(client, {
      autoAddLimit: true,
      costThresholdUSD: 0.5,
    });

    this.metrics = new QueryMetricsTracker({
      slowQueryThresholdMs: 5000,
    });
  }

  async executeQuery(query: string) {
    const queryId = `query-${Date.now()}`;

    // 1. Optimize
    const optimized = await this.optimizer.optimize(query);

    // 2. Check cache
    const cacheKey = this.cache.generateKey(optimized.optimized);
    const cached = this.cache.get(cacheKey);
    if (cached) {
      return { rows: cached, cached: true };
    }

    // 3. Execute
    this.metrics.startQuery(queryId, query);
    const rows = await this.client.query(optimized.optimized);

    // 4. Cache result
    this.cache.set(cacheKey, rows);

    // 5. Track metrics
    this.metrics.endQuery(queryId, {
      success: true,
      rowCount: rows.length,
    });

    return { rows, cached: false };
  }
}
```

## Performance Benefits

### Caching

- **Latency Reduction**: 90%+ for cached queries
- **Cost Savings**: Zero cost for cache hits
- **Load Reduction**: Less load on BigQuery

### Optimization

- **Cost Reduction**: 30-70% through better query structure
- **Performance**: Faster execution with LIMIT clauses
- **Safety**: Prevention of expensive runaway queries

### Metrics

- **Visibility**: Real-time performance insights
- **Optimization**: Data-driven query improvements
- **Budgeting**: Cost tracking and forecasting

## Best Practices

### Cache Configuration

1. **Size**: Set based on available memory
   - Development: 50-100MB
   - Production: 500MB-2GB

2. **TTL**: Based on data freshness requirements
   - Real-time data: 5-15 minutes
   - Analytical data: 1-4 hours
   - Static data: 24 hours

3. **Invalidation**: Clear cache when data changes

   ```typescript
   cache.invalidate(/^users:/); // All user queries
   cache.invalidate(/users.*id=123/); // Specific user
   ```

### Optimizer Configuration

1. **Auto-Limit**: Enable for production

   ```typescript
   autoAddLimit: true,
   maxAutoLimit: 1000,
   ```

2. **Cost Threshold**: Set based on budget

   ```typescript
   costThresholdUSD: 0.50,  // Warn on queries >$0.50
   ```

3. **Regular Reports**: Generate weekly optimization reports

   ```typescript
   const report = await optimizer.generateReport(query);
   ```

### Metrics Configuration

1. **Thresholds**: Adjust based on requirements

   ```typescript
   slowQueryThresholdMs: 5000,     // 5 seconds
   expensiveCostThresholdUSD: 0.50, // $0.50
   ```

2. **Retention**: Balance memory vs. historical data

   ```typescript
   retentionPeriodMs: 24 * 60 * 60 * 1000, // 24 hours
   ```

3. **Cleanup**: Run periodic cleanup

   ```typescript
   setInterval(() => tracker.cleanup(), 60 * 60 * 1000);
   ```

## Monitoring

### Cache Monitoring

```typescript
const stats = cache.getStats();

// Alert on low hit rate
if (stats.hitRate < 50) {
  console.warn('Low cache hit rate:', stats.hitRate);
}

// Alert on high eviction rate
if (stats.totalEvictions > stats.entryCount * 0.5) {
  console.warn('High eviction rate, consider increasing cache size');
}
```

### Performance Monitoring

```typescript
const stats = metrics.getStats();

// Alert on high error rate
if (stats.errorRate > 5) {
  console.error('High query error rate:', stats.errorRate);
}

// Alert on expensive queries
if (stats.expensiveQueries.length > 10) {
  console.warn('Many expensive queries detected');
}

// Alert on high costs
if (stats.totalCost > 100) {
  console.warn('High total query cost:', stats.totalCost);
}
```

### OpenTelemetry Integration

The metrics tracker automatically integrates with OpenTelemetry:

- Query latency histograms
- Bytes processed counters
- Cache hit/miss counters
- Error counters

All metrics are exported to GCP Cloud Monitoring.

## Troubleshooting

### Low Cache Hit Rate

**Symptoms**: `cacheHitRate < 20%`

**Solutions**:

1. Increase TTL if data allows
2. Normalize queries (use parameters instead of literals)
3. Check if queries have unique filters
4. Review cache invalidation strategy

### High Memory Usage

**Symptoms**: Cache size approaching max

**Solutions**:

1. Reduce `maxEntries` or `maxSize`
2. Decrease TTL
3. Implement more aggressive invalidation
4. Use pagination for large result sets

### Slow Query Performance

**Symptoms**: Many queries in `slowQueries` list

**Solutions**:

1. Review optimization suggestions
2. Add appropriate filters/indexes
3. Use partitioned tables
4. Consider materialized views
5. Increase LIMIT clause values

### High Query Costs

**Symptoms**: `totalCost` exceeding budget

**Solutions**:

1. Enable auto-limit
2. Use partitioned/clustered tables
3. Add date filters
4. Review expensive queries
5. Consider BigQuery BI Engine

## API Reference

See TypeScript type definitions for complete API documentation:

- [QueryCache API](../src/bigquery/query-cache.ts)
- [QueryOptimizer API](../src/bigquery/query-optimizer.ts)
- [QueryMetricsTracker API](../src/bigquery/query-metrics.ts)

## Testing

Run tests with:

```bash
npm run test:unit         # Unit tests
npm run test:integration  # Integration tests
npm run test:coverage     # Coverage report
```

See test files for usage examples:

- [QueryCache tests](../tests/bigquery/query-cache.test.ts)
- [QueryOptimizer tests](../tests/bigquery/query-optimizer.test.ts)
- [QueryMetricsTracker tests](../tests/bigquery/query-metrics.test.ts)
