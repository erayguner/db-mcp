# Monitoring Module

Comprehensive health monitoring and observability for the BigQuery MCP server.

## Components

### Health Monitor (`health-monitor.ts`)

The core health monitoring system that tracks all components:

- **Connection Pool Health**: Monitor connection state, queue depth, and failure rates
- **Dataset Manager Cache**: Track cache hit rates, utilization, and eviction
- **WIF Token Validation**: Verify authentication system health
- **Query Performance**: Monitor latency, errors, and cost efficiency

### Health Endpoints (`health-endpoints.ts`)

HTTP-compatible health check endpoints:

- `/health/live` - Liveness probe (Cloud Run compatible)
- `/health/ready` - Readiness probe (Cloud Run compatible)
- `/health` - Comprehensive health report
- `/health/component/{name}` - Component-specific health

### Integration Points

- **OpenTelemetry Metrics**: Export to Cloud Monitoring
- **Event Emitters**: Real-time health status updates
- **MCP Protocol**: Health resources and tools
- **Alert Integration**: Emit alerts for unhealthy states

## Quick Start

```typescript
import { HealthMonitor } from './monitoring/health-monitor.js';
import { HealthEndpoints } from './monitoring/health-endpoints.js';

// Create monitor
const healthMonitor = new HealthMonitor({
  enableAutoChecks: true,
  checkInterval: 30000,
});

// Register components
healthMonitor.registerComponents({
  connectionPool,
  datasetManager,
  wifAuth,
  queryMetrics,
});

// Setup endpoints
const healthEndpoints = new HealthEndpoints(healthMonitor);

// Check health
const report = await healthMonitor.performHealthCheck();
console.log(`Status: ${report.status}`);
```

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     Health Monitor                          │
│  - Automatic health checks (configurable interval)          │
│  - Component registration and monitoring                    │
│  - Status aggregation and reporting                         │
│  - Event emission for alerts                                │
└─────────────────────────────────────────────────────────────┘
                              │
          ┌───────────────────┼───────────────────┐
          ▼                   ▼                   ▼
┌──────────────────┐ ┌─────────────────┐ ┌──────────────────┐
│ Connection Pool  │ │ Dataset Manager │ │ Query Performance│
│   Health Check   │ │   Cache Check   │ │    Tracking      │
└──────────────────┘ └─────────────────┘ └──────────────────┘
          │                   │                   │
          └───────────────────┼───────────────────┘
                              ▼
                    ┌──────────────────┐
                    │ Health Endpoints │
                    │  - /health/live  │
                    │  - /health/ready │
                    │  - /health       │
                    └──────────────────┘
```

## Health Check Components

### 1. Connection Pool

**Metrics Tracked:**
- Total connections (active + idle)
- Active vs idle connection ratio
- Waiting request queue length
- Connection failure rate
- Average acquire time

**Health Criteria:**
- Minimum healthy connections met
- Waiting requests within threshold
- Failure rate acceptable
- Pool operational

### 2. Dataset Manager Cache

**Metrics Tracked:**
- Cache size and utilization
- Hit rate for datasets and tables
- LRU eviction rate
- Cache efficiency

**Health Criteria:**
- Hit rate above minimum threshold
- Cache utilization healthy
- Eviction rate acceptable

### 3. Query Performance

**Metrics Tracked:**
- Query error rate
- Average latency
- Cache effectiveness
- Cost efficiency
- Slow query count
- Expensive query count

**Health Criteria:**
- Error rate below threshold
- Latency within acceptable range
- Cache hit rate sufficient
- Cost per query reasonable

### 4. WIF Token

**Metrics Tracked:**
- Configuration validity
- Token system operational status
- Authentication availability

**Health Criteria:**
- WIF properly configured
- Token exchange operational

## Events

The health monitor emits the following events:

### `health:check`

Emitted after each health check cycle.

```typescript
healthMonitor.on('health:check', (report: SystemHealthReport) => {
  console.log(`Status: ${report.status}`);
  console.log(`Components: ${report.components.length}`);
});
```

### `health:alert`

Emitted when system is degraded or unhealthy.

```typescript
healthMonitor.on('health:alert', ({ severity, report }) => {
  if (severity === 'critical') {
    sendAlert(report);
  }
});
```

## Configuration

### Health Monitor Config

```typescript
interface HealthMonitorConfig {
  checkInterval: number;              // Auto-check interval (ms)
  enableAutoChecks: boolean;          // Enable automatic checks

  connectionPoolThresholds: {
    minHealthyConnections: number;    // Minimum required connections
    maxWaitingRequests: number;       // Max acceptable queue depth
    maxFailureRate: number;           // Max failure percentage (0-1)
  };

  cacheThresholds: {
    minHitRate: number;               // Minimum cache hit rate (0-1)
    maxEvictionRate: number;          // Max eviction rate (0-1)
  };

  queryThresholds: {
    maxErrorRate: number;             // Max query error rate (0-1)
    maxAverageLatency: number;        // Max average latency (ms)
  };

  wifTokenThresholds: {
    minTokenLifetime: number;         // Min token lifetime (seconds)
  };
}
```

### Default Thresholds

```typescript
{
  checkInterval: 30000,              // 30 seconds
  enableAutoChecks: true,

  connectionPoolThresholds: {
    minHealthyConnections: 1,
    maxWaitingRequests: 10,
    maxFailureRate: 0.1,             // 10%
  },

  cacheThresholds: {
    minHitRate: 0.3,                 // 30%
    maxEvictionRate: 0.5,            // 50%
  },

  queryThresholds: {
    maxErrorRate: 0.1,               // 10%
    maxAverageLatency: 5000,         // 5 seconds
  },

  wifTokenThresholds: {
    minTokenLifetime: 300,           // 5 minutes
  },
}
```

## Cloud Run Integration

### Deployment Configuration

```yaml
apiVersion: serving.knative.dev/v1
kind: Service
metadata:
  name: bigquery-mcp-server
spec:
  template:
    metadata:
      annotations:
        autoscaling.knative.dev/minScale: "1"
        autoscaling.knative.dev/maxScale: "10"
    spec:
      containers:
        - image: gcr.io/PROJECT_ID/bigquery-mcp-server
          ports:
            - containerPort: 8080

          # Liveness probe
          livenessProbe:
            httpGet:
              path: /health/live
              port: 8080
            initialDelaySeconds: 10
            periodSeconds: 10
            timeoutSeconds: 5
            failureThreshold: 3

          # Readiness probe
          readinessProbe:
            httpGet:
              path: /health/ready
              port: 8080
            initialDelaySeconds: 5
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 3

          # Startup probe
          startupProbe:
            httpGet:
              path: /health/ready
              port: 8080
            initialDelaySeconds: 0
            periodSeconds: 5
            timeoutSeconds: 3
            failureThreshold: 12
```

## Monitoring and Alerting

### Cloud Monitoring Dashboard

Create custom dashboards with:

- Overall health status gauge
- Component health status (grid)
- Health check success rate (line chart)
- Alert frequency (bar chart)
- Response time distribution (histogram)

### Alert Policies

Recommended alert policies:

1. **Critical: Service Unhealthy**
   - Condition: Health status = unhealthy
   - Duration: 2 minutes
   - Notification: Immediate

2. **Warning: Service Degraded**
   - Condition: Health status = degraded
   - Duration: 5 minutes
   - Notification: Standard

3. **Info: Component Degraded**
   - Condition: Any component degraded
   - Duration: 10 minutes
   - Notification: Email

## Best Practices

1. **Tune Thresholds**: Adjust thresholds based on actual workload patterns
2. **Monitor Trends**: Track health metrics over time to identify patterns
3. **Act on Degraded**: Don't wait for unhealthy - address degraded states
4. **Test Health Checks**: Verify endpoints work during deployment
5. **Document Baselines**: Establish normal operating ranges
6. **Integrate Alerts**: Connect health events to monitoring systems
7. **Review Regularly**: Analyze health reports weekly

## Troubleshooting

See [Health Monitoring Documentation](../../docs/health-monitoring.md) for detailed troubleshooting guides.

## Examples

See [Health Monitoring Integration Examples](../../docs/examples/health-monitoring-integration.ts) for complete implementation examples.

## API Reference

### HealthMonitor

```typescript
class HealthMonitor extends EventEmitter {
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

## Related

- [Query Metrics](../bigquery/query-metrics.ts)
- [Connection Pool](../bigquery/connection-pool.ts)
- [Dataset Manager](../bigquery/dataset-manager.ts)
- [Telemetry](../telemetry/metrics.ts)
