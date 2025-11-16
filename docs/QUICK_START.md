# Query Optimization Layer - Quick Start

## 30-Second Start

```typescript
import { OptimizedQueryExecutor } from './examples/query-optimization-example.js';
import { BigQueryClient } from './bigquery/client.js';

const client = new BigQueryClient({ projectId: 'your-project' });
const executor = new OptimizedQueryExecutor(client);

const result = await executor.executeQuery('SELECT * FROM users LIMIT 100');
console.log(`${result.rows.length} rows, cached: ${result.metadata.cached}`);
```

## 5-Minute Integration

### Step 1: Import Components

```typescript
import { QueryCache, QueryOptimizer, QueryMetricsTracker } from './bigquery/index.js';
```

### Step 2: Initialize

```typescript
const cache = new QueryCache();
const optimizer = new QueryOptimizer(client);
const metrics = new QueryMetricsTracker();
```

### Step 3: Use in Query Flow

```typescript
// Optimize
const optimized = await optimizer.optimize(query);

// Check cache
const cacheKey = cache.generateKey(optimized.optimized);
const cached = cache.get(cacheKey);
if (cached) return cached;

// Execute with metrics
metrics.startQuery(queryId, query);
const result = await client.query(optimized.optimized);
metrics.endQuery(queryId, { success: true });

// Cache result
cache.set(cacheKey, result);
```

## Common Use Cases

### Use Case 1: Add Caching Only

```typescript
const cache = new QueryCache({ ttl: 3600000 }); // 1 hour

async function cachedQuery(sql: string) {
  const key = cache.generateKey(sql);
  return cache.get(key) ?? await fetchAndCache(sql, key);
}
```

### Use Case 2: Cost Control

```typescript
const optimizer = new QueryOptimizer(client, {
  autoAddLimit: true,
  costThresholdUSD: 0.50,
});

const { optimized, costEstimate } = await optimizer.optimize(query);
if (costEstimate.isExpensive) {
  console.warn('Expensive query:', costEstimate.recommendation);
}
```

### Use Case 3: Performance Monitoring

```typescript
const tracker = new QueryMetricsTracker();

// Track every query
tracker.startQuery(id, sql);
try {
  const result = await executeQuery(sql);
  tracker.endQuery(id, { success: true, rowCount: result.length });
} catch (error) {
  tracker.endQuery(id, { success: false, errorMessage: error.message });
}

// Review daily
const report = tracker.generateReport();
console.log('Recommendations:', report.recommendations);
```

## Production Setup

```typescript
// config/optimization.ts
export const optimizationConfig = {
  cache: {
    maxSize: 500 * 1024 * 1024,  // 500MB
    ttl: 60 * 60 * 1000,         // 1 hour
  },
  optimizer: {
    autoAddLimit: true,
    maxAutoLimit: 1000,
    costThresholdUSD: 0.50,
  },
  metrics: {
    slowQueryThresholdMs: 5000,
    expensiveCostThresholdUSD: 0.50,
  },
};

// Initialize once
const executor = new OptimizedQueryExecutor(client);

// Use everywhere
app.post('/query', async (req, res) => {
  const result = await executor.executeQuery(req.body.sql);
  res.json(result);
});
```

## Monitoring Dashboard

```typescript
// GET /metrics endpoint
app.get('/metrics', (req, res) => {
  const report = executor.generateReport();
  
  res.json({
    cache: {
      hitRate: report.cache.hitRate,
      size: report.cache.size,
      entries: report.cache.entries,
    },
    performance: {
      totalQueries: report.stats.totalQueries,
      errorRate: report.stats.errorRate,
      cacheHitRate: report.stats.cacheHitRate,
      averageDuration: report.stats.averageDuration,
      totalCost: report.stats.totalCost,
    },
    recommendations: report.recommendations,
  });
});
```

## Next Steps

1. ✅ Run tests: `npm test`
2. ✅ Review [Full Documentation](QUERY_OPTIMIZATION.md)
3. ✅ Customize [Configuration](#production-setup)
4. ✅ Set up [Monitoring](#monitoring-dashboard)
5. ✅ Review [Best Practices](QUERY_OPTIMIZATION.md#best-practices)
