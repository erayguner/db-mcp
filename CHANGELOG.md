# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Security

- **Column masking is now actually applied.** `ColumnMaskingEngine` was fully implemented but imported by nothing, while
  the sample-rows resource and its template description both told the model that "tenant column-masking policies" were
  honoured. A tenant could configure redaction on a PII column, have it accepted and Zod-validated, and still receive
  unmasked rows. Masking is now wired through `TenantContext` into the query path and the
  `bigquery://datasets/{datasetId}/tables/{tableId}/sample` resource, and the columns actually masked are reported in
  `provenance.maskedColumns`. For queries touching several tables the engine unions the rules of every referenced table
  and deliberately over-masks: an output column cannot be attributed to a source table without a full SQL parser, and
  over-masking is the safe failure direction.
- **IAM permissions are no longer fabricated.** `getProjectPermissions` ran a `SELECT 1` dry run and, on success,
  returned a hardcoded `['bigquery.jobs.create', 'bigquery.datasets.get', 'bigquery.tables.list']` — then cached that
  invented list as a verified result for `validatePermission` to consume. It now calls the real Cloud Resource Manager
  `testIamPermissions` API. Failed checks are never cached.
- **Inbound WIF tokens are now signature-verified.** `WIFAuthenticator` only base64-decoded the JWT payload, with a
  comment claiming "GCP will verify". That was false: `authenticate()` calls `getAccessToken()` with no arguments, so
  the caller's token was never forwarded to GCP or STS and no downstream verification existed. A forged unsigned JWT
  with a future `exp` and an allowed `iss` would authenticate, return a real GCP access token minted from the server's
  own credentials, and write an audit record naming an attacker-chosen principal. Tokens are now verified with
  `jose`/JWKS; construction fails closed unless `allowUnverifiedTokens` is set explicitly.
- **Tool annotations no longer under-report write risk.** `query_bigquery` advertised `readOnlyHint: true`, but a tenant
  whose `writeMode` permits writes can execute `DELETE` or `DROP TABLE` through it. MCP clients use `readOnlyHint` to
  decide whether a call can be auto-approved without prompting. Annotations are now derived from the calling tenant's
  policy.
- Dataset ID validation in the security middleware accepted hyphens, which BigQuery dataset IDs do not permit; it now
  matches the stricter rule already enforced in `tool-schemas.ts`.

### Fixed

- **Health probes could never fail.** `/health`, `/health/live`, `/readiness` and `/health/ready` all returned hardcoded
  `healthy`/`ready` with no dependency check, so a server with a dead BigQuery connection stayed in the load balancer
  indefinitely. Liveness is now dependency-free (a failed liveness probe restarts the container, so an upstream outage
  must not reach it) and readiness runs real probes, returning 503 naming the failed dependency.
- **`/metrics` served a JSON stub.** The OpenTelemetry `PrometheusExporter` was constructed with
  `preventServerStart: true` and a comment saying it would be mounted on the Express app — it never was, so metrics were
  collected and unreachable. It now serves genuine Prometheus text exposition format.
- **Request handlers were discarded in any test environment.** `MCPServerFactory.getServer()` returned a throwaway stub
  when `NODE_ENV === 'test'` or `JEST_WORKER_ID` was set, so `registerHandlers(getServer())` registered every handler
  onto an object that was immediately thrown away.
- **The connection pool silently overrode caller configuration under test**, clamping `acquireTimeoutMs` to at least 30s
  and `healthCheckIntervalMs` to at least 10s. Tests configuring short timeouts to exercise timeout behaviour got 30s
  instead.
- **`incrementalUpdate()` could never detect a change.** It compared the upstream `dataset.modifiedAt` against
  `existing.lastUpdatedAt`, the local cache-write clock, which is refreshed on every enhance — so any real dataset's
  modification time was always in the past and the update was permanently a no-op.
- `testConnection()` probed with `getDatasets()`, reporting healthy for a principal holding `bigquery.datasets.list` but
  not `bigquery.jobs.create` — every query would then fail. It now performs a dry run.
- `DatasetManager.calculateHitRate()` returned `totalAccesses / cacheSize` — a mean access count, unbounded above 1.0 —
  rather than a hit rate. It now tracks real hits and misses.
- Constructor-time `emit('error')` in the connection pool crashed the process instead of reaching the caller's handler,
  because `EventEmitter` throws on an unhandled `error` event. Constructor-time lifecycle events were also emitted
  before any caller could subscribe, making them unobservable.
- `MCPServerFactory.start()` emitted `'error'` before throwing its typed `ServerFactoryError`, so callers received the
  raw error instead.
- `structuredContent` violated the tools' own advertised `outputSchema` on three paths: errors, dry-run, and the
  large-result (over 1000 rows) response. The query tools now declare a union of the executed, dry-run and
  `requires_confirmation` shapes, and error responses no longer emit schema-violating `structuredContent`.
- `bigquery://jobs/{jobId}` was advertised in `resources/templates/list` but always threw, because
  `BigQueryClient.getJob()` did not exist. It is now implemented.
- The `logging` capability was advertised with no `logging/setLevel` handler and no way to emit `notifications/message`.
  Both are now implemented.
- `notifications/progress` is now emitted. `ProgressNotifier`/`ProgressTracker` were fully implemented but wired to
  nothing — no `progressToken` was ever read from a request.
- `QueryOptimizer.analyzeQueryPlan()` returned a fabricated execution plan — a hardcoded single stage with
  `totalSlotMs: 0`, `estimatedRows: 0`, `recordsRead: 0` — derived from regex-sniffing the SQL text. It is split into
  `analyzeQueryShape()` (the syntactic facts that genuinely are derivable from text) and `getQueryPlan(jobId)`, which
  reads the real `statistics.query.queryPlan` from job metadata. Counters BigQuery does not report are now absent rather
  than reported as zero.
- `registerShutdownHandlers()` added four process listeners per factory and never removed them, leaking on every
  construction. Registration is idempotent and listeners are released on shutdown before anything that can throw.
- `detectSensitiveData()` emitted one path per array element, so a 2000-row result with a `password` column produced
  ~2000 field strings joined into a single warning and written to the audit log. Array indices now collapse to `[]`, so
  output is bounded by the result's shape rather than its row count.
- The health-check interval in `bigquery-client-factory.ts` was the only interval in the codebase not `unref()`d, so it
  pinned the event loop.

### Added

- Readiness probing (`src/monitoring/readiness.ts`) with per-probe timeouts, a short result cache, and single-flight
  de-duplication so orchestrator probe traffic does not repeatedly hit BigQuery.
- `coverageThreshold` floors in `jest.config.mjs`, including a high floor for `src/bigquery/`, so coverage regressions
  fail the build rather than passing silently.
- `completion/complete` handler (MCP 2025-11-25 completions capability): autocompletes `datasetId` / `tableId` for
  resource templates and prompt arguments from the live BigQuery catalog, and advertises the `completions` capability on
  `initialize`

### Changed

- **BREAKING**: queries returning more than 1000 rows now return `{ rowCount, rows, jobId, executionTimeMs }` instead of
  `{ totalItems, chunks, items }`. The previous shape conformed to no declared `outputSchema`; chunk counts moved to
  `_meta`.
- Rewrote the tool descriptions for tool selection. `execute_query` was absent from the description map and so
  advertised itself to models as the literal string `'BigQuery tool'`; it is now documented as a deprecated alias of
  `query_bigquery`. Descriptions now state the dry-run and cost-confirmation semantics, and the tool `title` uses the
  short annotation label rather than duplicating the description.
- Re-enabled the entire dormant test suite. 20 suites (439 tests) were disabled behind `describe.skip` and a `MOCK_FAST`
  / `USE_MOCK_BIGQUERY` env gate that `tests/setup.ts` set unconditionally — neither flag was read anywhere in `src/`,
  so their only effect was to silence tests while CI reported green. The suite is now 871 passing across 68 suites with
  none skipped (previously 315 passing, 439 skipped), and coverage rose from 27% to 58% overall, with `src/bigquery`
  going from 0.89% to 86%.
- Timing-sensitive performance assertions moved behind `npm run test:performance` (`PERF_TIMING_ASSERTIONS=true`) so
  wall-clock thresholds cannot cause spurious CI failures; the correctness assertions run in the default gate.
- Migrate the HTTP transport to the official MCP SDK `StreamableHTTPServerTransport` in stateless mode (a fresh
  `Server` + transport per request). The same request handlers now serve both stdio and HTTP, and the SDK owns
  `MCP-Protocol-Version` header validation, protocol-version negotiation, and per-request streaming. Removes the
  hand-rolled JSON-RPC dispatch layer (~490 net LOC deleted).
- Thread tenant/principal context to tool handlers via the SDK's `extra.authInfo` instead of a parallel HTTP dispatch
  path
- Advertise server capabilities through the SDK `ServerOptions` argument so they are correctly returned on `initialize`
  (previously passed in the wrong constructor position and silently dropped on the stdio path)
- Document tool `inputSchema` as JSON Schema 2020-12, the MCP 2025-11-25 default dialect
- Remove unused `QueryBuilder` class from BigQuery client
- Simplify `BigQueryClient` config parsing (remove redundant fallbacks after Zod defaults)
- Fix lint warnings (unused catch bindings in credential-manager and client)
- Update documentation to match current implementation

### Removed

- `HealthMonitor` and `HealthEndpoints` (~1030 lines). Neither was imported anywhere. `checkReadiness()` never contacted
  BigQuery, so it could not have detected the dead-connection case it existed for, and its "cache hit rate below 30% is
  UNHEALTHY" rule sat on the liveness path — a freshly started instance has a 0% hit rate, so wiring it up would have
  returned 503 on liveness until warm, causing Cloud Run to restart it before it could warm. Replaced by
  `src/monitoring/readiness.ts`.
- `PermissionValidator` (876 lines) — no callers anywhere in `src/` or `tests/`.
- `SessionManager` — only ever constructed and disposed. The Streamable HTTP transport is stateless
  (`sessionIdGenerator: undefined`), so per-session state had nothing to attach to.
- `src/governance/lineage.ts` — no callers.
- The `MOCK_FAST` / `USE_MOCK_BIGQUERY` test-gate flags, which were read by nothing in `src/`.
- JSON-RPC batching (`batch-handler`) — batching was removed from the MCP spec in revision 2025-06-18; the SDK transport
  rejects batch arrays
- Custom Server-Sent Events client registry / progress broadcast and the bespoke gzip middleware, now superseded by the
  SDK transport

## [1.1.0] - 2026-04-04

### Added

- Multi-tenant isolation with per-tenant dataset access policies (allowlist/denylist, write-mode controls)
- OIDC authenticator with JWKS validation and token caching
- Tenant registry with hot-reload support from YAML config
- Auth middleware for MCP request pipeline
- Per-request tenant context factory
- Per-tenant rate limit overrides in security middleware
- HTTP transport with Express for Cloud Run deployment
- MCP tool annotations (`readOnlyHint`, `destructiveHint`, `idempotentHint`)
- BigQuery response provenance metadata (source, freshness, console URLs)
- Schema context in tool responses for copilot consumption
- Comprehensive MCP-layer metrics (per-tool latency histograms, protocol method counters, payload sizes, security
  events, in-flight tracking, uptime gauge)
- Prometheus metrics endpoint
- Cloud Audit Log structured events
- Jest-friendly mocks for MCP SDK components
- Dependabot configuration for automated dependency updates

### Changed

- BigQuery default location changed from `US` to `EU` (`europe-west2`)
- MCP transport default changed from `stdio` to `http` in Docker/Cloud Run
- Dockerfile optimized: multi-stage build, non-root user, production-only deps
- Terraform providers upgraded to v7, minimum Terraform bumped to 1.14
- Terraform Cloud Run config updated for HTTP transport, Secret Manager tenant config, and health probes
- MegaLinter upgraded to v8
- Trivy action bumped to 0.35.0
- All npm dependencies upgraded to latest stable

### Fixed

- Sensitive data detection regex handling improved
- MegaLinter v8 crash resolved
- Trivy CVEs suppressed (CVE-2026-33750, CVE-2026-33672)
- CI deploy workflow parallelized (lint, typecheck, test run concurrently)

## [1.0.0] - 2024-10-27

### Added

- MCP server for BigQuery with Workload Identity Federation
- Tools: query_bigquery, list_datasets, list_tables, get_table_schema
- Security middleware with rate limiting and injection detection
- OpenTelemetry observability (metrics, tracing)
- Connection pooling with health checks
- Dataset metadata caching with LRU eviction
- Query optimizer with cost estimation and LIMIT injection
- Query metrics tracker with slow/expensive query detection
- Dataset discovery with cross-project search and relationship mapping
- Multi-project manager with quota tracking
- Docker multi-stage build
- CI/CD with GitHub Actions (lint, typecheck, test, deploy)
- MegaLinter and Trivy security scanning
