import { NodeTracerProvider } from '@opentelemetry/sdk-trace-node';
import { Resource } from '@opentelemetry/resources';
import { SEMRESATTRS_SERVICE_NAME, SEMRESATTRS_SERVICE_VERSION } from '@opentelemetry/semantic-conventions';
import { BatchSpanProcessor } from '@opentelemetry/sdk-trace-base';
import { TraceExporter } from '@google-cloud/opentelemetry-cloud-trace-exporter';
import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { registerInstrumentations } from '@opentelemetry/instrumentation';
import { trace, SpanStatusCode, Span } from '@opentelemetry/api';
import { logger } from '../utils/logger.js';

/**
 * OpenTelemetry Tracing Configuration for GCP Cloud Trace
 *
 * Provides distributed tracing for:
 * - HTTP requests
 * - BigQuery operations
 * - Authentication flows
 * - Error tracking
 */

let tracerProvider: NodeTracerProvider | null = null;
let tracer: ReturnType<typeof trace.getTracer> | null = null;

export function initializeTracing(serviceName: string, serviceVersion: string, projectId: string): void {
  try {
    // Create resource with service information
    const resource = new Resource({
      [SEMRESATTRS_SERVICE_NAME]: serviceName,
      [SEMRESATTRS_SERVICE_VERSION]: serviceVersion,
    });

    // Initialize tracer provider
    tracerProvider = new NodeTracerProvider({
      resource,
    });

    // Configure Cloud Trace exporter
    const exporter = new TraceExporter({
      projectId,
    });

    // Add batch span processor for efficient exporting
    tracerProvider.addSpanProcessor(
      new BatchSpanProcessor(exporter, {
        maxQueueSize: 100,
        maxExportBatchSize: 50,
        scheduledDelayMillis: 5000,
      })
    );

    // Register the provider
    tracerProvider.register();

    // Register auto-instrumentations for common libraries
    registerInstrumentations({
      instrumentations: [
        getNodeAutoInstrumentations({
          '@opentelemetry/instrumentation-fs': {
            enabled: false, // Disable filesystem instrumentation
          },
          '@opentelemetry/instrumentation-http': {
            enabled: true,
            ignoreIncomingPaths: ['/health', '/metrics'],
          },
        }),
      ],
    });

    // Get tracer instance
    tracer = trace.getTracer(serviceName, serviceVersion);

    logger.info('OpenTelemetry tracing initialized', {
      serviceName,
      serviceVersion,
      projectId,
    });
  } catch (err) {
    logger.error('Failed to initialize tracing', { error: err instanceof Error ? err.message : err });
  }
}

/**
 * Get the global tracer instance
 */
export function getTracer(): ReturnType<typeof trace.getTracer> {
  if (!tracer) {
    throw new Error('Tracer not initialized. Call initializeTracing() first.');
  }
  return tracer;
}

/**
 * Create a traced function wrapper
 */
export function traced<TArgs extends unknown[], TReturn>(
  spanName: string,
  fn: (...args: TArgs) => TReturn | Promise<TReturn>,
  attributes?: Record<string, string | number | boolean>
): (...args: TArgs) => Promise<TReturn> | TReturn {
  return (...args: TArgs): Promise<TReturn> | TReturn => {
    if (!tracer) {
      return fn(...args);
    }

    return tracer.startActiveSpan(spanName, (span: Span) => {
      try {
        // Add custom attributes
        if (attributes) {
          Object.entries(attributes).forEach(([key, value]) => {
            span.setAttribute(key, value);
          });
        }

        // Execute function
  const result = fn(...args);

        // Handle promises
        if (result instanceof Promise) {
          return result
            .then((res: TReturn) => {
              span.setStatus({ code: SpanStatusCode.OK });
              span.end();
              return res;
            })
            .catch((e: unknown) => {
              const err = e instanceof Error ? e : new Error(String(e));
              span.recordException(err);
              span.setStatus({
                code: SpanStatusCode.ERROR,
                message: err.message,
              });
              span.end();
              throw err;
            });
        }

        // Handle synchronous functions
        span.setStatus({ code: SpanStatusCode.OK });
        span.end();
        return result;
      } catch (e: unknown) {
        const err = e instanceof Error ? e : new Error(String(e));
        span.recordException(err);
        span.setStatus({
          code: SpanStatusCode.ERROR,
          message: err.message,
        });
        span.end();
        throw err;
      }
    });
  };
}

/**
 * Add span event
 */
export function addSpanEvent(name: string, attributes?: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.addEvent(name, attributes);
  }
}

/**
 * Set span attributes
 */
export function setSpanAttributes(attributes: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) {
    Object.entries(attributes).forEach(([key, value]) => {
      span.setAttribute(key, value);
    });
  }
}

/**
 * Record exception in current span
 */
export function recordException(error: Error, attributes?: Record<string, string | number | boolean>): void {
  const span = trace.getActiveSpan();
  if (span) {
    span.recordException(error);
    if (attributes) {
      Object.entries(attributes).forEach(([key, value]) => {
        span.setAttribute(key, value);
      });
    }
    span.setStatus({
      code: SpanStatusCode.ERROR,
      message: error.message,
    });
  }
}

/**
 * Create a manual span
 */
export function startSpan(name: string, attributes?: Record<string, string | number | boolean>): Span | null {
  if (!tracer) {
    return null;
  }
  const span = tracer.startSpan(name);
  if (attributes) {
    Object.entries(attributes).forEach(([key, value]) => {
      span.setAttribute(key, value);
    });
  }
  return span;
}

/**
 * Gracefully shutdown tracing
 */
export async function shutdownTracing(): Promise<void> {
  if (tracerProvider) {
    try {
      await tracerProvider.shutdown();
      logger.info('OpenTelemetry tracing shutdown complete');
    } catch (err) {
      logger.error('Error shutting down tracing', { error: err instanceof Error ? err.message : err });
    }
  }
}
