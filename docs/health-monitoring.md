# Health and Readiness Probes

Liveness, readiness, and Prometheus scrape endpoints served by the Streamable HTTP transport
(`src/mcp/transports/http-transport.ts`), backed by the readiness registry in `src/monitoring/readiness.ts`.

## Overview

The server exposes three distinct operational surfaces on its HTTP port:

| Endpoint                      | Question answered                            | Failure consequence            |
| ----------------------------- | -------------------------------------------- | ------------------------------ |
| `/health`, `/health/live`     | Is this process still able to run code?      | Orchestrator **restarts** it   |
| `/readiness`, `/health/ready` | Can this instance serve a request right now? | Orchestrator **drains** it     |
| `/metrics`                    | What are the current metric values?          | Scrape gap in Cloud Monitoring |

These are not aliases of each other. The distinction is load-bearing and is covered by
`tests/unit/mcp/http-health-probes.test.ts`.

## Liveness: `/health` and `/health/live`

Liveness is **deliberately dependency-free**. Reaching the handler proves the event loop is turning and the process can
serve HTTP, which is all liveness should assert.

```json
{
  "status": "healthy",
  "uptimeSeconds": 1234,
  "timestamp": "2026-07-18T12:00:00.000Z"
}
```

Always `200` while the process runs. Responses set `Cache-Control: no-store`.

### Why liveness must not check BigQuery

A failed liveness probe restarts the container. If liveness depended on BigQuery, a BigQuery outage would roll the
entire fleet — turning a recoverable upstream incident into a crash-loop that cannot recover, because restarting does
nothing to fix a remote dependency. Dependency checks belong on readiness, which only removes the instance from the load
balancer and lets it rejoin automatically once the dependency recovers.

## Readiness: `/readiness` and `/health/ready`

Readiness runs the probes registered in the `ReadinessRegistry` and reports the aggregate verdict. Ready responses are
`200`; a failed dependency yields `503` naming the failing check and its cause, so an operator can see _which_
dependency is down without reading logs.

Ready:

```json
{
  "ready": true,
  "checks": [{ "name": "bigquery", "ok": true, "durationMs": 42 }],
  "failed": [],
  "cached": false,
  "timestamp": "2026-07-18T12:00:00.000Z"
}
```

Not ready (HTTP `503`):

```json
{
  "ready": false,
  "checks": [
    {
      "name": "bigquery",
      "ok": false,
      "durationMs": 87,
      "error": "ECONNREFUSED bigquery.googleapis.com:443"
    }
  ],
  "failed": ["bigquery"],
  "cached": false,
  "timestamp": "2026-07-18T12:00:00.000Z"
}
```

When no probes are registered the endpoint answers `200` but says so explicitly rather than implying dependencies were
verified:

```json
{
  "ready": true,
  "checks": [],
  "note": "No readiness probes registered; dependency health is unverified.",
  "timestamp": "2026-07-18T12:00:00.000Z"
}
```

## The readiness registry

`ReadinessRegistry` (`src/monitoring/readiness.ts`) holds named probes. A probe signals failure by throwing or
rejecting; the thrown message becomes the reported cause.

```typescript
export type ReadinessProbe = () => Promise<void> | void;

const registry = new ReadinessRegistry({
  timeoutMs: 2_000, // DEFAULT_PROBE_TIMEOUT_MS
  cacheTtlMs: 5_000, // DEFAULT_READINESS_CACHE_MS
});

registry.register('bigquery', async () => {
  await client.query({ query: 'SELECT 1', dryRun: true, retry: false });
});
```

A process-wide singleton, `readinessRegistry`, is exported and is what the HTTP transport reads by default. The
transport accepts a `readiness` config option so tests can supply an isolated registry.

### Per-probe timeout

Each probe runs under a timeout (2s default). A hung dependency must not hang the probe request itself: an orchestrator
only interprets a non-answering probe as a failure after its own, much longer, timeout — during which the instance keeps
receiving traffic it cannot serve. A probe that outlives its budget is recorded as `error: "timed out after 2000ms"`.

### Result caching and single-flight

Verdicts are cached for 5s by default, and concurrent evaluations are de-duplicated into a single in-flight run. Probe
traffic is periodic and redundant — Cloud Run, the load balancer, and uptime checks all poll independently — so without
caching every probe would issue a fresh BigQuery round trip. Responses served from cache carry `"cached": true`.

Registering or unregistering a probe invalidates the cache so the change is reflected on the next probe.

### Failure containment

`check()` never rejects. A probe that throws, rejects, or times out is recorded as a failed check rather than
propagating — a probe endpoint that throws is indistinguishable from a crashed server to an orchestrator, which would
escalate a drain into a restart.

## The BigQuery probe

Registered at server startup in `src/index.ts`. It asserts both that the client is locally usable (`isHealthy()`) and
that the BigQuery API is reachable with valid credentials.

Reachability uses a **dry-run `SELECT 1`**: BigQuery validates and plans the query without executing it, so the round
trip proves connectivity, authentication, and authorization while scanning zero bytes and incurring zero cost. Combined
with the registry cache this issues at most one API call per cache window regardless of probe volume. The probe passes
`retry: false` — retrying a dependency that is already failing only delays the not-ready verdict past the probe's
timeout budget.

### Why an uninitialised client reports ready

The BigQuery client is initialized lazily on first use. Before that initialization the probe **deliberately reports
ready**:

```typescript
readinessRegistry.register('bigquery', async () => {
  const client = this.bigQueryClient;
  if (!client) {
    return; // Not yet initialised — ready. See below.
  }
  if (!client.isHealthy()) {
    throw new Error('BigQuery connection pool is unavailable');
  }
  await client.query({ query: 'SELECT 1', dryRun: true, retry: false });
});
```

An instance that has not yet served a request has nothing known to be broken. Reporting not-ready would drain it from
the load balancer — so it would never receive the request that triggers initialization, and would never become ready.
That is a **cold-start deadlock**: the instance would sit permanently drained, waiting for traffic it has excluded
itself from receiving.

The probe is also registered at startup rather than inside `initializeBigQuery()` for a related reason: until a request
arrived, the registry would hold no probes at all, and `/readiness` could never fail — the exact hole this closes.

Once the client exists, its real reachability decides the verdict.

## Metrics: `/metrics`

Serves the OpenTelemetry Prometheus exporter's registry in Prometheus text exposition format
(`text/plain; version=0.0.4`).

The exporter is constructed with `preventServerStart: true` (`src/telemetry/metrics.ts`) so it does not bind a port of
its own; this route is the mount point it expects.

Before telemetry is initialised there is no registry to scrape. That is a scrape failure rather than an empty result, so
the endpoint answers `503` with a comment body rather than an empty `200` that would misreport the server as having no
metrics:

```text
# Prometheus metrics unavailable: telemetry is not initialised
```

Metric names and attributes are documented in [MONITORING-GUIDE.md](./MONITORING-GUIDE.md).

## Deployment configuration

### Cloud Run

```yaml
livenessProbe:
  httpGet:
    path: /health
  initialDelaySeconds: 10
  periodSeconds: 30
  failureThreshold: 3

startupProbe:
  httpGet:
    path: /health
  periodSeconds: 5
  failureThreshold: 12
```

Cloud Run has no readiness probe concept for request routing; use `/readiness` from uptime checks and from your load
balancer's backend health check instead.

### Kubernetes

```yaml
livenessProbe:
  httpGet:
    path: /health/live
    port: 8080
  periodSeconds: 30
  failureThreshold: 3

readinessProbe:
  httpGet:
    path: /health/ready
    port: 8080
  periodSeconds: 10
  failureThreshold: 2
```

Keep the readiness period at or above the registry cache TTL to avoid probing more often than the verdict can change.

## Troubleshooting

### Readiness returns 503 with `failed: ["bigquery"]`

Read the `error` on the failing check — it carries the underlying cause verbatim.

| Error text contains          | Cause                                                      |
| ---------------------------- | ---------------------------------------------------------- |
| `not initialised`            | Client absent or connection pool unavailable               |
| `ECONNREFUSED` / `ENOTFOUND` | Network egress or DNS to `bigquery.googleapis.com` blocked |
| `timed out after`            | BigQuery reachable but not answering within the budget     |
| `PERMISSION_DENIED`          | Service account lacks `bigquery.jobs.create`               |
| `invalid_grant` / auth text  | WIF or OIDC credential exchange failing                    |

Liveness staying `200` throughout is correct and expected — the instance is healthy, its dependency is not.

### Readiness always returns 200 with a `note`

No probes are registered. In an HTTP deployment this means startup did not reach probe registration; check the startup
logs for `Readiness probe registered`.

### `/metrics` returns 503

Telemetry was never initialised. Confirm `initializeMetrics()` ran at startup and that telemetry is not disabled by
configuration.

### Readiness verdict looks stale

Verdicts are cached for `DEFAULT_READINESS_CACHE_MS` (5s). A recovery can take up to that long to appear. `cached` on
the response tells you whether you are seeing a fresh evaluation.

## API reference

```typescript
class ReadinessRegistry {
  constructor(options?: ReadinessRegistryOptions);

  register(name: string, probe: ReadinessProbe): void;
  unregister(name: string): boolean;
  clear(): void;
  invalidate(): void;
  check(): Promise<ReadinessResult>;

  get size(): number;
  probeNames(): string[];
}

interface ReadinessResult {
  ready: boolean;
  checks: ReadinessProbeResult[];
  checkedAt: string;
  cached: boolean;
}

interface ReadinessProbeResult {
  name: string;
  ok: boolean;
  durationMs: number;
  error?: string;
}

// Registers a probe asserting client health plus a dry-run `SELECT 1`.
function registerBigQueryReadinessProbe(
  target: BigQueryReadinessTarget,
  options?: { registry?: ReadinessRegistry; name?: string }
): void;
```

Exported from `src/monitoring/index.ts` alongside `readinessRegistry`, `DEFAULT_PROBE_TIMEOUT_MS`, and
`DEFAULT_READINESS_CACHE_MS`.

## See Also

- [MONITORING-GUIDE.md](./MONITORING-GUIDE.md) — OpenTelemetry metrics, alerts, dashboards, SLOs
- [architecture/06-observability.md](./architecture/06-observability.md) — observability architecture
- [DOCKER-DEPLOYMENT.md](./DOCKER-DEPLOYMENT.md) — container and Cloud Run deployment
