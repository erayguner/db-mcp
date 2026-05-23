# Scalability Patterns

## Overview

The BigQuery MCP Server runs on **Google Cloud Run** (serverless), which handles scaling automatically
at the platform level. There is no Kubernetes cluster or HorizontalPodAutoscaler. The server is
stateless by design: each Cloud Run instance is independent, shares no local state with peers, and
can be started or stopped on demand.

## Cloud Run Autoscaling

Cloud Run scales by adding or removing container instances in response to incoming request traffic.
The Terraform configuration exposes two instance controls:

| Parameter | Terraform variable | Default |
|---|---|---|
| Minimum instances | `mcp_server_min_instances` | `0` (scale to zero when idle) |
| Maximum instances | `mcp_server_max_instances` | `10` |
| Per-instance concurrency | `container_concurrency` | `80` (production) / `100` (other) |

When idle, the service scales to zero and incurs no compute cost. On the first request after a cold
start, Cloud Run starts a new instance within a few seconds. Setting `min_instances > 0` keeps at
least one warm instance available to eliminate cold-start latency for latency-sensitive deployments.

Cloud Run scales up when active instances approach their concurrency limit. New instances are
typically ready within 5–30 seconds. Scale-down happens gradually after sustained low traffic,
subject to a built-in stabilization window.

**CPU allocation**: Production runs with CPU always allocated
(`run.googleapis.com/cpu-throttling = false`) so the Node.js process is not throttled between
requests. Non-production environments use the default CPU-throttling mode to reduce cost.

**Execution environment**: All revisions use the second-generation execution environment
(`run.googleapis.com/execution-environment = gen2`), which provides better performance and
full Linux kernel compatibility.

### Scaling Diagram

```
Incoming Requests
      │
      ▼
┌─────────────────────────────────────────────────┐
│           Cloud Run (serverless)                 │
│                                                  │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐       │
│  │ Instance │  │ Instance │  │ Instance │  ...  │
│  │    1     │  │    2     │  │    N     │       │
│  │ ≤80 reqs │  │ ≤80 reqs │  │ ≤80 reqs │       │
│  └──────────┘  └──────────┘  └──────────┘       │
│                                                  │
│  Auto-scaled by platform (0 – 10 instances)      │
└─────────────────────────────────────────────────┘
```

## In-Process Caching (No Redis)

There is no Redis cluster or any distributed external cache. Each Cloud Run instance runs an
in-process LRU cache implemented in `src/bigquery/query-cache.ts`. Because instances are
independent, cache state is not shared across instances; each instance builds its own warm cache
from BigQuery responses.

### Cache Behaviour

- **Implementation**: in-process LRU, bounded by a maximum entry count and configurable TTLs
- **Scope**: per-instance only — cache entries are lost when an instance is recycled
- **Cached resources**: dataset lists, table lists, table schemas, and optionally recent
  query results (configurable, disabled by default)

### Cache Key Patterns

```typescript
const cacheKeys = {
  datasets:    (projectId: string) => `datasets:${projectId}`,
  tables:      (datasetId: string) => `tables:${datasetId}`,
  schema:      (datasetId: string, tableId: string) => `schema:${datasetId}.${tableId}`,
  queryResult: (queryHash: string) => `query:${queryHash}`
};

// TTLs by resource type
const cacheTTLs = {
  datasets:    900,   // 15 minutes
  tables:      900,   // 15 minutes
  schema:      1800,  // 30 minutes
  queryResult: 300    // 5 minutes (when enabled)
};
```

### Cache Hit Rate Expectation

Schema and metadata operations (dataset/table/schema lookups) benefit most from caching; a
60–80 % hit rate is typical for workloads that repeatedly inspect the same tables. Query-result
caching is off by default because BigQuery results can be large and stale results can be
misleading.

> **Potential future state**: A shared Redis or Memorystore layer could improve cache efficiency
> across instances for high-instance-count deployments, but this is not currently implemented.

## Connection Management

BigQuery client lifecycle is managed in `src/bigquery/connection-pool.ts`. Because the BigQuery
Node.js client is HTTP-based (not a persistent TCP socket pool like a relational database driver),
"pooling" here refers to reusing initialized `BigQuery` client objects across requests within the
same instance rather than maintaining a fixed pool of open network connections.

Each instance initialises a small number of `BigQuery` client objects at startup and reuses them
across concurrent requests, avoiding the overhead of re-initialising the Google auth library on
every call. This is an in-process concern only; no pooling infrastructure exists outside the
container.

## BigQuery Elastic Compute

BigQuery itself provides elastic compute capacity. Interactive queries are processed using shared
or reserved slot pools managed by Google. The MCP server does not need to provision or manage
BigQuery workers; it submits jobs and polls for results. Per-project quotas apply:

| Quota | Limit |
|---|---|
| Interactive queries per day | 100,000 per project |
| Concurrent interactive queries | 100 per user |
| Maximum query execution time | 6 hours |

The server enforces a per-query dry-run cost gate before submitting interactive queries, surfacing
estimated byte-scan cost to the MCP client before execution.

## Rate Limiting

Rate limiting is enforced in-process by the security middleware (token bucket algorithm) and
optionally at the network layer by Cloud Armor. Key limits:

| Limit | Value |
|---|---|
| Global QPS (in-process) | 100 req/s |
| Per-client QPM | 60 req/min |
| Per-client burst capacity | 10 requests |
| Max-requests (production) | 100 (env var `SECURITY_RATE_LIMIT_MAX_REQUESTS`) |

## Vertical Sizing

Cloud Run resource allocation is controlled by Terraform variables:

| Variable | Default |
|---|---|
| `mcp_server_cpu` | `"1"` vCPU |
| `mcp_server_memory` | `"512Mi"` |

Recommended production sizing:

| Profile | CPU | Memory | Notes |
|---|---|---|---|
| Development | 0.5 vCPU | 512 MB | Default, cost-efficient |
| Staging | 1 vCPU | 1 GB | Matches prod behaviour |
| Production (standard) | 1 vCPU | 2 GB | Comfortable for most workloads |
| Production (high throughput) | 2 vCPU | 4 GB | When schema cache grows large |

## Performance Targets

| Metric | Target |
|---|---|
| P50 latency | < 500 ms |
| P95 latency | < 2000 ms |
| P99 latency | < 5000 ms |
| Throughput per instance | 100+ QPS |
| Error rate | < 0.1 % |
| Cache hit rate (schema ops) | 60–80 % |
| Scale-up time | < 30 seconds |
| Scale-down stabilisation | ~5 minutes |

## Deployment Strategies

Cloud Run supports traffic splitting natively. Rolling out a new revision safely:

```
1. Deploy new revision (receives 0 % traffic by default when using Terraform)
2. Run health checks and smoke tests against the new revision URL
3. Shift traffic gradually: 10 % → 50 % → 100 % via Terraform traffic block
4. Monitor error rates and P95 latency during the shift
5. Roll back by redirecting 100 % traffic back to the previous revision
```

Terraform manages traffic weight via the `traffic` block in the Cloud Run service resource. No
external load balancer reconfiguration is needed for a basic revision rollout.
