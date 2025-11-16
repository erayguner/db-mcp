# Scalability Patterns

## Overview

The BigQuery MCP Server is designed for horizontal scalability to handle thousands of concurrent requests while maintaining low latency and high reliability.

## Scaling Dimensions

### Horizontal Scaling

```
┌─────────────────────────────────────────────────────────────┐
│                    Load Balancer                            │
│                  (Cloud Load Balancing)                     │
└─────────────────────┬───────────────────────────────────────┘
                      │
      ┌───────────────┼───────────────┬───────────────┐
      │               │               │               │
      ▼               ▼               ▼               ▼
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│ Instance │    │ Instance │    │ Instance │    │ Instance │
│    1     │    │    2     │    │    3     │    │    N     │
│          │    │          │    │          │    │          │
│ CPU: 1   │    │ CPU: 1   │    │ CPU: 1   │    │ CPU: 1   │
│ RAM: 2GB │    │ RAM: 2GB │    │ RAM: 2GB │    │ RAM: 2GB │
└──────────┘    └──────────┘    └──────────┘    └──────────┘
```

**Characteristics:**
- Stateless instances (no local state)
- Shared nothing architecture
- Auto-scaling based on CPU/memory/requests
- Scale from 1 to 100+ instances

**Auto-Scaling Configuration:**
```yaml
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: bigquery-mcp-server
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: bigquery-mcp-server
  minReplicas: 2
  maxReplicas: 50
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
  - type: Pods
    pods:
      metric:
        name: requests_per_second
      target:
        type: AverageValue
        averageValue: "100"
  behavior:
    scaleDown:
      stabilizationWindowSeconds: 300
      policies:
      - type: Percent
        value: 50
        periodSeconds: 60
    scaleUp:
      stabilizationWindowSeconds: 0
      policies:
      - type: Percent
        value: 100
        periodSeconds: 30
      - type: Pods
        value: 4
        periodSeconds: 30
      selectPolicy: Max
```

### Vertical Scaling

```
Small Instance          Medium Instance        Large Instance
┌──────────────┐       ┌──────────────┐       ┌──────────────┐
│ CPU: 1 vCPU  │       │ CPU: 2 vCPU  │       │ CPU: 4 vCPU  │
│ RAM: 512MB   │       │ RAM: 2GB     │       │ RAM: 8GB     │
│              │       │              │       │              │
│ QPS: ~50     │       │ QPS: ~200    │       │ QPS: ~500    │
│ Latency: 100ms│      │ Latency: 80ms│       │ Latency: 50ms│
└──────────────┘       └──────────────┘       └──────────────┘
```

**Resource Recommendations:**
- **Development**: 0.5 vCPU, 512MB RAM
- **Staging**: 1 vCPU, 1GB RAM
- **Production (low)**: 1 vCPU, 2GB RAM
- **Production (medium)**: 2 vCPU, 4GB RAM
- **Production (high)**: 4 vCPU, 8GB RAM

## Caching Strategy

### Multi-Level Cache Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Request Flow                            │
└─────────────────────────────────────────────────────────────┘

Request
   │
   ▼
┌────────────────────┐
│   L1: Memory Cache │  ◄── In-process, LRU, 100MB max
│   (per instance)   │      TTL: 5-15min
└────────┬───────────┘
         │
         │ Miss
         ▼
┌────────────────────┐
│  L2: Redis Cache   │  ◄── Shared, distributed
│  (shared cluster)  │      TTL: 30min
└────────┬───────────┘
         │
         │ Miss
         ▼
┌────────────────────┐
│  BigQuery API      │  ◄── Fetch from source
└────────────────────┘
```

### Cache Implementation

```typescript
interface CacheConfig {
  l1: {
    enabled: boolean;
    maxSize: number;      // bytes
    ttl: number;          // seconds
    algorithm: 'LRU' | 'LFU';
  };
  l2: {
    enabled: boolean;
    host: string;
    port: number;
    ttl: number;
    prefix: string;
  };
}

class MultiLevelCache {
  private l1Cache: LRUCache;
  private l2Cache?: RedisClient;

  constructor(private config: CacheConfig) {
    // L1: In-memory LRU cache
    if (config.l1.enabled) {
      this.l1Cache = new LRUCache({
        max: config.l1.maxSize,
        ttl: config.l1.ttl * 1000,
        updateAgeOnGet: true,
        updateAgeOnHas: true
      });
    }

    // L2: Redis cache
    if (config.l2.enabled) {
      this.l2Cache = createClient({
        host: config.l2.host,
        port: config.l2.port,
        retry_strategy: (options) => {
          return Math.min(options.attempt * 100, 3000);
        }
      });
    }
  }

  async get<T>(key: string): Promise<T | null> {
    // Try L1 cache
    if (this.config.l1.enabled) {
      const l1Value = this.l1Cache.get(key);
      if (l1Value !== undefined) {
        cacheHitCounter.add(1, { level: 'l1', key_type: this.getKeyType(key) });
        return l1Value as T;
      }
    }

    // Try L2 cache
    if (this.config.l2.enabled && this.l2Cache) {
      const l2Value = await this.l2Cache.get(this.prefixKey(key));
      if (l2Value !== null) {
        const parsed = JSON.parse(l2Value) as T;

        // Populate L1 cache
        if (this.config.l1.enabled) {
          this.l1Cache.set(key, parsed);
        }

        cacheHitCounter.add(1, { level: 'l2', key_type: this.getKeyType(key) });
        return parsed;
      }
    }

    cacheMissCounter.add(1, { key_type: this.getKeyType(key) });
    return null;
  }

  async set<T>(key: string, value: T, ttl?: number): Promise<void> {
    const effectiveTtl = ttl || this.config.l1.ttl;

    // Set in L1 cache
    if (this.config.l1.enabled) {
      this.l1Cache.set(key, value, { ttl: effectiveTtl * 1000 });
    }

    // Set in L2 cache
    if (this.config.l2.enabled && this.l2Cache) {
      await this.l2Cache.setex(
        this.prefixKey(key),
        ttl || this.config.l2.ttl,
        JSON.stringify(value)
      );
    }
  }

  async invalidate(pattern: string): Promise<void> {
    // Invalidate L1 cache
    if (this.config.l1.enabled) {
      for (const key of this.l1Cache.keys()) {
        if (key.match(pattern)) {
          this.l1Cache.delete(key);
        }
      }
    }

    // Invalidate L2 cache
    if (this.config.l2.enabled && this.l2Cache) {
      const keys = await this.l2Cache.keys(`${this.config.l2.prefix}:${pattern}`);
      if (keys.length > 0) {
        await this.l2Cache.del(...keys);
      }
    }

    cacheInvalidationCounter.add(1, { pattern });
  }

  private prefixKey(key: string): string {
    return `${this.config.l2.prefix}:${key}`;
  }

  private getKeyType(key: string): string {
    if (key.startsWith('datasets:')) return 'datasets';
    if (key.startsWith('tables:')) return 'tables';
    if (key.startsWith('schema:')) return 'schema';
    return 'other';
  }
}
```

### Cache Key Patterns

```typescript
const cacheKeys = {
  // Datasets: project-scoped
  datasets: (projectId: string) => `datasets:${projectId}`,

  // Tables: dataset-scoped
  tables: (datasetId: string) => `tables:${datasetId}`,

  // Schema: table-scoped
  schema: (datasetId: string, tableId: string) => `schema:${datasetId}.${tableId}`,

  // Query results: query hash (optional, careful with memory)
  queryResult: (queryHash: string) => `query:${queryHash}`
};

// Cache TTLs by resource type
const cacheTTLs = {
  datasets: 900,    // 15 minutes
  tables: 900,      // 15 minutes
  schema: 1800,     // 30 minutes
  queryResult: 300  // 5 minutes (if enabled)
};
```

## Connection Pooling

### BigQuery Client Pool

```typescript
class BigQueryConnectionPool {
  private pool: BigQuery[] = [];
  private activeConnections = 0;

  private readonly config = {
    minConnections: 2,
    maxConnections: 10,
    idleTimeoutMs: 30000,
    acquireTimeoutMs: 5000
  };

  constructor() {
    // Pre-create minimum connections
    for (let i = 0; i < this.config.minConnections; i++) {
      this.pool.push(this.createConnection());
    }
  }

  async acquire(): Promise<BigQuery> {
    const startTime = Date.now();

    // Try to get idle connection
    const connection = this.pool.pop();
    if (connection) {
      this.activeConnections++;
      connectionPoolGauge.set(this.activeConnections, { state: 'active' });
      return connection;
    }

    // Create new connection if under max
    if (this.activeConnections < this.config.maxConnections) {
      this.activeConnections++;
      connectionPoolGauge.set(this.activeConnections, { state: 'active' });
      return this.createConnection();
    }

    // Wait for connection to become available
    return this.waitForConnection(startTime);
  }

  async release(connection: BigQuery): Promise<void> {
    this.activeConnections--;
    connectionPoolGauge.set(this.activeConnections, { state: 'active' });

    // Return to pool if under max pool size
    if (this.pool.length < this.config.maxConnections) {
      this.pool.push(connection);
    }
  }

  private createConnection(): BigQuery {
    return new BigQuery({
      projectId: process.env.GCP_PROJECT_ID,
      credentials: this.getCredentials(),
      maxRetries: 3,
      autoRetry: true
    });
  }

  private async waitForConnection(startTime: number): Promise<BigQuery> {
    return new Promise((resolve, reject) => {
      const checkInterval = setInterval(() => {
        // Check for timeout
        if (Date.now() - startTime > this.config.acquireTimeoutMs) {
          clearInterval(checkInterval);
          reject(new Error('Connection acquire timeout'));
          return;
        }

        // Check for available connection
        const connection = this.pool.pop();
        if (connection) {
          clearInterval(checkInterval);
          this.activeConnections++;
          resolve(connection);
        }
      }, 100);
    });
  }

  async close(): Promise<void> {
    // Close all connections
    for (const connection of this.pool) {
      await connection.close();
    }
    this.pool = [];
    this.activeConnections = 0;
  }
}
```

## Rate Limiting

### Token Bucket Algorithm

```typescript
class TokenBucket {
  private tokens: number;
  private lastRefill: number;

  constructor(
    private capacity: number,
    private refillRate: number // tokens per second
  ) {
    this.tokens = capacity;
    this.lastRefill = Date.now();
  }

  tryConsume(tokens: number = 1): boolean {
    this.refill();

    if (this.tokens >= tokens) {
      this.tokens -= tokens;
      return true;
    }

    return false;
  }

  private refill(): void {
    const now = Date.now();
    const elapsedSeconds = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsedSeconds * this.refillRate;

    this.tokens = Math.min(this.capacity, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  getTokens(): number {
    this.refill();
    return this.tokens;
  }

  getResetTime(): number {
    this.refill();
    if (this.tokens >= this.capacity) {
      return Date.now();
    }

    const tokensNeeded = this.capacity - this.tokens;
    const secondsNeeded = tokensNeeded / this.refillRate;
    return Date.now() + (secondsNeeded * 1000);
  }
}

class RateLimiter {
  private buckets = new Map<string, TokenBucket>();

  private readonly limits = {
    globalQPS: 100,           // 100 queries/sec globally
    perClientQPM: 60,         // 60 queries/min per client
    perClientBurst: 10,       // 10 burst capacity
    maxConcurrent: 1000       // 1000 concurrent queries
  };

  async checkLimit(clientId: string): Promise<RateLimitResult> {
    // Global rate limit
    const globalBucket = this.getGlobalBucket();
    if (!globalBucket.tryConsume(1)) {
      return {
        allowed: false,
        reason: 'Global rate limit exceeded',
        retryAfter: Math.ceil((globalBucket.getResetTime() - Date.now()) / 1000)
      };
    }

    // Per-client rate limit
    const clientBucket = this.getClientBucket(clientId);
    if (!clientBucket.tryConsume(1)) {
      return {
        allowed: false,
        reason: 'Client rate limit exceeded',
        retryAfter: Math.ceil((clientBucket.getResetTime() - Date.now()) / 1000)
      };
    }

    return { allowed: true };
  }

  private getGlobalBucket(): TokenBucket {
    if (!this.buckets.has('global')) {
      this.buckets.set('global', new TokenBucket(
        this.limits.globalQPS,
        this.limits.globalQPS
      ));
    }
    return this.buckets.get('global')!;
  }

  private getClientBucket(clientId: string): TokenBucket {
    const key = `client:${clientId}`;
    if (!this.buckets.has(key)) {
      this.buckets.set(key, new TokenBucket(
        this.limits.perClientBurst,
        this.limits.perClientQPM / 60 // per second
      ));
    }
    return this.buckets.get(key)!;
  }
}
```

## Load Testing

### Performance Benchmarks

```typescript
import { check, sleep } from 'k6';
import http from 'k6/http';

export const options = {
  stages: [
    { duration: '2m', target: 100 },   // Ramp up to 100 users
    { duration: '5m', target: 100 },   // Stay at 100 users
    { duration: '2m', target: 200 },   // Ramp up to 200 users
    { duration: '5m', target: 200 },   // Stay at 200 users
    { duration: '2m', target: 0 }      // Ramp down to 0 users
  ],
  thresholds: {
    http_req_duration: ['p(95)<2000'], // 95% of requests < 2s
    http_req_failed: ['rate<0.01'],    // <1% failure rate
  }
};

export default function() {
  const url = 'http://localhost:8080/query';

  const payload = JSON.stringify({
    tool: 'query_bigquery',
    arguments: {
      query: 'SELECT * FROM `project.dataset.table` LIMIT 100'
    }
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${__ENV.AUTH_TOKEN}`
    }
  };

  const response = http.post(url, payload, params);

  check(response, {
    'status is 200': (r) => r.status === 200,
    'response time < 2000ms': (r) => r.timings.duration < 2000,
    'has result': (r) => JSON.parse(r.body).result !== undefined
  });

  sleep(1);
}
```

### Expected Performance

```
┌──────────────────────────────────────────────────────────┐
│             Performance Targets                          │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  Latency (P50):         < 500ms                          │
│  Latency (P95):         < 2000ms                         │
│  Latency (P99):         < 5000ms                         │
│                                                          │
│  Throughput:            100+ QPS per instance            │
│  Concurrent Queries:    1000+ per instance               │
│                                                          │
│  Cache Hit Rate:        60-80% (schema operations)       │
│  Error Rate:            < 0.1%                           │
│                                                          │
│  Resource Usage:                                         │
│    CPU:                 < 70% average                    │
│    Memory:              < 80% average                    │
│    Network:             < 100 Mbps                       │
│                                                          │
│  Auto-Scaling:                                           │
│    Scale Up Time:       < 30 seconds                     │
│    Scale Down Time:     < 5 minutes                      │
└──────────────────────────────────────────────────────────┘
```

## Database Quotas and Limits

### BigQuery Quotas

```typescript
const bigQueryQuotas = {
  // API Quotas
  queriesPerDay: 100000,           // Per project
  queriesPerSecond: 100,           // Per project
  concurrentQueries: 100,          // Per user

  // Query Limits
  maxQuerySize: 1024 * 1024,       // 1 MB
  maxResultSize: 10 * 1024 * 1024, // 10 GB
  maxExecutionTime: 6 * 3600,      // 6 hours

  // Interactive Query Quotas
  interactiveQueriesPerDay: 100000,
  interactiveQueriesPerUser: 2000,

  // Batch Query Quotas
  batchQueriesPerDay: 100000,

  // Rate Limits
  tableDataListPerSecond: 100,
  jobsInsertPerSecond: 100,
  jobsGetPerSecond: 1000
};

class QuotaManager {
  async checkQuota(operation: string): Promise<QuotaResult> {
    const usage = await this.getQuotaUsage(operation);
    const limit = bigQueryQuotas[operation];

    if (usage >= limit * 0.9) {
      logger.warn('Approaching quota limit', {
        operation,
        usage,
        limit,
        percent: (usage / limit) * 100
      });
    }

    if (usage >= limit) {
      return {
        allowed: false,
        reason: 'Quota exceeded',
        usage,
        limit,
        resetTime: this.getQuotaResetTime(operation)
      };
    }

    return {
      allowed: true,
      usage,
      limit,
      remaining: limit - usage
    };
  }
}
```

## Deployment Strategies

### Blue-Green Deployment

```
┌─────────────────────────────────────────────────────────┐
│                    Load Balancer                        │
└─────────────────────┬───────────────────────────────────┘
                      │
            ┌─────────┴─────────┐
            │                   │
            ▼                   ▼
      ┌──────────┐        ┌──────────┐
      │  Blue    │        │  Green   │
      │ (v1.0.0) │        │ (v1.1.0) │
      │          │        │          │
      │ Active   │        │ Standby  │
      └──────────┘        └──────────┘

1. Deploy new version to Green
2. Run health checks and smoke tests
3. Gradually shift traffic: 10% → 50% → 100%
4. Monitor error rates and latency
5. Rollback if issues detected
6. Decommission Blue when stable
```

### Canary Deployment

```
┌─────────────────────────────────────────────────────────┐
│              Load Balancer (Weighted)                   │
└─────────────────────┬───────────────────────────────────┘
                      │
            ┌─────────┴─────────┬──────────────┐
            │                   │              │
          95%                  5%            0%
            │                   │              │
            ▼                   ▼              ▼
      ┌──────────┐        ┌──────────┐  ┌──────────┐
      │ Stable   │        │  Canary  │  │  Backup  │
      │ (v1.0.0) │        │ (v1.1.0) │  │ (v0.9.0) │
      │          │        │          │  │          │
      │ 19 pods  │        │  1 pod   │  │  0 pods  │
      └──────────┘        └──────────┘  └──────────┘

1. Deploy canary with 5% traffic
2. Monitor metrics for 30 minutes
3. If healthy, increase to 25%
4. Monitor for 1 hour
5. If healthy, increase to 100%
6. Decommission old version
```

## Architecture Decision Records (ADRs)

### ADR Summary

Created comprehensive ADR documents in memory with the following key decisions:

1. **Component Architecture**: Layered architecture with clear separation between MCP protocol, business logic, and BigQuery client
2. **Security**: Workload Identity Federation for keyless authentication, IAM-based authorization
3. **Data Flow**: Request validation → Authentication → Authorization → Query execution → Response formatting
4. **Error Handling**: Retry with exponential backoff, circuit breaker pattern, graceful degradation
5. **Observability**: OpenTelemetry for metrics and traces, Winston for structured logging
6. **Scalability**: Horizontal auto-scaling, multi-level caching, connection pooling, rate limiting

## Next Steps

The architecture documentation is complete. Key deliverables:

1. ✅ System Overview with component diagrams
2. ✅ Component Architecture (C4 Level 2)
3. ✅ Data Flow Diagrams for all major operations
4. ✅ Security Architecture with WIF integration
5. ✅ Error Handling Strategy with retry patterns
6. ✅ Observability Design with logs, metrics, traces
7. ✅ Scalability Patterns for horizontal scaling

All architectural decisions have been documented and stored in memory for cross-team coordination.
