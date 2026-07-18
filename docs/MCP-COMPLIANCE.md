# MCP Protocol Compliance & Gap Implementation

Reference: _"Model Context Protocol for LLMs"_ by Naveen Krishnan (Packt, Feb 2026)

This document tracks the MCP protocol compliance of this BigQuery MCP server against the book's recommendations across
20 chapters.

---

## Compliance Matrix

### Part 2: Architecture & Core Implementation (Ch 4-7)

| Recommendation                                 | Chapter | Status | Implementation                                                                                                                       |
| ---------------------------------------------- | ------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------ |
| Tool providers with composability              | Ch 4, 6 | DONE   | `src/mcp/tools/definitions.ts` — 5 tools with Zod schemas, annotations, output schemas                                               |
| Resource providers (browse data)               | Ch 4, 6 | DONE   | `src/index.ts` — `list_resources`/`read_resource` with `bigquery://` URIs                                                            |
| Prompt providers (AI guidance)                 | Ch 4, 6 | DONE   | `src/mcp/handlers/prompt-handlers.ts` — 5 BigQuery-specific prompt templates                                                         |
| Security interfaces                            | Ch 4    | DONE   | `src/security/middleware.ts` — auth, rate limit, injection detection, audit                                                          |
| Discovery interfaces                           | Ch 4    | DONE   | Tool and resource listing via standard MCP primitives                                                                                |
| Client features (sampling, roots, elicitation) | Ch 4    | N/A    | Client-side features, not server responsibility                                                                                      |
| Streamable HTTP transport                      | Ch 5, 9 | DONE   | `src/mcp/transports/http-transport.ts` — official MCP SDK `StreamableHTTPServerTransport`, stateless (POST `/mcp`; GET/DELETE → 405) |
| JSON-RPC message format                        | Ch 5    | DONE   | MCP SDK handles JSON-RPC 2.0 framing                                                                                                 |
| Session management                             | Ch 7    | N/A    | Transport is stateless (`sessionIdGenerator: undefined`); per-session server state would be meaningless                              |
| Capability negotiation                         | Ch 5    | DONE   | MCP SDK handles during connection init                                                                                               |
| Logging capability                             | Ch 5    | DONE   | `src/index.ts` — `logging/setLevel` handler + `notifications/message` for security refusals                                          |

### Part 3: Security & Performance (Ch 8-9)

| Recommendation                     | Chapter | Status | Implementation                                                                                                 |
| ---------------------------------- | ------- | ------ | -------------------------------------------------------------------------------------------------------------- |
| OIDC authentication                | Ch 8    | DONE   | `src/auth/oidc-authenticator.ts` — JWT verification with JWKS                                                  |
| Multi-party authentication         | Ch 8    | DONE   | WIF + OIDC + tenant subject patterns                                                                           |
| Capability-based authorization     | Ch 8    | DONE   | Per-tenant tool allowlists in `tenant-config.ts`                                                               |
| Context-aware authorization        | Ch 8    | DONE   | `src/tenancy/dataset-policy.ts` — SQL-level dataset enforcement                                                |
| Rate limiting                      | Ch 8    | DONE   | `src/security/middleware.ts` — per-user/tool with configurable windows                                         |
| Prompt injection detection         | Ch 8    | DONE   | Pattern-based detection + sanitization                                                                         |
| Data minimization (column masking) | Ch 8    | DONE   | `src/security/column-masking.ts`, applied via `TenantContext` in the query path and the `…/sample` resource    |
| Data lineage & provenance          | Ch 8    | DONE   | All tool responses include `provenance` metadata                                                               |
| Comprehensive audit logging        | Ch 8    | DONE   | `src/auth/audit-logger.ts` — 20+ event types, Cloud Logging                                                    |
| Behavioral anomaly detection       | Ch 8    | DONE   | `src/security/anomaly-detector.ts` — per-user baselines                                                        |
| Privacy-preserving audit           | Ch 8    | DONE   | Sensitive data redaction in logs                                                                               |
| TLS / encryption in transit        | Ch 8    | DONE   | Cloud Run enforces HTTPS; HTTP transport supports TLS                                                          |
| Connection pooling & reuse         | Ch 9    | DONE   | `src/bigquery/connection-pool.ts` — health checks, idle cleanup                                                |
| Intelligent caching                | Ch 9    | DONE   | `src/bigquery/query-cache.ts` — LRU + TTL + size-based eviction                                                |
| Streaming / progressive results    | Ch 9    | DONE   | SDK Streamable HTTP supports per-request SSE; this server returns single JSON responses (`enableJsonResponse`) |
| Request batching                   | Ch 9    | N/A    | Removed from the MCP spec in revision 2025-06-18; the SDK transport rejects JSON-RPC batch arrays              |
| Response compression               | Ch 9    | DONE   | gzip negotiated at the Cloud Run / load-balancer edge (no application-level compression middleware)            |
| Distributed tracing                | Ch 9    | DONE   | `src/telemetry/tracing.ts` — OpenTelemetry + Cloud Trace                                                       |
| Adaptive resource allocation       | Ch 9    | DONE   | Connection pool auto-scales min→max connections                                                                |
| Graceful degradation               | Ch 9    | DONE   | `src/bigquery/graceful-degradation.ts` — circuit breaker + stale cache                                         |

### Part 4: Multi-Agent & RAG (Ch 10-13)

| Recommendation                   | Chapter | Status | Implementation                                                      |
| -------------------------------- | ------- | ------ | ------------------------------------------------------------------- |
| Standardized communication       | Ch 10   | DONE   | Full MCP protocol compliance                                        |
| Dynamic capability discovery     | Ch 10   | DONE   | `list_tools`, `list_resources`, `list_prompts`                      |
| Resource sharing                 | Ch 10   | DONE   | BigQuery resources accessible via standard MCP                      |
| Metadata & provenance tracking   | Ch 11   | DONE   | All responses include provenance with source, freshness, consoleUrl |
| Context-aware information access | Ch 11   | DONE   | Tenant-scoped data access with policy enforcement                   |

### Part 6: Evaluation & Optimization (Ch 17-19)

| Recommendation                     | Chapter  | Status | Implementation                                                         |
| ---------------------------------- | -------- | ------ | ---------------------------------------------------------------------- |
| Intelligence effectiveness metrics | Ch 9, 18 | DONE   | `src/monitoring/effectiveness-metrics.ts`                              |
| Performance benchmarking           | Ch 18    | DONE   | `src/bigquery/query-metrics.ts` — latency, error rates, cache rates    |
| Continuous monitoring              | Ch 19    | DONE   | `src/monitoring/readiness.ts` + `/readiness`, `/metrics` scrape target |
| Performance profiling              | Ch 9     | DONE   | OpenTelemetry tracing + MCP metrics                                    |

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
                    │   │  stdio  │  │  Streamable HTTP      │    │
                    │   └─────────┘  └──────────────────────┘    │
                    │   Stateless │ Edge gzip                     │
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
  │   Progress Notifications                              │
  └───────────────────────┬───────────────────────────────┘
                          │
  ┌───────────────────────▼───────────────────────────────┐
  │              Observability Layer                       │
  │   OpenTelemetry Tracing → Prometheus /metrics →       │
  │   Readiness Probes → Effectiveness Metrics →          │
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

Production transport for Cloud Run deployment, built on the official MCP SDK `StreamableHTTPServerTransport` in
**stateless mode** — a fresh `Server` + transport per request, so any instance can serve any request (no sticky
sessions). The SDK owns `MCP-Protocol-Version` header validation, protocol version negotiation, and rejection of
JSON-RPC batch arrays (batching was removed from the spec in 2025-06-18).

- **POST /mcp** — single JSON-RPC request → single JSON-RPC response (`enableJsonResponse`)
- **GET /mcp**, **DELETE /mcp** — `405 Method Not Allowed` with `Allow: POST` (no standalone SSE / sessions in stateless
  mode)
- **GET /health**, **/health/live** — liveness probe (dependency-free, always 200 while the process runs)
- **GET /readiness**, **/health/ready** — readiness probe (503 naming the failing dependency)
- **GET /metrics** — Prometheus text exposition format (503 when telemetry is uninitialised)
- **GET /.well-known/oauth-authorization-server** — RFC 8414 metadata (when `OAUTH_*` env vars set)
- **GET /.well-known/oauth-protected-resource** — RFC 9728 metadata (when `OAUTH_*` env vars set)
- Host allow-list (DNS-rebinding defense), CORS / Origin enforcement, security headers
- Request ID injection for tracing
- Graceful shutdown with drain period

`GET /mcp` always returning `405` in stateless mode satisfies Gemini Enterprise custom MCP connectors, which only
support Streamable HTTP and reject SSE. Response gzip is negotiated at the Cloud Run / load-balancer edge.

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
| `bigquery://jobs/{jobId}`                                   | Job metadata: state, timing, bytes, cache hit |
| `bigquery://datasets/{datasetId}/information_schema/{view}` | INFORMATION_SCHEMA browse (whitelisted views) |

Identifier validation prevents SQL injection via path parameters; INFORMATION_SCHEMA view names are checked against an
allow-list (`TABLES`, `COLUMNS`, `VIEWS`, …).

`bigquery://jobs/{jobId}` is backed by `BigQueryClient.getJob()` and returns job metadata only — `jobId`, `state`,
`startTime`, `endTime`, `durationMs`, `totalBytesProcessed`, `cacheHit`, `error`. It does **not** return result rows.
Absent BigQuery counters are omitted rather than defaulted to zero. This template was previously advertised but always
threw on read.

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

Clients opt in by including `_meta.progressToken` in the request. The `CallToolRequestSchema` handler reads that token
and, when present, creates a tracker; when absent it takes a fast path with no tracker at all.

Progress is emitted generically at the dispatch layer, so every tool behaves identically — it is not per-tool. The
emitted sequence is:

```
running → complete    (or: running → error)
```

`notifications/progress` params are `{ progressToken, progress, message }`.

> **Note:** `ProgressNotifier` also exposes `queued()` and `processing(bytes, total)`, but neither is called on the
> current dispatch path, so no byte-level progress is reported. The messages `'Queued — waiting for BigQuery slot'` and
> `'Processing — …'` are therefore never emitted.

### 4. MCP Logging

**File**: `src/index.ts` (`SetLevelRequestSchema` handler, `sendMcpLog()`)

The advertised `logging` capability is backed by a real handler. `logging/setLevel` accepts the full RFC 5424 set —
`debug`, `info`, `notice`, `warning`, `error`, `critical`, `alert`, `emergency` — defaulting to `info`. Messages below
the current threshold are dropped.

Two security refusals emit `notifications/message` at level `warning` with logger `bigquery-mcp`:

| Trigger                          | `data` payload                                                        |
| -------------------------------- | --------------------------------------------------------------------- |
| Security middleware rejection    | `{ event: 'security_validation_failed', tool, reason, requestId }`    |
| Tenant tool allow-list rejection | `{ event: 'tool_blocked_by_tenant_policy', tool, tenant, requestId }` |

> **Stateless caveat:** the log level is process-wide, not per-session. Because the HTTP transport is stateless, one
> client calling `logging/setLevel` changes the threshold for every client on that instance.

### 5. Argument Completion

**File**: `src/index.ts` (`completion/complete` handler)

Autocompletion for resource-template and prompt arguments (MCP 2025-11-25 `completions` capability):

- Completes `datasetId` / `tableId` from the live BigQuery catalog
- Prefix-filtered, capped at 100 values with `hasMore`
- Resilient: a failing catalog lookup returns an empty completion, never an error

> **Note:** JSON-RPC request batching was **removed** from the MCP spec in revision 2025-06-18. This server does not
> accept batch arrays — the SDK Streamable HTTP transport rejects them.

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

Mask types: `redact` (`[REDACTED]`), `hash` (SHA-256 hex, preserves referential integrity), `partial` (`j***@domain`,
`****1234`), `nullify` (`null`). Unset `maskType` defaults to `redact`; masking is disabled by default.

Masking is applied through `TenantContext.masking` in two places: query result rows in `QueryBigQueryHandler`, and the
`bigquery://datasets/{d}/tables/{t}/sample` resource. Columns actually altered are reported in
`provenance.maskedColumns` — the field is omitted when nothing was masked, so its absence is a truthful signal rather
than an ambiguous empty array.

**Multi-table over-masking.** For a query touching several tables, rules from _every_ referenced table are unioned
before matching column names. A join between a table with a rule on `email` and one without still masks `email`. This is
deliberate: attributing an output column back to its source table is not possible without a full SQL parser, and
guessing wrong would leak the value the rule exists to protect. Over-masking is the safe failure direction.

Table references are extracted by a lexical regex scan (`DatasetPolicy.extractTableReferences`), not a parser, so it
cannot resolve CTEs, aliases, or dynamic SQL. If no references can be extracted at all, every rule is applied by column
name alone — again failing toward more masking.

> **Caveat:** masking is skipped when no tenant context is resolved (unauthenticated / no-tenant mode). It is a
> pass-through in that path, not a deny. The `information_schema` resource also returns rows unmasked.

### 7. Response Compression

Gzip is negotiated at the Cloud Run / load-balancer edge. There is no application-level compression middleware.

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

### 11. Tool Output Schemas

**File**: `src/mcp/schemas/output-schemas.ts`

The query tools declare a **union of three response shapes**, because a query call can legitimately return any of them:

| Shape                 | Identified by                                                          |
| --------------------- | ---------------------------------------------------------------------- |
| Executed              | `rowCount`, `rows`, `jobId`, `executionTimeMs`                         |
| Dry run               | `dryRun: true`                                                         |
| Confirmation required | `status: 'requires_confirmation'`, `reason: 'cost_threshold_exceeded'` |

Both `query_bigquery` and `execute_query` use this union. Previously only the executed shape was declared, so every
dry-run and cost-gated response violated the tool's own advertised schema.

Errors deliberately emit **no** `structuredContent`, since an error conforms to none of the three shapes.

### 12. Tool Annotations (tenant-aware)

**File**: `src/mcp/tools/annotations.ts`

Annotations for the two SQL-executing tools depend on the calling tenant's write mode, because clients use
`readOnlyHint` to decide whether a call can be auto-approved without prompting the user. Advertising a tool as read-only
when the tenant can in fact issue DML would let a destructive statement through unprompted.

| Tenant `writeMode`     | `readOnlyHint` | `destructiveHint` |
| ---------------------- | -------------- | ----------------- |
| `blocked` (default)    | `true`         | `false`           |
| `protected`, `allowed` | `false`        | `true`            |

Affects `query_bigquery` and `execute_query` only. The three metadata tools (`list_datasets`, `list_tables`,
`get_table_schema`) are always `readOnlyHint: true`, `idempotentHint: true`. With no tenant resolved the hints fall back
to the safe read-only form.

### 13. Tool Descriptions

**File**: `src/index.ts` (`TOOL_DESCRIPTIONS`)

Descriptions are written for LLM tool selection rather than as identifiers:

| Tool               | Description (first sentence)                                                          |
| ------------------ | ------------------------------------------------------------------------------------- |
| `query_bigquery`   | Run a GoogleSQL query against BigQuery and return the result rows.                    |
| `execute_query`    | Deprecated alias for `query_bigquery` with identical behaviour and parameters.        |
| `list_datasets`    | List BigQuery datasets the caller is allowed to access, with location and timestamps. |
| `list_tables`      | List the tables in one dataset, including row counts and byte sizes where available.  |
| `get_table_schema` | Get the column names, types and modes for one table, plus optional table metadata.    |

`execute_query` is retained only for backward compatibility with existing clients; prefer `query_bigquery`.

---

## Breaking Changes

### Large result responses

Queries returning **more than 1000 rows** previously responded with `{ totalItems, chunks, items }`, a shape that
matched no declared output schema. They now return the standard executed shape:

```json
{
  "rowCount": 5000,
  "rows": [],
  "jobId": "job_abc123",
  "executionTimeMs": 1420
}
```

Chunk information moved to `_meta`, which is metadata rather than tool output and so is not schema-constrained:

```json
{
  "_meta": {
    "streaming": true,
    "chunks": 50,
    "totalItems": 5000,
    "timestamp": "2026-07-18T12:00:00.000Z"
  }
}
```

Clients reading `items` must switch to `rows`, and `totalItems` to `rowCount` (or `_meta.totalItems`).

> Note that `rows` carries the full result set — `chunks` is advisory metadata, not pagination. Nothing is truncated.

---

## Configuration Reference

### Environment Variables

| Variable                        | Default   | Description                                    |
| ------------------------------- | --------- | ---------------------------------------------- |
| `MCP_TRANSPORT`                 | `stdio`   | Transport: `stdio` or `http`                   |
| `MCP_TRANSPORT_STRICT`          | unset     | Set to `streamable` for strict Streamable HTTP |
| `MCP_HTTP_PORT`                 | `8080`    | HTTP transport listen port                     |
| `MCP_HTTP_HOST`                 | `0.0.0.0` | HTTP transport bind address                    |
| `MCP_HTTP_RATE_LIMIT_MAX`       | `600`     | Requests per minute on `/mcp`                  |
| `MCP_AUTH_REQUIRED`             | unset     | Require OIDC authentication on the HTTP path   |
| `MCP_CIRCUIT_BREAKER_THRESHOLD` | `5`       | Failures before circuit opens                  |
| `MCP_CIRCUIT_BREAKER_RESET_MS`  | `60000`   | Circuit auto-reset delay                       |
| `MCP_STALE_CACHE_MAX_AGE_MS`    | `1800000` | Max stale cache age (30min)                    |

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

4. Verify the probes:

   ```bash
   curl https://SERVICE_URL/health      # liveness — 200 while the process runs
   curl https://SERVICE_URL/readiness   # readiness — 503 if BigQuery is unreachable
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

1. Check `/readiness` — returns `503` with `failed: ["bigquery"]` and the underlying cause. `/health` stays `200`; that
   is correct, since restarting the container cannot fix an upstream outage.
2. Check logs for `circuit_breaker_opened` events
3. Circuit auto-resets after 60s (configurable via `MCP_CIRCUIT_BREAKER_RESET_MS`)
4. Manual reset: call the server's `reset()` method or restart
