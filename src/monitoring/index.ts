/**
 * Monitoring Module
 *
 * Readiness probing, query metrics, and OpenTelemetry instrumentation for the
 * BigQuery MCP server.
 *
 * The former `HealthMonitor`/`HealthEndpoints` pair was removed: it was imported
 * by nothing, its `checkReadiness()` never contacted BigQuery (so it could not
 * detect the dead-connection case it existed for), and its "cache hit rate below
 * 30% is UNHEALTHY" rule on the liveness path would have crash-looped every cold
 * start. Readiness now lives in `./readiness.js`, which probes the real
 * dependency.
 */

export {
  ReadinessRegistry,
  readinessRegistry,
  registerBigQueryReadinessProbe,
  DEFAULT_PROBE_TIMEOUT_MS,
  DEFAULT_READINESS_CACHE_MS,
  type ReadinessProbe,
  type ReadinessProbeResult,
  type ReadinessResult,
  type ReadinessRegistryOptions,
  type BigQueryReadinessTarget,
} from './readiness.js';

export {
  QueryMetricsTracker,
  type QueryMetrics,
  type QueryStats,
  type UsagePattern,
  type QueryMetricsConfig,
} from '../bigquery/query-metrics.js';

export {
  initializeMetrics,
  getMetrics,
  recordRequest,
  recordError,
  recordQueryLatency,
  recordBigQueryBytes,
  recordAuthAttempt,
  trackConnection,
  shutdownMetrics,
} from '../telemetry/metrics.js';
