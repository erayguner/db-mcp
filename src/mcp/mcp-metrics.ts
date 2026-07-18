import { metrics, Counter, Histogram, UpDownCounter } from '@opentelemetry/api';
import { logger } from '../utils/logger.js';

/**
 * MCP Protocol Layer Metrics
 *
 * Dedicated observability for:
 * - Per-tool call latency (histogram with p50/p95/p99)
 * - Protocol method breakdown (list_tools, call_tool, list_resources, read_resource)
 * - Request/response payload sizes
 * - Security events (rate-limited, injection-blocked, unauthorized)
 * - Errors by structured code
 * - In-flight request tracking
 * - Server uptime
 */

export type McpMethod =
  | 'call_tool'
  | 'list_tools'
  | 'list_resources'
  | 'list_resource_templates'
  | 'read_resource'
  | 'list_prompts'
  | 'get_prompt'
  | 'complete'
  | 'set_level';
export type SecurityEvent = 'rate_limited' | 'injection_blocked' | 'unauthorized' | 'tool_blocked';

interface McpMetricInstruments {
  toolDuration: Histogram;
  methodCalls: Counter;
  requestSize: Histogram;
  responseSize: Histogram;
  securityEvents: Counter;
  errorsByCode: Counter;
  inflight: UpDownCounter;
  httpDuration: Histogram;
  httpActiveConnections: UpDownCounter;
}

let instruments: McpMetricInstruments | null = null;
let serverStartTime: number | null = null;

/**
 * Initialize MCP-layer metrics.
 * Must be called after the global MeterProvider is set (i.e., after initializeMetrics).
 */
export function initializeMcpMetrics(serviceName: string): void {
  try {
    const meter = metrics.getMeter(serviceName, '1.0.0');

    instruments = {
      toolDuration: meter.createHistogram('mcp.tool.duration', {
        description: 'MCP tool call latency',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
        },
      }),

      methodCalls: meter.createCounter('mcp.method.calls', {
        description: 'MCP protocol method invocations',
        unit: '1',
      }),

      requestSize: meter.createHistogram('mcp.request.size', {
        description: 'MCP request payload size',
        unit: 'By',
        advice: {
          explicitBucketBoundaries: [64, 256, 1024, 4096, 16384, 65536, 262144, 1048576],
        },
      }),

      responseSize: meter.createHistogram('mcp.response.size', {
        description: 'MCP response payload size',
        unit: 'By',
        advice: {
          explicitBucketBoundaries: [64, 256, 1024, 4096, 16384, 65536, 262144, 1048576],
        },
      }),

      securityEvents: meter.createCounter('mcp.security.events', {
        description: 'MCP security events (blocked requests, rate limits, injection attempts)',
        unit: '1',
      }),

      errorsByCode: meter.createCounter('mcp.errors.by_code', {
        description: 'MCP errors broken down by error code',
        unit: '1',
      }),

      inflight: meter.createUpDownCounter('mcp.inflight', {
        description: 'In-flight MCP tool requests',
        unit: '1',
      }),

      httpDuration: meter.createHistogram('mcp.http.duration', {
        description: 'HTTP transport request duration',
        unit: 'ms',
        advice: {
          explicitBucketBoundaries: [1, 5, 10, 25, 50, 100, 250, 500, 1000, 5000],
        },
      }),

      httpActiveConnections: meter.createUpDownCounter('mcp.http.connections.active', {
        description: 'Active HTTP connections to the MCP transport',
        unit: '1',
      }),
    };

    // Track server uptime via observable gauge
    serverStartTime = Date.now();
    meter
      .createObservableGauge('mcp.server.uptime', {
        description: 'Server uptime in seconds',
        unit: 's',
      })
      .addCallback((result) => {
        if (serverStartTime) {
          result.observe(Math.floor((Date.now() - serverStartTime) / 1000));
        }
      });

    logger.info('MCP metrics initialized', {
      instruments: Object.keys(instruments).length,
    });
  } catch (error) {
    logger.error('Failed to initialize MCP metrics', { error });
  }
}

/**
 * Start a timer for a tool call. Returns a stop function.
 */
export function startToolTimer(tool: string): (success: boolean) => void {
  const start = performance.now();
  if (instruments) {
    instruments.inflight.add(1, { tool });
  }
  return (success: boolean) => {
    const durationMs = performance.now() - start;
    if (instruments) {
      instruments.inflight.add(-1, { tool });
      instruments.toolDuration.record(durationMs, { tool, success: String(success) });
    }
  };
}

/**
 * Record a protocol method invocation.
 */
export function recordProtocolMethod(method: McpMethod): void {
  if (instruments) {
    instruments.methodCalls.add(1, { method });
  }
}

/**
 * Record request and response payload sizes.
 */
export function recordPayloadSize(
  method: McpMethod,
  requestBytes: number,
  responseBytes: number
): void {
  if (instruments) {
    instruments.requestSize.record(requestBytes, { method });
    instruments.responseSize.record(responseBytes, { method });
  }
}

/**
 * Record a security event.
 */
export function recordSecurityEvent(event: SecurityEvent, tool?: string): void {
  if (instruments) {
    const attrs: Record<string, string> = { event };
    if (tool) attrs.tool = tool;
    instruments.securityEvents.add(1, attrs);
  }
}

/**
 * Record an error by its structured code.
 */
export function recordErrorByCode(code: string, tool?: string): void {
  if (instruments) {
    const attrs: Record<string, string> = { code };
    if (tool) attrs.tool = tool;
    instruments.errorsByCode.add(1, attrs);
  }
}

/**
 * Record HTTP transport request metrics.
 */
export function recordHttpRequest(method: string, statusCode: number, durationMs: number): void {
  if (instruments) {
    instruments.httpDuration.record(durationMs, {
      method,
      status_code: String(statusCode),
    });
  }
}

/**
 * Track HTTP connection lifecycle.
 */
export function trackHttpConnection(delta: 1 | -1): void {
  if (instruments) {
    instruments.httpActiveConnections.add(delta);
  }
}
