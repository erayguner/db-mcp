/**
 * OpenTelemetry Telemetry Module
 *
 * Provides unified initialization and export of:
 * - Distributed tracing (Cloud Trace)
 * - Metrics collection (Cloud Monitoring)
 * - Error reporting integration
 */

export {
  initializeTracing,
  getTracer,
  traced,
  addSpanEvent,
  setSpanAttributes,
  recordException,
  startSpan,
  shutdownTracing,
} from './tracing.js';

export {
  initializeMetrics,
  getMetrics,
  recordRequest,
  recordToolCall,
  recordError,
  recordQueryLatency,
  recordBigQueryBytes,
  recordAuthAttempt,
  trackConnection,
  shutdownMetrics,
  getPrometheusExporter,
} from './metrics.js';

import { initializeTracing, shutdownTracing } from './tracing.js';
import { initializeMetrics, shutdownMetrics } from './metrics.js';
import { logger } from '../utils/logger.js';

/**
 * Initialize all telemetry (tracing + metrics)
 */
export function initializeTelemetry(
  serviceName: string,
  serviceVersion: string,
  projectId: string
): void {
  try {
    initializeTracing(serviceName, serviceVersion, projectId);
    initializeMetrics(serviceName, serviceVersion, projectId);
    logger.info('Telemetry initialized successfully', {
      serviceName,
      serviceVersion,
      projectId,
    });
  } catch (err) {
    logger.error('Failed to initialize telemetry', {
      error: err instanceof Error ? err.message : err,
    });
    throw err;
  }
}

/**
 * Gracefully shutdown all telemetry
 */
export async function shutdownTelemetry(): Promise<void> {
  try {
    await Promise.all([shutdownTracing(), shutdownMetrics()]);
    logger.info('Telemetry shutdown complete');
  } catch (err) {
    logger.error('Error during telemetry shutdown', {
      error: err instanceof Error ? err.message : err,
    });
  }
}
