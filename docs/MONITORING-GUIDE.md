# 📊 Monitoring and Observability Guide

## Overview

Comprehensive monitoring and observability setup for the MCP BigQuery Server using Google Cloud's native monitoring stack.

**Components**:
- Cloud Monitoring (metrics & dashboards)
- Cloud Trace (distributed tracing)
- Cloud Logging (structured logs)
- Alert policies (proactive notifications)
- SLO tracking (reliability measurement)
- Uptime checks (availability monitoring)

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│               MCP BigQuery Server                        │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ OpenTelemetry│  │    Winston   │  │   Health     │ │
│  │   Tracing    │  │    Logging   │  │   Check      │ │
│  └──────┬───────┘  └──────┬───────┘  └──────┬───────┘ │
└─────────┼──────────────────┼──────────────────┼─────────┘
          │                  │                  │
          ▼                  ▼                  ▼
┌─────────────────────────────────────────────────────────┐
│                  Google Cloud Platform                   │
│                                                          │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐ │
│  │ Cloud Trace  │  │Cloud Logging │  │Cloud Monitor │ │
│  │              │  │              │  │              │ │
│  │  Traces      │  │  Logs        │  │  Metrics     │ │
│  │  Spans       │  │  Events      │  │  Dashboards  │ │
│  └──────────────┘  └──────────────┘  └──────┬───────┘ │
│                                              │         │
│  ┌──────────────┐  ┌──────────────┐         │         │
│  │ Alerting     │  │  SLO/SLA     │◄────────┘         │
│  │  Policies    │  │  Tracking    │                   │
│  └──────┬───────┘  └──────────────┘                   │
└─────────┼────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────┐
│              Notification Channels                       │
│                                                          │
│    Email    │    Slack    │   PagerDuty   │   SMS      │
└─────────────────────────────────────────────────────────┘
```

---

## Terraform Module

### Module Structure

```
terraform/modules/monitoring/
├── main.tf              # Main monitoring resources
├── variables.tf         # Input variables
├── outputs.tf          # Output values
└── dashboard.json.tpl  # Dashboard template
```

### Usage

```hcl
module "monitoring" {
  source = "./modules/monitoring"

  project_id          = var.project_id
  environment         = var.environment
  cloud_run_location  = var.cloud_run_location
  cloud_run_url       = module.cloud_run.service_url

  # Notification configuration
  alert_email            = "devops@company.com"
  slack_webhook_url      = var.slack_webhook_url
  pagerduty_service_key  = var.pagerduty_service_key

  # Alert thresholds
  error_rate_threshold      = 5    # errors/min
  latency_threshold_ms      = 2000 # P95 latency
  auth_failure_threshold    = 10   # failures/min
  max_instance_threshold    = 50   # max instances
  memory_threshold_percent  = 85   # memory %

  # SLO targets
  availability_slo_target = 0.999  # 99.9%
  latency_slo_target      = 0.95   # 95%

  labels = {
    team        = "platform"
    cost_center = "engineering"
  }
}
```

### Deploy Monitoring

```bash
cd terraform

# Initialize Terraform
terraform init

# Plan monitoring resources
terraform plan -target=module.monitoring

# Apply monitoring configuration
terraform apply -target=module.monitoring
```

---

## Metrics Collection

### Log-Based Metrics

**1. Error Count**
- **Name**: `mcp_bigquery_error_count_{environment}`
- **Type**: DELTA (counter)
- **Filter**: Severity >= ERROR
- **Use**: Track error rate over time

**2. Query Latency**
- **Name**: `mcp_bigquery_query_latency_{environment}`
- **Type**: DISTRIBUTION
- **Unit**: milliseconds
- **Use**: P50/P95/P99 latency tracking

**3. Authentication Failures**
- **Name**: `mcp_bigquery_auth_failures_{environment}`
- **Type**: DELTA (counter)
- **Use**: Security monitoring

**4. BigQuery Bytes Processed**
- **Name**: `mcp_bigquery_bytes_processed_{environment}`
- **Type**: DELTA (counter)
- **Unit**: bytes
- **Use**: Cost tracking and optimization

### OpenTelemetry Metrics

**Custom Application Metrics**:
- `mcp.requests.total` - Total requests by tool
- `mcp.errors.total` - Errors by type
- `mcp.bigquery.query.duration` - Query latency histogram
- `mcp.bigquery.bytes.processed` - Bytes processed
- `mcp.auth.attempts.total` - Auth attempts
- `mcp.auth.failures.total` - Auth failures
- `mcp.connections.active` - Active connections

### Cloud Run Metrics (Automatic)

- `run.googleapis.com/request_count` - Request count
- `run.googleapis.com/request_latencies` - Request latencies
- `run.googleapis.com/container/instance_count` - Instance count
- `run.googleapis.com/container/memory/utilizations` - Memory usage
- `run.googleapis.com/container/cpu/utilizations` - CPU usage

---

## Alert Policies

### Critical Alerts (PagerDuty + Email)

**1. Service Down**
- **Condition**: Uptime check fails for 5 minutes
- **Action**: Page on-call engineer
- **Severity**: Critical

**2. High Error Rate**
- **Condition**: Error rate > threshold for 5 minutes
- **Action**: Page on-call engineer
- **Severity**: Critical

**3. Authentication Failures**
- **Condition**: Auth failures > threshold for 5 minutes
- **Action**: Page security team
- **Severity**: Critical (potential attack)

### Warning Alerts (Slack + Email)

**4. High Latency**
- **Condition**: P95 latency > 2000ms for 5 minutes
- **Action**: Notify team
- **Severity**: Warning

**5. High Instance Count**
- **Condition**: Instances > 50 for 5 minutes
- **Action**: Notify team
- **Severity**: Warning

**6. High Memory Usage**
- **Condition**: Memory > 85% for 5 minutes
- **Action**: Notify team
- **Severity**: Warning

### Alert Notification Matrix

| Alert | Email | Slack | PagerDuty | Auto-Close |
|-------|-------|-------|-----------|------------|
| Service Down | ✅ | ✅ | ✅ (prod) | 1 hour |
| High Error Rate | ✅ | ✅ | ✅ (prod) | 24 hours |
| Auth Failures | ✅ | ❌ | ✅ (prod) | 12 hours |
| High Latency | ✅ | ✅ | ❌ | 24 hours |
| Instance Count | ✅ | ❌ | ❌ | 24 hours |
| Memory Usage | ✅ | ❌ | ❌ | 24 hours |

---

## Distributed Tracing

### Cloud Trace Integration

**Automatic Instrumentation**:
- HTTP requests (incoming/outgoing)
- BigQuery operations
- Authentication flows
- Database connections

**Custom Spans**:
```typescript
import { traced, addSpanEvent, setSpanAttributes } from './telemetry';

// Traced function
const processQuery = traced('process_bigquery_query', async (query: string) => {
  addSpanEvent('query_started', { query_length: query.length });

  const result = await bigquery.query(query);

  setSpanAttributes({
    'bigquery.rows': result.length,
    'bigquery.bytes': result.totalBytesProcessed,
  });

  return result;
});
```

### Trace Attributes

**Standard Attributes**:
- `service.name` - Service identifier
- `service.version` - Version number
- `http.method` - HTTP method
- `http.status_code` - Response status
- `http.route` - Request route

**Custom Attributes**:
- `mcp.tool` - MCP tool name
- `bigquery.dataset` - Dataset ID
- `bigquery.table` - Table ID
- `bigquery.bytes` - Bytes processed
- `auth.method` - Authentication method
- `auth.domain` - Workspace domain

---

## Dashboard

### Quick Access

**Production Dashboard URL**:
```
https://console.cloud.google.com/monitoring/dashboards/custom/${dashboard_id}?project=${project_id}
```

**Get Dashboard URL from Terraform**:
```bash
terraform output -module=monitoring dashboard_url
```

### Dashboard Widgets

**Row 1: Traffic & Errors**
- Request Rate (requests/sec by status)
- Error Rate (errors/min)

**Row 2: Performance**
- Request Latency (P50, P95, P99)
- BigQuery Query Latency

**Row 3: Resources**
- Instance Count
- Memory Utilization (%)
- CPU Utilization (%)

**Row 4: Security & Cost**
- Authentication Failures
- BigQuery Bytes Processed

**Row 5: Logs**
- Recent Errors (last 100)

**Row 6: SLO Tracking**
- Availability SLO (30 days)
- Latency SLO (30 days)

---

## SLO/SLA Configuration

### Availability SLO

**Target**: 99.9% (three nines)
**Measurement**: Request-based
- **Good requests**: HTTP 2xx responses
- **Total requests**: All requests
- **Period**: Rolling 30 days

**Error Budget**:
- Monthly: 43.2 minutes downtime
- Weekly: 10.1 minutes downtime
- Daily: 1.4 minutes downtime

### Latency SLO

**Target**: 95% of requests < 2000ms
**Measurement**: Distribution-based
- **Good requests**: Latency < 2000ms
- **Total requests**: All requests
- **Period**: Rolling 30 days

**Error Budget**:
- 5% of requests can exceed 2000ms
- ~2.16M slow requests per month (at 1M req/day)

### SLO Dashboard

View SLO compliance:
```bash
# List SLOs
gcloud monitoring slos list --service=mcp-bigquery-${env}

# Get SLO details
gcloud monitoring slos describe availability \
  --service=mcp-bigquery-${env}

# View SLO health
gcloud monitoring slos describe latency \
  --service=mcp-bigquery-${env}
```

---

## Uptime Checks

### Health Check Configuration

**Endpoint**: `https://${cloud_run_url}/health`
**Method**: GET
**Frequency**: Every 60 seconds
**Timeout**: 10 seconds
**Expected**: HTTP 200 + body contains "healthy"

### Health Check Response

```json
{
  "status": "healthy",
  "timestamp": "2025-10-27T12:00:00Z",
  "version": "1.0.0",
  "checks": {
    "bigquery": "ok",
    "workload_identity": "ok",
    "memory": "ok"
  }
}
```

### Implement Health Endpoint

```typescript
// src/index.ts
app.get('/health', async (req, res) => {
  try {
    // Check BigQuery connection
    const bqHealthy = await bigquery.testConnection();

    // Check memory usage
    const memUsage = process.memoryUsage();
    const memHealthy = memUsage.heapUsed < memUsage.heapTotal * 0.9;

    const healthy = bqHealthy && memHealthy;

    res.status(healthy ? 200 : 503).json({
      status: healthy ? 'healthy' : 'unhealthy',
      timestamp: new Date().toISOString(),
      version: '1.0.0',
      checks: {
        bigquery: bqHealthy ? 'ok' : 'failed',
        workload_identity: 'ok',
        memory: memHealthy ? 'ok' : 'high',
      },
    });
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      error: error.message,
    });
  }
});
```

---

## Log Queries

### Useful Log Queries

**All Errors**:
```
resource.type="cloud_run_revision"
resource.labels.service_name="mcp-bigquery-server"
severity>=ERROR
```

**Authentication Failures**:
```
resource.type="cloud_run_revision"
resource.labels.service_name="mcp-bigquery-server"
jsonPayload.message=~"authentication failed|token verification failed"
```

**Slow Queries**:
```
resource.type="cloud_run_revision"
resource.labels.service_name="mcp-bigquery-server"
jsonPayload.message="Query completed"
jsonPayload.duration>2000
```

**High BigQuery Costs**:
```
resource.type="cloud_run_revision"
resource.labels.service_name="mcp-bigquery-server"
jsonPayload.bytesProcessed>1000000000
```

### Log Export

Export logs to BigQuery for analysis:

```bash
# Create log sink
gcloud logging sinks create mcp-bigquery-logs-sink \
  bigquery.googleapis.com/projects/${PROJECT_ID}/datasets/mcp_logs \
  --log-filter='resource.type="cloud_run_revision" resource.labels.service_name="mcp-bigquery-server"'
```

---

## Alert Response Procedures

### High Error Rate Alert

**1. Immediate Actions**:
```bash
# Check recent errors
gcloud logging read \
  'resource.type="cloud_run_revision" severity>=ERROR' \
  --limit=50 \
  --format=json

# Check service status
gcloud run services describe mcp-bigquery-server \
  --region=us-central1
```

**2. Investigation**:
- Review Cloud Logging for error patterns
- Check Workload Identity Federation configuration
- Verify BigQuery API quotas
- Review recent deployments

**3. Resolution**:
- Rollback if deployment-related
- Scale up if capacity issue
- Fix configuration if IAM-related

### High Latency Alert

**1. Immediate Actions**:
```bash
# Check current latency
gcloud monitoring time-series list \
  --filter='metric.type="run.googleapis.com/request_latencies"'

# Check BigQuery job performance
bq ls -j --max_results=10
```

**2. Investigation**:
- Review BigQuery query patterns
- Check for large dataset scans
- Verify network connectivity
- Check BigQuery slot usage

**3. Resolution**:
- Optimize slow queries
- Add query caching
- Increase Cloud Run resources
- Use BigQuery table partitioning

### Authentication Failure Alert

**1. Immediate Actions** (SECURITY INCIDENT):
```bash
# Check failed auth attempts
gcloud logging read \
  'jsonPayload.message=~"authentication failed"' \
  --limit=100

# Check source IPs
gcloud logging read \
  'jsonPayload.message=~"authentication failed"' \
  --format='value(jsonPayload.sourceIP)' \
  | sort | uniq -c | sort -rn
```

**2. Investigation**:
- Identify attack patterns
- Check if legitimate users affected
- Review Workspace OIDC configuration
- Verify service account permissions

**3. Resolution**:
- Block malicious IPs (if attack)
- Fix WIF configuration (if misconfigured)
- Update allowed groups (if policy change)
- Notify security team

---

## Cost Optimization

### Monitoring Costs

**Cost Components**:
- Cloud Monitoring API calls
- Cloud Trace spans
- Log ingestion (>50 GB/month charged)
- Metric data retention (>24 hours charged)

**Optimization Strategies**:

**1. Log Sampling**:
```typescript
// Only log 10% of successful requests
if (success && Math.random() > 0.1) return;
logger.info('Request completed', { ... });
```

**2. Metric Aggregation**:
```hcl
# Use longer alignment periods
aggregation {
  alignment_period = "300s"  # 5 minutes instead of 1 minute
}
```

**3. Trace Sampling**:
```typescript
// Sample 10% of traces
const tracerProvider = new NodeTracerProvider({
  sampler: new TraceIdRatioBasedSampler(0.1),
});
```

**4. Log Exclusion**:
```bash
# Exclude health check logs
gcloud logging exclusions create health-check-exclusion \
  --log-filter='resource.type="cloud_run_revision" httpRequest.requestUrl=~"/health"'
```

### Cost Monitoring

**Monthly Cost Estimate**:
- Metrics: ~$2-5/month (< 150 metrics)
- Traces: ~$5-10/month (100k spans)
- Logs: ~$10-20/month (10 GB)
- **Total**: ~$20-40/month

**Budget Alert**:
```bash
gcloud billing budgets create \
  --billing-account=${BILLING_ACCOUNT} \
  --display-name="Monitoring Budget" \
  --budget-amount=100 \
  --threshold-rule=percent=80 \
  --threshold-rule=percent=100
```

---

## Troubleshooting

### No Metrics Showing

**Check**:
1. OpenTelemetry initialized correctly
2. Service account has `monitoring.metricWriter` role
3. Metric exporter configured with correct project ID
4. Cloud Monitoring API enabled

**Verify**:
```bash
# Check metric descriptors
gcloud monitoring metric-descriptors list \
  --filter='metric.type=starts_with("custom.googleapis.com/mcp")'

# Check recent writes
gcloud logging read \
  'protoPayload.methodName="google.monitoring.v3.MetricService.CreateTimeSeries"'
```

### Traces Not Appearing

**Check**:
1. Cloud Trace API enabled
2. Service account has `cloudtrace.agent` role
3. Trace exporter configured
4. Sampling rate not too low

**Verify**:
```bash
# List recent traces
gcloud trace traces list \
  --limit=10

# Check trace spans
gcloud logging read \
  'protoPayload.serviceName="cloudtrace.googleapis.com"'
```

### Alerts Not Firing

**Check**:
1. Alert policy enabled
2. Notification channels configured
3. Metric data available
4. Threshold values correct

**Test Alert**:
```bash
# Describe alert policy
gcloud monitoring alert-policies describe ${POLICY_ID}

# Check notification channel
gcloud monitoring channels describe ${CHANNEL_ID}

# Test notification
gcloud monitoring channels verify ${CHANNEL_ID}
```

---

## Best Practices

### Logging

✅ **DO**:
- Use structured JSON logging
- Include correlation IDs
- Log at appropriate levels (DEBUG, INFO, WARN, ERROR)
- Include context (user, operation, resources)
- Log errors with stack traces

❌ **DON'T**:
- Log sensitive data (tokens, passwords)
- Log high-volume success messages
- Use console.log (use Winston)
- Log entire request/response bodies
- **NEVER log to stdout** (corrupts MCP JSON-RPC protocol)

### MCP-Specific Logging

**Critical Configuration**:
```typescript
// ✅ CORRECT: All logs to stderr
new winston.transports.Console({
  stderrLevels: ['error', 'warn', 'info', 'debug', 'verbose', 'silly'],
})

// ❌ WRONG: Default winston (writes some to stdout)
new winston.transports.Console()  // Don't use default!
```

**Why This Matters**:
- MCP uses **stdout for JSON-RPC messages** only
- Any logs to stdout will **corrupt the protocol**
- Winston must be configured to write **all levels to stderr**
- This is enforced in `src/utils/logger.ts`

**Monitoring stderr logs in production**:
```bash
# Cloud Run automatically captures stderr
gcloud logging read \
  'resource.type="cloud_run_revision" AND textPayload!=""' \
  --limit=100

# Filter by log level
gcloud logging read \
  'resource.type="cloud_run_revision" AND jsonPayload.level="error"' \
  --limit=50
```

### Metrics

✅ **DO**:
- Use consistent naming (mcp.* prefix)
- Add meaningful labels
- Use appropriate metric types (counter, histogram, gauge)
- Set histogram buckets appropriately
- Document custom metrics

❌ **DON'T**:
- Create metrics with high cardinality labels
- Use overly specific metric names
- Create duplicate metrics
- Collect metrics for every request (sample)

### Tracing

✅ **DO**:
- Create spans for significant operations
- Add meaningful span attributes
- Use semantic conventions
- Sample appropriately (10% typically sufficient)
- Link related spans

❌ **DON'T**:
- Create too many spans (overhead)
- Include sensitive data in attributes
- Trace everything (sampling!)
- Forget to end spans

### Alerts

✅ **DO**:
- Set appropriate thresholds based on SLOs
- Include runbook links in alert documentation
- Use multiple notification channels
- Test alerts regularly
- Review and update thresholds

❌ **DON'T**:
- Alert on everything (alert fatigue)
- Set thresholds too tight (false alarms)
- Forget to document response procedures
- Ignore auto-close settings

---

## Next Steps

1. **Deploy Monitoring Module**:
   ```bash
   terraform apply -target=module.monitoring
   ```

2. **Configure Notifications**:
   - Set up Slack webhook
   - Configure PagerDuty (production)
   - Test notification channels

3. **Customize Dashboards**:
   - Add business-specific metrics
   - Create team-specific views
   - Set up TV dashboards

4. **Set Up Alerts**:
   - Adjust thresholds per environment
   - Test alert firing
   - Document response procedures

5. **Enable Tracing**:
   - Deploy with OpenTelemetry
   - Verify traces in Cloud Trace
   - Adjust sampling rates

---

## Resources

### GCP Documentation
- [Cloud Monitoring](https://cloud.google.com/monitoring/docs)
- [Cloud Trace](https://cloud.google.com/trace/docs)
- [Cloud Logging](https://cloud.google.com/logging/docs)
- [Alerting](https://cloud.google.com/monitoring/alerts)
- [SLO Monitoring](https://cloud.google.com/stackdriver/docs/solutions/slo-monitoring)

### OpenTelemetry
- [OpenTelemetry Documentation](https://opentelemetry.io/docs/)
- [Node.js Instrumentation](https://opentelemetry.io/docs/instrumentation/js/)
- [GCP Exporters](https://github.com/GoogleCloudPlatform/opentelemetry-operations-js)

### Tools
- [Terraform Provider](https://registry.terraform.io/providers/hashicorp/google/latest/docs)
- [gcloud CLI](https://cloud.google.com/sdk/gcloud/reference)
- [Cloud Console](https://console.cloud.google.com/)

---

**Guide Version**: 1.0.0
**Last Updated**: 2025-10-27
**Status**: ✅ Production Ready
