import { MeterProvider, PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { PrometheusExporter } from '@opentelemetry/exporter-prometheus';
import { resourceFromAttributes } from '@opentelemetry/resources';
import { ATTR_SERVICE_NAME, ATTR_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { MetricExporter } from '@google-cloud/opentelemetry-cloud-monitoring-exporter';
import { metrics, Counter, Histogram, UpDownCounter } from '@opentelemetry/api';
import { logger } from '../utils/logger.js';

/**
 * OpenTelemetry Metrics Configuration for GCP Cloud Monitoring
 *
 * Tracks:
 * - Request counts
 * - Error rates
 * - Query latencies
 * - BigQuery bytes processed
 * - Authentication attempts
 */

let meterProvider: MeterProvider | null = null;
let meter: ReturnType<typeof metrics.getMeter> | null = null;
let prometheusExporter: PrometheusExporter | null = null;

// Metric instruments
interface MetricInstruments {
  requestCounter: Counter;
  errorCounter: Counter;
  queryLatency: Histogram;
  bigqueryBytesProcessed: Counter;
  authAttempts: Counter;
  authFailures: Counter;
  activeConnections: UpDownCounter;
}

let instruments: MetricInstruments | null = null;

export function initializeMetrics(serviceName: string, serviceVersion: string, projectId: string) {
  try {
    // Create resource
    const resource = resourceFromAttributes({
      [ATTR_SERVICE_NAME]: serviceName,
      [ATTR_SERVICE_VERSION]: serviceVersion,
    });

    // Configure Cloud Monitoring exporter
    const exporter = new MetricExporter({
      projectId,
    });

    // Create metric reader with periodic export (push to Cloud Monitoring)
    const metricReader = new PeriodicExportingMetricReader({
      exporter,
      exportIntervalMillis: 60000, // Export every 60 seconds
    });

    // Create Prometheus exporter (pull via /metrics endpoint)
    prometheusExporter = new PrometheusExporter(
      { preventServerStart: true }, // We mount the endpoint on our own Express app
    );

    // Initialize meter provider with both readers
    meterProvider = new MeterProvider({
      resource,
      readers: [metricReader, prometheusExporter],
    });

    // Set global meter provider
    metrics.setGlobalMeterProvider(meterProvider);

    // Get meter instance
    meter = metrics.getMeter(serviceName, serviceVersion);

    // Create metric instruments
    instruments = {
      requestCounter: meter.createCounter('mcp.requests.total', {
        description: 'Total number of MCP requests',
        unit: '1',
      }),

      errorCounter: meter.createCounter('mcp.errors.total', {
        description: 'Total number of errors',
        unit: '1',
      }),

      queryLatency: meter.createHistogram('mcp.bigquery.query.duration', {
        description: 'BigQuery query latency',
        unit: 'ms',
      }),

      bigqueryBytesProcessed: meter.createCounter('mcp.bigquery.bytes.processed', {
        description: 'Total bytes processed by BigQuery',
        unit: 'By',
      }),

      authAttempts: meter.createCounter('mcp.auth.attempts.total', {
        description: 'Total authentication attempts',
        unit: '1',
      }),

      authFailures: meter.createCounter('mcp.auth.failures.total', {
        description: 'Total authentication failures',
        unit: '1',
      }),

      activeConnections: meter.createUpDownCounter('mcp.connections.active', {
        description: 'Number of active connections',
        unit: '1',
      }),
    };

    logger.info('OpenTelemetry metrics initialized', {
      serviceName,
      serviceVersion,
      projectId,
    });
  } catch (error) {
    logger.error('Failed to initialize metrics', { error });
  }
}

/**
 * Get metric instruments
 */
export function getMetrics(): MetricInstruments {
  if (!instruments) {
    throw new Error('Metrics not initialized. Call initializeMetrics() first.');
  }
  return instruments;
}

/**
 * Record MCP request
 */
export function recordRequest(tool: string, success: boolean) {
  if (instruments) {
    instruments.requestCounter.add(1, {
      tool,
      success: success.toString(),
    });
  }
}

/**
 * Record error
 */
export function recordError(errorType: string, tool?: string) {
  if (instruments) {
    const attributes: Record<string, string> = { errorType };
    if (tool) {
      attributes.tool = tool;
    }
    instruments.errorCounter.add(1, attributes);
  }
}

/**
 * Record BigQuery query latency
 */
export function recordQueryLatency(duration: number, queryType: string, success: boolean) {
  if (instruments) {
    instruments.queryLatency.record(duration, {
      queryType,
      success: success.toString(),
    });
  }
}

/**
 * Record BigQuery bytes processed
 */
export function recordBigQueryBytes(bytes: number, operation: string) {
  if (instruments) {
    instruments.bigqueryBytesProcessed.add(bytes, {
      operation,
    });
  }
}

/**
 * Record authentication attempt
 */
export function recordAuthAttempt(method: string, success: boolean) {
  if (instruments) {
    instruments.authAttempts.add(1, {
      method,
      success: success.toString(),
    });

    if (!success) {
      instruments.authFailures.add(1, {
        method,
      });
    }
  }
}

/**
 * Track active connection
 */
export function trackConnection(delta: 1 | -1) {
  if (instruments) {
    instruments.activeConnections.add(delta);
  }
}

/**
 * Get the Prometheus exporter for mounting on an Express app.
 */
export function getPrometheusExporter(): PrometheusExporter | null {
  return prometheusExporter;
}

/**
 * Gracefully shutdown metrics
 */
export async function shutdownMetrics() {
  if (meterProvider) {
    try {
      await meterProvider.shutdown();
      logger.info('OpenTelemetry metrics shutdown complete');
    } catch (error) {
      logger.error('Error shutting down metrics', { error });
    }
  }
}
