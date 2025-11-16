# Health Monitoring System

Comprehensive health monitoring for the BigQuery MCP server with Cloud Run compatibility.

## Overview

The health monitoring system provides:

- **Component Health Checks**: Monitor all system components individually
- **Readiness Probes**: Determine if the service is ready to accept requests
- **Liveness Probes**: Verify the service is running and not deadlocked
- **Performance Metrics**: Track query performance, cache efficiency, and resource utilization
- **Alert Integration**: Emit events for unhealthy states
- **Cloud Run Compatible**: Standard health check endpoints

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Health Monitor                          │
│                                                             │
│  ┌─────────────────┐  ┌──────────────────┐                │
│  │ Connection Pool │  │ Dataset Manager  │                │
│  │  Health Check   │  │   Cache Check    │                │
│  └─────────────────┘  └──────────────────┘                │
│                                                             │
│  ┌─────────────────┐  ┌──────────────────┐                │
│  │ WIF Token       │  │ Query Performance│                │
│  │   Validation    │  │    Tracking      │                │
│  └─────────────────┘  └──────────────────┘                │
│                                                             │
│  ┌─────────────────────────────────────────────┐          │
│  │         Health Check Aggregator             │          │
│  │   (Readiness, Liveness, Status)            │          │
│  └─────────────────────────────────────────────┘          │
└─────────────────────────────────────────────────────────────┘
         │                    │                    │
         ▼                    ▼                    ▼
    /health           /health/ready        /health/live
```

## Components Monitored

### 1. Connection Pool Health

**Checks:**
- Active vs idle connection ratio
- Waiting request queue length
- Connection failure rate
- Pool availability and uptime
- Average acquire time

**Thresholds:**
- Minimum healthy connections: 1
- Maximum waiting requests: 10
- Maximum failure rate: 10%

**Status Determination:**
- **Healthy**: All metrics within thresholds
- **Degraded**: Metrics approaching limits (within 1.5x)
- **Unhealthy**: Metrics exceeding thresholds

### 2. Dataset Manager Cache

**Checks:**
- Dataset cache hit rate
- Table cache hit rate
- Cache utilization (size vs capacity)
- LRU eviction rate

**Thresholds:**
- Minimum hit rate: 30%
- Maximum cache utilization: 90% (degraded), 95% (unhealthy)

**Metrics:**
```typescript
{
  datasets: {
    size: number,        // Current cache entries
    maxSize: number,     // Maximum capacity
    hitRate: number      // Cache hit percentage
  },
  tables: {
    size: number,
    maxSize: number,
    hitRate: number
  }
}
```

### 3. WIF Token Health

**Checks:**
- WIF configuration validity
- Token system operational status
- Provider and pool availability

**Note:** Active token validation occurs during token exchange operations.

### 4. Query Performance

**Checks:**
- Query error rate
- Average query latency
- Cache effectiveness
- Cost efficiency

**Thresholds:**
- Maximum error rate: 10%
- Maximum average latency: 5000ms
- Minimum cache hit rate: 20%
- Average cost threshold: $0.10

**Metrics:**
```typescript
{
  errorRate: number,           // Percentage of failed queries
  averageDuration: number,     // Average query time in ms
  cacheHitRate: number,        // Query cache effectiveness
  averageCost: number,         // Average cost per query in USD
  slowQueries: QueryMetrics[], // Queries exceeding threshold
  expensiveQueries: QueryMetrics[] // High-cost queries
}
```

## Health Endpoints

### Liveness Probe

**Endpoint:** `GET /health/live`

**Purpose:** Determines if the service is alive and responsive.

**Response Codes:**
- `200`: Service is alive
- `503`: Service is not responding

**Example Response:**
```json
{
  "status": "alive",
  "timestamp": 1699000000000,
  "uptime": 3600000
}
```

**Cloud Run Configuration:**
```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  initialDelaySeconds: 10
  periodSeconds: 10
  timeoutSeconds: 5
  failureThreshold: 3
```

### Readiness Probe

**Endpoint:** `GET /health/ready`

**Purpose:** Determines if the service is ready to accept requests.

**Response Codes:**
- `200`: Service is ready
- `503`: Service is not ready

**Example Response:**
```json
{
  "status": "ready",
  "components": {
    "connectionPool": true,
    "datasetManager": true,
    "wifAuth": true,
    "queryMetrics": true
  },
  "timestamp": 1699000000000
}
```

**Cloud Run Configuration:**
```yaml
readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  initialDelaySeconds: 5
  periodSeconds: 5
  timeoutSeconds: 3
  failureThreshold: 3
```

### Comprehensive Health Check

**Endpoint:** `GET /health`

**Purpose:** Provides detailed health information for all components.

**Response Codes:**
- `200`: System is healthy or degraded (still accepting requests)
- `503`: System is unhealthy

**Example Response:**
```json
{
  "status": "healthy",
  "timestamp": 1699000000000,
  "uptime": 3600000,
  "components": [
    {
      "name": "connection-pool",
      "status": "healthy",
      "checks": {
        "activeConnections": {
          "status": "healthy",
          "message": "2/5 connections active",
          "details": {
            "active": 2,
            "idle": 3,
            "total": 5
          },
          "timestamp": 1699000000000,
          "duration": 5
        },
        "waitingRequests": {
          "status": "healthy",
          "message": "0 requests waiting",
          "details": { "waitingRequests": 0 },
          "timestamp": 1699000000000,
          "duration": 5
        }
      },
      "lastCheck": 1699000000000
    }
  ],
  "metrics": {
    "totalChecks": 8,
    "healthyChecks": 7,
    "degradedChecks": 1,
    "unhealthyChecks": 0
  },
  "version": "1.0.0"
}
```

### Component-Specific Health

**Endpoint:** `GET /health/component/{name}`

**Available Components:**
- `connection-pool`
- `dataset-manager-cache`
- `wif-authentication`
- `query-performance`

**Example:** `GET /health/component/connection-pool`

## Usage

### Basic Setup

```typescript
import { HealthMonitor } from './monitoring/health-monitor.js';
import { ConnectionPool } from './bigquery/connection-pool.js';
import { DatasetManager } from './bigquery/dataset-manager.js';
import { WorkloadIdentityFederation } from './auth/workload-identity.js';
import { QueryMetricsTracker } from './bigquery/query-metrics.js';

// Initialize components
const connectionPool = new ConnectionPool(poolConfig);
const datasetManager = new DatasetManager(datasetConfig);
const wifAuth = new WorkloadIdentityFederation(wifConfig);
const queryMetrics = new QueryMetricsTracker();

// Create health monitor
const healthMonitor = new HealthMonitor({
  checkInterval: 30000, // 30 seconds
  enableAutoChecks: true,
  connectionPoolThresholds: {
    minHealthyConnections: 2,
    maxWaitingRequests: 5,
    maxFailureRate: 0.05, // 5%
  },
  cacheThresholds: {
    minHitRate: 0.4, // 40%
    maxEvictionRate: 0.3, // 30%
  },
  queryThresholds: {
    maxErrorRate: 0.05, // 5%
    maxAverageLatency: 3000, // 3 seconds
  },
});

// Register components
healthMonitor.registerComponents({
  connectionPool,
  datasetManager,
  wifAuth,
  queryMetrics,
});
```

### Manual Health Check

```typescript
// Perform comprehensive health check
const report = await healthMonitor.performHealthCheck();

console.log(`System Status: ${report.status}`);
console.log(`Total Components: ${report.components.length}`);
console.log(`Healthy Checks: ${report.metrics.healthyChecks}`);

// Check specific component
const poolHealth = healthMonitor.getComponentHealth('connection-pool');
if (poolHealth?.status === HealthStatus.UNHEALTHY) {
  console.error('Connection pool is unhealthy!', poolHealth.checks);
}
```

### Health Event Listeners

```typescript
// Listen for health check events
healthMonitor.on('health:check', (report) => {
  console.log(`Health check completed: ${report.status}`);
});

// Listen for alerts
healthMonitor.on('health:alert', ({ severity, report }) => {
  if (severity === 'critical') {
    // Send alert to monitoring system
    sendAlert({
      title: 'BigQuery MCP Server Critical Health Issue',
      severity: 'critical',
      details: report,
    });
  }
});
```

### MCP Integration

```typescript
import { HealthEndpoints } from './monitoring/health-endpoints.js';

const healthEndpoints = new HealthEndpoints(healthMonitor);

// Add MCP resource
server.setRequestHandler(ListResourcesRequestSchema, async () => ({
  resources: [
    {
      uri: 'health://system',
      name: 'System Health',
      description: 'Comprehensive system health report',
      mimeType: 'application/json',
    },
  ],
}));

server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
  if (request.params.uri === 'health://system') {
    return {
      contents: [await healthEndpoints.getMCPHealthResource()],
    };
  }
});

// Add MCP health check tool
server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [
    {
      name: 'check_health',
      description: 'Get system health status and component information',
      inputSchema: {
        type: 'object',
        properties: {
          component: {
            type: 'string',
            description: 'Optional: specific component to check',
            enum: ['connection-pool', 'dataset-manager-cache', 'wif-authentication', 'query-performance'],
          },
        },
      },
    },
  ],
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name === 'check_health') {
    const { component } = request.params.arguments as { component?: string };

    if (component) {
      const health = await healthEndpoints.handleComponentHealth(component);
      return {
        content: [{
          type: 'text',
          text: health.body,
        }],
      };
    }

    const summary = await healthEndpoints.getHealthSummary();
    return {
      content: [{
        type: 'text',
        text: summary,
      }],
    };
  }
});
```

## Cloud Monitoring Integration

### Custom Metrics

The health monitor emits events that can be integrated with Cloud Monitoring:

```typescript
import { getMetrics } from './telemetry/metrics.js';

healthMonitor.on('health:check', (report) => {
  const metrics = getMetrics();

  // Record overall health status
  metrics.healthStatus.record(
    report.status === HealthStatus.HEALTHY ? 1 :
    report.status === HealthStatus.DEGRADED ? 0.5 : 0
  );

  // Record component health
  for (const component of report.components) {
    metrics.componentHealth.record(
      component.status === HealthStatus.HEALTHY ? 1 : 0,
      { component: component.name }
    );
  }
});
```

### Alerting Policies

Create Cloud Monitoring alert policies based on health metrics:

```yaml
# Example alerting policy
displayName: "BigQuery MCP Server Unhealthy"
conditions:
  - displayName: "Health check failure"
    conditionThreshold:
      filter: 'metric.type="custom.googleapis.com/mcp/health/status"'
      comparison: COMPARISON_LT
      thresholdValue: 0.5
      duration: 300s
      aggregations:
        - alignmentPeriod: 60s
          perSeriesAligner: ALIGN_MEAN
notificationChannels:
  - projects/PROJECT_ID/notificationChannels/CHANNEL_ID
```

## Troubleshooting

### High Connection Pool Failure Rate

**Symptoms:**
- `failureRate` check shows `degraded` or `unhealthy`
- High `totalFailed` metric

**Possible Causes:**
- BigQuery API rate limiting
- Network connectivity issues
- Invalid credentials

**Resolution:**
1. Check BigQuery API quotas in Cloud Console
2. Review connection pool configuration
3. Verify WIF token exchange is working
4. Increase `maxRetries` and `retryDelayMs`

### Low Cache Hit Rate

**Symptoms:**
- `datasetCacheHitRate` or `tableCacheHitRate` below threshold
- Excessive BigQuery API calls

**Possible Causes:**
- Cache size too small
- TTL too short
- High dataset/table volatility

**Resolution:**
1. Increase `cacheSize` configuration
2. Extend `cacheTTLMs` if data is relatively static
3. Monitor cache eviction patterns
4. Consider different caching strategies

### High Query Error Rate

**Symptoms:**
- `errorRate` check shows `unhealthy`
- Many failed queries in metrics

**Possible Causes:**
- Invalid SQL queries
- Insufficient permissions
- Quota exceeded
- Table/dataset not found

**Resolution:**
1. Review query error logs
2. Validate SQL syntax
3. Check BigQuery permissions
4. Monitor quota usage
5. Implement query validation

### Service Not Ready

**Symptoms:**
- Readiness check returns `503`
- One or more components not ready

**Possible Causes:**
- Connection pool not initialized
- Minimum connections not established
- Component initialization failure

**Resolution:**
1. Check component initialization logs
2. Verify configuration is correct
3. Ensure BigQuery API is accessible
4. Review startup sequence

## Performance Impact

The health monitoring system is designed for minimal performance impact:

- **Health checks**: ~10-50ms per check cycle
- **Memory overhead**: ~1MB for metrics tracking
- **CPU usage**: <1% during health checks
- **Network**: No additional BigQuery API calls (uses existing metrics)

### Auto-Check Interval Recommendations

- **Production**: 30-60 seconds
- **Development**: 10-30 seconds
- **High-traffic**: 60-120 seconds (reduce overhead)

## Best Practices

1. **Enable Auto-Checks**: Set `enableAutoChecks: true` for continuous monitoring
2. **Set Appropriate Thresholds**: Tune thresholds based on your workload
3. **Monitor Degraded States**: Act on degraded status before it becomes unhealthy
4. **Integrate Alerts**: Connect health events to your alerting system
5. **Review Metrics**: Regularly analyze health reports for trends
6. **Test Health Checks**: Verify health endpoints during deployment
7. **Document Baselines**: Establish normal operating ranges for metrics

## API Reference

### HealthMonitor

```typescript
class HealthMonitor {
  constructor(config?: Partial<HealthMonitorConfig>);

  registerComponents(components: {
    connectionPool?: ConnectionPool;
    datasetManager?: DatasetManager;
    wifAuth?: WorkloadIdentityFederation;
    queryMetrics?: QueryMetricsTracker;
  }): void;

  async performHealthCheck(): Promise<SystemHealthReport>;
  async checkReadiness(): Promise<ReadinessCheckResult>;
  async checkLiveness(): Promise<LivenessCheckResult>;

  getLastHealthReport(): SystemHealthReport | null;
  getComponentHealth(name: string): ComponentHealth | null;
  getUptime(): number;

  stopAutoChecks(): void;
  shutdown(): void;

  // Events
  on('health:check', (report: SystemHealthReport) => void): void;
  on('health:alert', ({ severity, report }) => void): void;
}
```

### HealthEndpoints

```typescript
class HealthEndpoints {
  constructor(healthMonitor: HealthMonitor);

  async handleLiveness(): Promise<HealthEndpointResponse>;
  async handleReadiness(): Promise<HealthEndpointResponse>;
  async handleHealth(): Promise<HealthEndpointResponse>;
  async handleComponentHealth(name: string): Promise<HealthEndpointResponse>;

  async getMCPHealthResource(): Promise<MCPResource>;
  async getHealthSummary(): Promise<string>;
}
```

## See Also

- [Connection Pool Configuration](./connection-pool.md)
- [Dataset Manager Caching](./dataset-manager.md)
- [Query Metrics Tracking](./query-metrics.md)
- [Cloud Run Health Checks](https://cloud.google.com/run/docs/configuring/healthchecks)
