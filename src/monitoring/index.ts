/**
 * Monitoring Module
 *
 * Provides comprehensive health monitoring, metrics, and observability
 * for the BigQuery MCP server.
 */

export {
  HealthMonitor,
  HealthStatus,
  type HealthCheckResult,
  type ComponentHealth,
  type SystemHealthReport,
  type ReadinessCheckResult,
  type LivenessCheckResult,
  type HealthMonitorConfig,
} from './health-monitor.js';

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
