# MCP Protocol Compliance & Gap Implementation

Reference: _"Model Context Protocol for LLMs"_ by Naveen Krishnan (Packt, Feb 2026)

This document tracks the MCP protocol compliance of this BigQuery MCP server against the book's recommendations across
20 chapters.

---

## Compliance Matrix

### Part 2: Architecture & Core Implementation (Ch 4-7)

| Recommendation                                 | Chapter | Status | Implementation                                                                         |
| ---------------------------------------------- | ------- | ------ | -------------------------------------------------------------------------------------- |
| Tool providers with composability              | Ch 4, 6 | DONE   | `src/mcp/tools/definitions.ts` — 4 tools with Zod schemas, annotations, output schemas |
| Resource providers (browse data)               | Ch 4, 6 | DONE   | `src/index.ts` — `list_resources`/`read_resource` with `bigquery://` URIs              |
| Prompt providers (AI guidance)                 | Ch 4, 6 | DONE   | `src/mcp/handlers/prompt-handlers.ts` — 5 BigQuery-specific prompt templates           |
| Security interfaces                            | Ch 4    | DONE   | `src/security/middleware.ts` — auth, rate limit, injection detection, audit            |
| Discovery interfaces                           | Ch 4    | DONE   | Tool and resource listing via standard MCP primitives                                  |
| Client features (sampling, roots, elicitation) | Ch 4    | N/A    | Client-side features, not server responsibility                                        |
| Streamable HTTP transport                      | Ch 5, 9 | DONE   | `src/mcp/transports/http-transport.ts` — POST/GET with SSE                             |
| JSON-RPC message format                        | Ch 5    | DONE   | MCP SDK handles JSON-RPC 2.0 framing                                                   |
| Session management                             | Ch 7    | DONE   | `src/mcp/handlers/session-manager.ts` — multi-turn session tracking                    |
| Capability negotiation                         | Ch 5    | DONE   | MCP SDK handles during connection init                                                 |

### Part 3: Security & Performance (Ch 8-9)

| Recommendation                     | Chapter | Status | Implementation                                                         |
| ---------------------------------- | ------- | ------ | ---------------------------------------------------------------------- |
| OIDC authentication                | Ch 8    | DONE   | `src/auth/oidc-authenticator.ts` — JWT verification with JWKS          |
| Multi-party authentication         | Ch 8    | DONE   | WIF + OIDC + tenant subject patterns                                   |
| Capability-based authorization     | Ch 8    | DONE   | Per-tenant tool allowlists in `tenant-config.ts`                       |
| Context-aware authorization        | Ch 8    | DONE   | `src/tenancy/dataset-policy.ts` — SQL-level dataset enforcement        |
| Rate limiting                      | Ch 8    | DONE   | `src/security/middleware.ts` — per-user/tool with configurable windows |
| Prompt injection detection         | Ch 8    | DONE   | Pattern-based detection + sanitization                                 |
| Data minimization (column masking) | Ch 8    | DONE   | `src/security/column-masking.ts` — per-tenant column rules             |
| Data lineage & provenance          | Ch 8    | DONE   | All tool responses include `provenance` metadata                       |
| Comprehensive audit logging        | Ch 8    | DONE   | `src/auth/audit-logger.ts` — 20+ event types, Cloud Logging            |
| Behavioral anomaly detection       | Ch 8    | DONE   | `src/security/anomaly-detector.ts` — per-user baselines                |
| Privacy-preserving audit           | Ch 8    | DONE   | Sensitive data redaction in logs                                       |
| TLS / encryption in transit        | Ch 8    | DONE   | Cloud Run enforces HTTPS; HTTP transport supports TLS                  |
| Connection pooling & reuse         | Ch 9    | DONE   | `src/bigquery/connection-pool.ts` — health checks, idle cleanup        |
| Intelligent caching                | Ch 9    | DONE   | `src/bigquery/query-cache.ts` — LRU + TTL + size-based eviction        |
| Streaming / progressive results    | Ch 9    | DONE   | `src/mcp/handlers/progress-notifier.ts` — progress tokens              |
| Request batching                   | Ch 9    | DONE   | `src/mcp/middleware/batch-handler.ts` — parallel JSON-RPC batch        |
| Response compression               | Ch 9    | DONE   | `src/mcp/middleware/compression.ts` — gzip for large payloads          |
| Distributed tracing                | Ch 9    | DONE   | `src/telemetry/tracing.ts` — OpenTelemetry + Cloud Trace               |
| Adaptive resource allocation       | Ch 9    | DONE   | Connection pool auto-scales min→max connections                        |
| Graceful degradation               | Ch 9    | DONE   | `src/bigquery/graceful-degradation.ts` — circuit breaker + stale cache |

### Part 4: Multi-Agent & RAG (Ch 10-13)

| Recommendation                   | Chapter | Status | Implementation                                                      |
| -------------------------------- | ------- | ------ | ------------------------------------------------------------------- |
| Standardized communication       | Ch 10   | DONE   | Full MCP protocol compliance                                        |
| Dynamic capability discovery     | Ch 10   | DONE   | `list_tools`, `list_resources`, `list_prompts`                      |
| Resource sharing                 | Ch 10   | DONE   | BigQuery resources accessible via standard MCP                      |
| Metadata & provenance tracking   | Ch 11   | DONE   | All responses include provenance with source, freshness, consoleUrl |
| Context-aware information access | Ch 11   | DONE   | Tenant-scoped data access with policy enforcement                   |

### Part 6: Evaluation & Optimization (Ch 17-19)

| Recommendation                     | Chapter  | Status | Implementation                                          |
| ---------------------------------- | -------- | ------ | ------------------------------------------------------- |
| Intelligence effectiveness metrics | Ch 9, 18 | DONE   | `src/monitoring/effectiveness-metrics.ts`               |
| Performance benchmarking           | Ch 18    | DONE   | Health monitor tracks latency, error rates, cache rates |
| Continuous monitoring              | Ch 19    | DONE   | `src/monitoring/health-monitor.ts` — auto health checks |
| Performance profiling              | Ch 9     | DONE   | OpenTelemetry tracing + MCP metrics                     |

---

## Architecture Overview

```
                    ┌─────────────────────────────────────────────┐
                    │              MCP Clients (AI Agents)         │
                    └──────────────┬──────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────────────┐
                    │         Transport Layer                      │
                    │   ┌─────────┐  ┌──────────────────────┐    │
                    │   │  stdio  │  │  Streamable HTTP/SSE  │    │
                    │   └─────────┘  └──────────────────────┘    │
                    │   Request Batching │ Compression            │
                    └──────────────┬──────────────────────────────┘
                                   │
                    ┌──────────────▼──────────────────────────────┐
                    │         Security Layer                       │
                    │   OIDC Auth → Tenant Resolution →           │
                    │   Rate Limit → Injection Detection →        │
                    │   SQL Authorization → Column Masking         │
                    │   Anomaly Detection → Audit Logging          │
                    └──────────────┬──────────────────────────────┘
                                   │
          ┌────────────────────────┼───────────────────────┐
          │                        │                       │
  ┌───────▼───────┐    ┌──────────▼──────────┐   ┌───────▼───────┐
  │    Tools      │    │    Resources        │   │    Prompts    │
  │ query_bigquery│    │ bigquery://datasets  │   │ analyze_table │
  │ list_datasets │    │ bigquery://datasets/ │   │ write_query   │
  │ list_tables   │    │   {id}/tables/{id}  │   │ explore_dataset│
  │ get_table_    │    │                     │   │ optimize_query│
  │   schema      │    │                     │   │ data_quality  │
  └───────┬───────┘    └──────────┬──────────┘   └───────────────┘
          │                        │
  ┌───────▼────────────────────────▼──────────────────────┐
  │              BigQuery Layer                            │
  │   Connection Pool → Query Cache → Graceful Degradation│
  │   Progress Notifications → Session Tracking           │
  └───────────────────────┬───────────────────────────────┘
                          │
  ┌───────────────────────▼───────────────────────────────┐
  │              Observability Layer                       │
  │   OpenTelemetry Tracing → Prometheus Metrics →        │
  │   Health Monitor → Effectiveness Metrics →            │
  │   Behavioral Anomaly Alerts                           │
  └───────────────────────────────────────────────────────┘
```

---

## New Features (Gap Implementations)

### 1. Prompt Providers

**File**: `src/mcp/handlers/prompt-handlers.ts`

Five built-in prompts guide AI clients on how to interact with BigQuery:

| Prompt               | Purpose                             | Required Args                       |
| -------------------- | ----------------------------------- | ----------------------------------- |
| `analyze_table`      | Schema analysis + query suggestions | `datasetId`, `tableId`              |
| `explore_dataset`    | Dataset exploration workflow        | `datasetId`                         |
| `write_query`        | Natural language → SQL translation  | `description`, optional `datasetId` |
| `optimize_query`     | Query cost/performance optimization | `query`                             |
| `data_quality_check` | Data quality analysis               | `datasetId`, `tableId`              |

**Usage**: Clients call `prompts/list` to discover available prompts, then `prompts/get` with arguments to receive
structured messages.

### 2. Streamable HTTP Transport

**File**: `src/mcp/transports/http-transport.ts`

Production transport for Cloud Run deployment:

- **POST /mcp** — JSON-RPC requests (single or batched array)
- **GET /mcp** — SSE stream for server notifications (disabled in strict mode)
- **GET /health** — Health check endpoint
- **GET /.well-known/oauth-authorization-server** — RFC 8414 metadata (when `OAUTH_*` env vars set)
- **GET /.well-known/oauth-protected-resource** — RFC 9728 metadata (when `OAUTH_*` env vars set)
- Built-in gzip compression for responses > 1KB
- Request ID injection for tracing
- CORS support for cross-origin clients
- Graceful shutdown with drain period

**Strict Streamable HTTP mode** (`MCP_TRANSPORT_STRICT=streamable`) — required for Gemini Enterprise custom MCP
connectors, which explicitly do not support SSE: `GET /mcp` returns `405 Method Not Allowed` with `Allow: POST` instead
of opening an SSE stream.

**`sendUnauthorized()` helper** — emits RFC 6750 / MCP 2025-06-18 compliant 401 responses with a
`WWW-Authenticate: Bearer ... resource_metadata="..."` header pointing at the protected-resource metadata document.

### 2b. Native Resource Templates (RFC 6570)

**File**: `src/mcp/resources/templates.ts`

Parameterized resource URIs registered via the `ListResourceTemplatesRequestSchema` handler — clients (e.g. Gemini
Enterprise) discover and parameterize without the server enumerating every dataset/table.

| Template                                                    | Purpose                                       |
| ----------------------------------------------------------- | --------------------------------------------- |
| `bigquery://datasets/{datasetId}`                           | Dataset detail with table listing             |
| `bigquery://datasets/{datasetId}/tables/{tableId}`          | Full table metadata                           |
| `bigquery://datasets/{datasetId}/tables/{tableId}/schema`   | Schema-only view (cheap)                      |
| `bigquery://datasets/{datasetId}/tables/{tableId}/sample`   | Up to 10 preview rows                         |
| `bigquery://jobs/{jobId}`                                   | Query job result handle                       |
| `bigquery://datasets/{datasetId}/information_schema/{view}` | INFORMATION_SCHEMA browse (whitelisted views) |

Identifier validation prevents SQL injection via path parameters; INFORMATION_SCHEMA view names are checked against an
allow-list (`TABLES`, `COLUMNS`, `VIEWS`, …).

### 2c. Cost Elicitation Gate

**File**: `src/mcp/tools/annotations.ts`, integrated into `QueryBigQueryHandler`

Before executing a non-dry-run query, the handler runs a dry-run estimate. If `totalBytesProcessed` exceeds
`MCP_COST_ELICITATION_BYTES` (default 10 GiB) and the caller has not passed `confirmCost: true`, the handler returns a
structured `requires_confirmation` response with `_meta.elicitation` metadata. MCP clients surface this as a user
confirmation prompt.

Tunables:

- `MCP_COST_ELICITATION_ENABLED` (default `true`)
- `MCP_COST_ELICITATION_BYTES` (default `10737418240` — 10 GiB)
- `MCP_BQ_USD_PER_TIB` (default `6.25` — BigQuery on-demand US pricing)

**Env vars**:

- `MCP_TRANSPORT=http` — enables HTTP transport (default: `stdio`)
- `MCP_HTTP_PORT=8080` — listen port
- `MCP_HTTP_HOST=0.0.0.0` — bind address

### 3. Progress Notifications

**File**: `src/mcp/handlers/progress-notifier.ts`

Long-running BigQuery operations emit progress updates:

```
queued → running → processing (bytes) → complete/error
```

Clients include a `_meta.progressToken` in their request to opt in. The server sends `notifications/progress` messages
during execution.

### 4. Session Management

**File**: `src/mcp/handlers/session-manager.ts`

Multi-turn session tracking:

- Auto-created on first tool call
- Tracks query history, bytes processed, tool call count
- Session context shared across tool calls
- Auto-cleanup after 1h idle
- Max 1000 concurrent sessions

### 5. Request Batching

**File**: `src/mcp/middleware/batch-handler.ts`

JSON-RPC batch support per the MCP spec:

- Clients POST an array of JSON-RPC requests
- Server processes them in parallel via `Promise.allSettled`
- Returns an array of responses

### 6. Column-Level Masking

**File**: `src/security/column-masking.ts`

Per-tenant column masking configured in `src/config/tenants.yaml`:

```yaml
columnMasking:
  enabled: true
  rules:
    - datasetPattern: '*'
      tablePattern: '*'
      columnPattern: 'email*'
      maskType: partial # j***@email.com
    - datasetPattern: '*'
      tablePattern: '*'
      columnPattern: 'ssn*'
      maskType: redact # [REDACTED]
    - datasetPattern: '*'
      tablePattern: '*'
      columnPattern: 'credit_card*'
      maskType: hash # SHA-256 hash (preserves referential integrity)
```

Mask types: `redact`, `hash`, `partial`, `nullify`

### 7. Response Compression

**File**: `src/mcp/middleware/compression.ts`

Gzip compression for tool results exceeding 1KB. Enabled by default in HTTP transport. Reduces bandwidth for large query
result sets.

### 8. Behavioral Anomaly Detection

**File**: `src/security/anomaly-detector.ts`

Per-user behavioral baselines with automatic alerting:

| Alert Type           | Trigger                             |
| -------------------- | ----------------------------------- |
| `volume_spike`       | >3x average queries/minute          |
| `new_dataset_access` | First-time access to a dataset      |
| `cost_spike`         | Query processes >10x average bytes  |
| `write_attempt`      | First DML/DDL query from user       |
| `unusual_timing`     | Queries outside user's normal hours |

Alerts are logged to audit trail and emitted as events.

### 9. Intelligence Effectiveness Metrics

**File**: `src/monitoring/effectiveness-metrics.ts`

Tracks how well AI clients use the server:

- **First-try success rate**: % of tool calls succeeding without retry
- **Retry rate**: % of tool calls that are retries
- **Average calls per session**: measures exploration cost
- **Per-tool success rates and latency**: P50/P95 breakdowns
- **Peak hours distribution**: calls per hour-of-day

### 10. Graceful Degradation

**File**: `src/bigquery/graceful-degradation.ts`

Circuit breaker pattern for BigQuery failures:

```
closed (healthy) → open (after N failures) → half-open (test one request)
```

When BigQuery is unavailable:

1. Serve stale cache (up to 30min old) with degradation warning
2. If no cache, return structured error with retry guidance
3. Auto-recover when BigQuery comes back

---

## Configuration Reference

### Environment Variables

| Variable                        | Default   | Description                         |
| ------------------------------- | --------- | ----------------------------------- |
| `MCP_TRANSPORT`                 | `stdio`   | Transport: `stdio` or `http`        |
| `MCP_HTTP_PORT`                 | `8080`    | HTTP transport listen port          |
| `MCP_HTTP_HOST`                 | `0.0.0.0` | HTTP transport bind address         |
| `MCP_ENABLE_PROMPTS`            | `true`    | Enable prompt providers             |
| `MCP_ENABLE_SESSIONS`           | `true`    | Enable session management           |
| `MCP_ENABLE_COMPRESSION`        | `true`    | Enable response compression         |
| `MCP_ENABLE_ANOMALY_DETECTION`  | `true`    | Enable behavioral anomaly detection |
| `MCP_SESSION_TTL_MS`            | `3600000` | Session timeout (1h)                |
| `MCP_CIRCUIT_BREAKER_THRESHOLD` | `5`       | Failures before circuit opens       |
| `MCP_STALE_CACHE_MAX_AGE_MS`    | `1800000` | Max stale cache age (30min)         |

### Tenant Column Masking

Add to any tenant in `src/config/tenants.yaml`:

```yaml
columnMasking:
  enabled: true
  rules:
    - datasetPattern: '*' # glob pattern
      tablePattern: 'users*' # glob pattern
      columnPattern: 'email' # column name pattern
      maskType: partial # redact | hash | partial | nullify
```

---

## Runbook

### Deploying with HTTP Transport (Cloud Run)

1. Build the Docker image:

   ```bash
   docker build -t bigquery-mcp-server .
   ```

2. The Dockerfile sets `MCP_TRANSPORT=http` and exposes port 8080.

3. Deploy to Cloud Run:

   ```bash
   gcloud run deploy bigquery-mcp-server \
     --image gcr.io/PROJECT_ID/bigquery-mcp-server:latest \
     --region europe-west1 \
     --set-env-vars MCP_TRANSPORT=http,MCP_HTTP_PORT=8080
   ```

4. Verify health:

   ```bash
   curl https://SERVICE_URL/health
   ```

5. Test MCP endpoint:

   ```bash
   curl -X POST https://SERVICE_URL/mcp \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
   ```

### Monitoring Anomaly Alerts

Anomaly alerts are emitted to:

- Structured logs (Cloud Logging) with `anomaly: true` label
- OpenTelemetry traces with `security.anomaly.*` attributes
- Audit trail in `SecurityAuditLogger`

Query Cloud Logging:

```
resource.type="cloud_run_revision"
jsonPayload.anomaly=true
```

### Circuit Breaker Recovery

If BigQuery is down and circuit is open:

1. Check `/health` — will show `degraded` status
2. Check logs for `circuit_breaker_opened` events
3. Circuit auto-resets after 60s (configurable via `MCP_CIRCUIT_BREAKER_RESET_MS`)
4. Manual reset: call the server's `reset()` method or restart

### Session Cleanup

Sessions auto-expire after 1h idle. If memory pressure is high:

- Reduce `MCP_SESSION_TTL_MS`
- Sessions are capped at 1000 concurrent
- Monitor via effectiveness metrics `averageCallsPerSession`
