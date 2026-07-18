# Observability Design

## Overview

The BigQuery MCP Server implements comprehensive observability using the three pillars: Logs, Metrics, and Traces. All
telemetry is exported to Google Cloud's operations suite for unified monitoring and debugging.

## Logging Architecture

### Log Levels and Usage

```typescript
enum LogLevel {
  ERROR = 0, // System errors, failures requiring immediate attention
  WARN = 1, // Degraded performance, retries, recoverable errors
  INFO = 2, // Business events, query execution, auth success
  DEBUG = 3, // Detailed flow, state changes, caching
  TRACE = 4, // Everything including request/response payloads
}

// Log level by environment
const logLevelByEnv = {
  production: LogLevel.INFO,
  staging: LogLevel.DEBUG,
  development: LogLevel.TRACE,
};
```

### Structured Logging with Winston

```typescript
import winston from 'winston';

const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp({
      format: 'YYYY-MM-DDTHH:mm:ss.SSSZ',
    }),
    winston.format.errors({ stack: true }),
    winston.format.metadata({
      fillExcept: ['message', 'level', 'timestamp', 'label'],
    }),
    winston.format.json()
  ),
  defaultMeta: {
    service: 'bigquery-mcp-server',
    version: process.env.npm_package_version,
    environment: process.env.NODE_ENV,
  },
  transports: [
    // Console transport for development
    new winston.transports.Console({
      format: winston.format.combine(winston.format.colorize(), winston.format.simple()),
    }),

    // File transport for errors
    new winston.transports.File({
      filename: 'logs/error.log',
      level: 'error',
      maxsize: 10485760, // 10MB
      maxFiles: 5,
      tailable: true,
    }),

    // File transport for all logs
    new winston.transports.File({
      filename: 'logs/combined.log',
      maxsize: 10485760, // 10MB
      maxFiles: 10,
      tailable: true,
    }),
  ],
});

// Add Cloud Logging transport for production
if (process.env.NODE_ENV === 'production') {
  const { LoggingWinston } = require('@google-cloud/logging-winston');

  logger.add(
    new LoggingWinston({
      projectId: process.env.GCP_PROJECT_ID,
      keyFilename: process.env.GOOGLE_APPLICATION_CREDENTIALS,
      labels: {
        service: 'bigquery-mcp-server',
        version: process.env.npm_package_version,
      },
    })
  );
}

export { logger };
```

### Log Context Enrichment

```typescript
class LogContext {
  private static contexts = new Map<string, any>();

  // Set context for current request
  static set(key: string, value: any): void {
    this.contexts.set(key, value);
  }

  // Get all contexts
  static getAll(): Record<string, any> {
    return Object.fromEntries(this.contexts.entries());
  }

  // Clear contexts (call at end of request)
  static clear(): void {
    this.contexts.clear();
  }
}

// Middleware to enrich logs with context
function enrichLogger(req: Request, res: Response, next: NextFunction) {
  const requestId = req.headers['x-request-id'] || generateRequestId();

  LogContext.set('requestId', requestId);
  LogContext.set('principal', req.principal);
  LogContext.set('sourceIP', req.ip);
  LogContext.set('userAgent', req.headers['user-agent']);

  // Override logger methods to include context
  const originalLog = logger.info;
  logger.info = (message: string, meta?: any) => {
    originalLog.call(logger, message, {
      ...meta,
      ...LogContext.getAll(),
    });
  };

  // Cleanup after request
  res.on('finish', () => {
    LogContext.clear();
  });

  next();
}
```

### Key Log Events

```typescript
// Query execution
logger.info('Query execution started', {
  operation: 'query_execute',
  query: query.substring(0, 200), // Truncate for privacy
  parameters: Object.keys(params),
  dryRun: options.dryRun,
  maxResults: options.maxResults,
});

logger.info('Query execution completed', {
  operation: 'query_execute',
  jobId: job.id,
  durationMs: elapsed,
  rowsReturned: result.totalRows,
  bytesScanned: result.totalBytesProcessed,
  cacheHit: result.cacheHit,
});

// Authentication
logger.info('Authentication successful', {
  operation: 'auth_wif',
  principal: serviceAccount,
  tokenExpiresAt: expiryTime,
  tokenSource: 'wif',
});

logger.error('Authentication failed', {
  operation: 'auth_wif',
  error: error.message,
  errorCode: error.code,
  retryAttempt: attemptNumber,
});

// Schema operations
logger.debug('Schema cache hit', {
  operation: 'get_schema',
  resource: `${datasetId}.${tableId}`,
  cacheAge: cacheEntry.age,
  ttl: cacheEntry.ttl,
});

// Errors
logger.error('Query execution failed', {
  operation: 'query_execute',
  error: error.message,
  errorCode: error.code,
  query: query.substring(0, 200),
  jobId: job?.id,
  stack: error.stack,
});
```

## Metrics Architecture

### OpenTelemetry Metrics

```typescript
import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { Resource } from '@opentelemetry/resources';
import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';
import { CloudMonitoringMetricExporter } from '@google-cloud/opentelemetry-cloud-monitoring-exporter';

// Initialize meter provider
const meterProvider = new MeterProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'bigquery-mcp-server',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version,
    [SemanticResourceAttributes.DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV,
  }),
  readers: [
    new PeriodicExportingMetricReader({
      exporter: new CloudMonitoringMetricExporter({
        projectId: process.env.GCP_PROJECT_ID,
      }),
      exportIntervalMillis: 60000, // Export every 60s
    }),
  ],
});

const meter = meterProvider.getMeter('bigquery-mcp-server');
```

### Key Metrics

```typescript
// Counter: Total requests
const requestCounter = meter.createCounter('mcp.requests.total', {
  description: 'Total number of MCP requests',
  unit: '1',
});

requestCounter.add(1, {
  method: 'query_bigquery',
  status: 'success',
});

// Counter: Query executions
const queryCounter = meter.createCounter('bigquery.queries.total', {
  description: 'Total number of BigQuery queries executed',
  unit: '1',
});

queryCounter.add(1, {
  dataset: datasetId,
  status: result.error ? 'error' : 'success',
  cached: result.cacheHit ? 'true' : 'false',
});

// Histogram: Query duration
const queryDuration = meter.createHistogram('bigquery.query.duration', {
  description: 'BigQuery query execution duration',
  unit: 'ms',
});

queryDuration.record(elapsedMs, {
  dataset: datasetId,
  complexity: estimateComplexity(query),
});

// Histogram: Bytes scanned
const bytesScanned = meter.createHistogram('bigquery.bytes.scanned', {
  description: 'Bytes scanned by BigQuery queries',
  unit: 'By',
});

bytesScanned.record(result.totalBytesProcessed, {
  dataset: datasetId,
});

// Gauge: Active connections
const activeConnections = meter.createObservableGauge('bigquery.connections.active', {
  description: 'Number of active BigQuery connections',
  unit: '1',
});

activeConnections.addCallback((observableResult) => {
  observableResult.observe(connectionPool.activeCount);
});

// Gauge: Cache hit rate
const cacheHitRate = meter.createObservableGauge('cache.hit.rate', {
  description: 'Cache hit rate percentage',
  unit: '%',
});

cacheHitRate.addCallback((observableResult) => {
  const hits = cacheStats.hits;
  const total = cacheStats.hits + cacheStats.misses;
  const rate = total > 0 ? (hits / total) * 100 : 0;

  observableResult.observe(rate, {
    cache_type: 'schema',
  });
});

// Counter: Errors
const errorCounter = meter.createCounter('errors.total', {
  description: 'Total number of errors',
  unit: '1',
});

errorCounter.add(1, {
  error_type: error.name,
  error_code: error.code,
  operation: 'query_execute',
  retryable: isRetryable(error).toString(),
});

// Counter: Auth events
const authCounter = meter.createCounter('auth.events.total', {
  description: 'Total number of authentication events',
  unit: '1',
});

authCounter.add(1, {
  event_type: 'token_acquired',
  token_source: 'wif',
  principal: serviceAccount,
});

// Histogram: Token lifetime
const tokenLifetime = meter.createHistogram('auth.token.lifetime', {
  description: 'Token lifetime in seconds',
  unit: 's',
});

tokenLifetime.record(3600, {
  token_type: 'service_account',
});

// Tenant-scoped tool metrics (GEAP-style topology view)
const toolCallCounter = meter.createCounter('mcp.tool.calls.total', {
  description: 'Total MCP tool calls, labeled by tool and tenant',
  unit: '1',
});
const toolCallLatency = meter.createHistogram('mcp.tool.call.duration', {
  description: 'End-to-end MCP tool call latency',
  unit: 'ms',
});

// recordToolCall(tool, outcome, durationMs, tenantId) emits both.
toolCallCounter.add(1, { tool: 'query_bigquery', outcome: 'allow', tenant_id: 'tenant-a' });
toolCallLatency.record(124, { tool: 'query_bigquery', outcome: 'allow', tenant_id: 'tenant-a' });
```

### Metric Dashboards

**BigQuery Operations Dashboard:**

```
┌────────────────────────────────────────────────────────────┐
│ BigQuery MCP Server - Operations                          │
├────────────────────────────────────────────────────────────┤
│                                                            │
│  Query Rate (QPS)                                          │
│  ┌──────────────────────────────────────────────────┐     │
│  │         [Line chart: queries/sec over time]      │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
│  Query Duration (P50, P95, P99)                            │
│  ┌──────────────────────────────────────────────────┐     │
│  │    [Line chart: latency percentiles over time]   │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
│  Bytes Scanned                                             │
│  ┌──────────────────────────────────────────────────┐     │
│  │      [Line chart: bytes scanned over time]       │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
│  Error Rate                                                │
│  ┌──────────────────────────────────────────────────┐     │
│  │        [Line chart: errors/min over time]        │     │
│  └──────────────────────────────────────────────────┘     │
│                                                            │
│  Cache Hit Rate                                            │
│  ┌──────────────────────────────────────────────────┐     │
│  │     [Line chart: cache hit % over time]          │     │
│  └──────────────────────────────────────────────────┘     │
└────────────────────────────────────────────────────────────┘
```

## Distributed Tracing

### OpenTelemetry Tracing

```typescript
import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { CloudTraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';

// Initialize tracer provider
const provider = new NodeTracerProvider({
  resource: new Resource({
    [SemanticResourceAttributes.SERVICE_NAME]: 'bigquery-mcp-server',
    [SemanticResourceAttributes.SERVICE_VERSION]: process.env.npm_package_version,
  }),
});

// Configure exporter
const exporter = new CloudTraceExporter({
  projectId: process.env.GCP_PROJECT_ID,
});

provider.addSpanProcessor(
  new BatchSpanProcessor(exporter, {
    maxQueueSize: 100,
    maxExportBatchSize: 10,
    scheduledDelayMillis: 500,
  })
);

provider.register();

// Auto-instrument common libraries
registerInstrumentations({
  instrumentations: [
    getNodeAutoInstrumentations({
      '@opentelemetry/instrumentation-http': { enabled: true },
      '@opentelemetry/instrumentation-grpc': { enabled: true },
      '@opentelemetry/instrumentation-fs': { enabled: false }, // Noisy
    }),
  ],
});

const tracer = trace.getTracer('bigquery-mcp-server', '1.0.0');
```

### Trace Spans

```typescript
async function executeQuery(query: string, options: QueryOptions): Promise<QueryResult> {
  // Create parent span
  const span = tracer.startSpan('bigquery.query.execute', {
    kind: SpanKind.CLIENT,
    attributes: {
      'db.system': 'bigquery',
      'db.operation': 'SELECT',
      'db.statement': query.substring(0, 500),
      'bigquery.dry_run': options.dryRun || false,
      'bigquery.max_results': options.maxResults,
    },
  });

  try {
    // Child span: Validation
    await tracer.startActiveSpan('query.validate', async (validateSpan) => {
      try {
        await this.validator.validate(query);
        validateSpan.setStatus({ code: SpanStatusCode.OK });
      } finally {
        validateSpan.end();
      }
    });

    // Child span: Authentication
    await tracer.startActiveSpan('auth.get_token', async (authSpan) => {
      try {
        const token = await this.authManager.getToken();
        authSpan.setAttribute('auth.token_source', 'wif');
        authSpan.setAttribute('auth.cached', token.fromCache);
        authSpan.setStatus({ code: SpanStatusCode.OK });
      } finally {
        authSpan.end();
      }
    });

    // Child span: Submit job
    let jobId: string;
    await tracer.startActiveSpan('bigquery.job.submit', async (submitSpan) => {
      try {
        const job = await this.bigquery.createQueryJob({ query });
        jobId = job.id;
        submitSpan.setAttribute('bigquery.job_id', jobId);
        submitSpan.setStatus({ code: SpanStatusCode.OK });
      } finally {
        submitSpan.end();
      }
    });

    // Child span: Poll for completion
    await tracer.startActiveSpan('bigquery.job.wait', async (waitSpan) => {
      try {
        await this.waitForJob(jobId!);
        waitSpan.setStatus({ code: SpanStatusCode.OK });
      } finally {
        waitSpan.end();
      }
    });

    // Child span: Fetch results
    let result: QueryResult;
    await tracer.startActiveSpan('bigquery.results.fetch', async (fetchSpan) => {
      try {
        result = await this.getResults(jobId!);
        fetchSpan.setAttribute('bigquery.rows_returned', result.totalRows);
        fetchSpan.setAttribute('bigquery.bytes_scanned', result.totalBytesProcessed);
        fetchSpan.setAttribute('bigquery.cache_hit', result.cacheHit);
        fetchSpan.setStatus({ code: SpanStatusCode.OK });
      } finally {
        fetchSpan.end();
      }
    });

    // Set parent span attributes
    span.setAttribute('bigquery.job_id', jobId!);
    span.setAttribute('bigquery.rows_returned', result!.totalRows);
    span.setAttribute('bigquery.bytes_scanned', result!.totalBytesProcessed);
    span.setStatus({ code: SpanStatusCode.OK });

    return result!;
  } catch (error) {
    // Record error in span
    span.recordException(error);
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });

    throw error;
  } finally {
    span.end();
  }
}
```

### Trace Context Propagation

```typescript
import { context, propagation } from '@opentelemetry/api';

// Extract trace context from incoming request
function extractTraceContext(req: Request): Context {
  return propagation.extract(context.active(), req.headers);
}

// Inject trace context into outgoing request
function injectTraceContext(req: OutgoingRequest): void {
  propagation.inject(context.active(), req.headers);
}

// Use context in async operations
async function handleRequest(req: Request): Promise<Response> {
  const ctx = extractTraceContext(req);

  return context.with(ctx, async () => {
    // All operations in this scope share the trace context
    const result = await executeQuery(req.body.query);
    return { result };
  });
}
```

## Health Checks

The server exposes three probe surfaces. Liveness and readiness are deliberately separate implementations, because their
failure consequences differ: a failed liveness probe restarts the container, while a failed readiness probe only drains
the instance from the load balancer.

### Liveness — `GET /health`, `GET /health/live`

Dependency-free by design. Reaching the handler proves the event loop is turning and the process can serve HTTP, which
is all liveness should assert.

```json
{ "status": "healthy", "uptimeSeconds": 1234, "timestamp": "2026-07-18T12:00:00.000Z" }
```

A dependency check here would convert a BigQuery outage into a fleet-wide crash-loop, since restarting cannot repair a
remote dependency.

### Readiness — `GET /readiness`, `GET /health/ready`

Evaluates the probes in the `ReadinessRegistry` (`src/monitoring/readiness.ts`). Returns `200` when every probe passes
and `503` naming the failing dependency otherwise.

```json
{
  "ready": false,
  "checks": [{ "name": "bigquery", "ok": false, "durationMs": 87, "error": "ECONNREFUSED" }],
  "failed": ["bigquery"],
  "cached": false,
  "timestamp": "2026-07-18T12:00:00.000Z"
}
```

Probes run in parallel under a 2s per-probe timeout, verdicts are cached for 5s, and concurrent evaluations are
de-duplicated into one in-flight run. A probe that throws, rejects, or times out is recorded as a failed check rather
than propagating — a probe endpoint that throws looks like a crashed server to an orchestrator.

The BigQuery probe issues a dry-run `SELECT 1`, which proves connectivity, authentication and authorization while
scanning zero bytes. Before the lazily-initialised client exists the probe reports ready on purpose: reporting not-ready
would drain the instance so it never receives the request that triggers initialization.

### Metrics — `GET /metrics`

Prometheus text exposition format from the OpenTelemetry exporter, which is constructed with `preventServerStart: true`
and mounted on this route. Returns `503` before telemetry is initialised, since an empty `200` would misreport the
server as having no metrics.

See [health-monitoring.md](../health-monitoring.md) for the registry API and probe-authoring guidance.

## Alerting Rules

### Google Cloud Monitoring Alerts

```yaml
# Alert: High error rate
- alert: HighErrorRate
  expr: |
    sum(rate(errors.total[5m])) by (operation)
    > 0.05
  for: 5m
  labels:
    severity: warning
  annotations:
    summary: 'High error rate detected'
    description: 'Error rate for {{ $labels.operation }} is {{ $value }}/sec'

# Alert: Query latency
- alert: HighQueryLatency
  expr: |
    histogram_quantile(0.95,
      sum(rate(bigquery.query.duration_bucket[5m])) by (le)
    ) > 30000
  for: 10m
  labels:
    severity: warning
  annotations:
    summary: 'High query latency detected'
    description: 'P95 latency is {{ $value }}ms'

# Alert: Authentication failures
- alert: AuthFailures
  expr: |
    sum(rate(auth.events.total{event_type="failure"}[5m]))
    > 0
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: 'Authentication failures detected'
    description: '{{ $value }} auth failures per second'

# Alert: Low cache hit rate
- alert: LowCacheHitRate
  expr: |
    cache.hit.rate{cache_type="schema"} < 50
  for: 15m
  labels:
    severity: warning
  annotations:
    summary: 'Low cache hit rate'
    description: 'Schema cache hit rate is {{ $value }}%'

# Alert: Service unhealthy
- alert: ServiceUnhealthy
  expr: |
    up{job="bigquery-mcp-server"} == 0
  for: 1m
  labels:
    severity: critical
  annotations:
    summary: 'Service is down'
    description: 'BigQuery MCP Server is not responding to health checks'
```

## Debugging Tools

### Request Tracing

```bash
# Get trace for specific request
gcloud trace list --filter="spanName:bigquery.query.execute" \
  --limit=10 \
  --format="table(traceId,spanId,startTime,latency)"

# View trace details
gcloud trace get <TRACE_ID>
```

### Log Analysis

```bash
# Query logs for errors
gcloud logging read "resource.type=cloud_run_revision AND severity=ERROR" \
  --limit=50 \
  --format=json

# Query logs for specific operation
gcloud logging read "jsonPayload.operation=query_execute AND jsonPayload.durationMs>5000" \
  --limit=10
```

## Next Steps

See [Scalability Patterns](./07-scalability.md) for horizontal and vertical scaling strategies.
