/**
 * Health Monitoring Integration Example
 *
 * Demonstrates how to integrate the health monitoring system
 * with the BigQuery MCP server.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { HealthMonitor, HealthStatus } from '../src/monitoring/health-monitor.js';
import { HealthEndpoints } from '../src/monitoring/health-endpoints.js';
import { ConnectionPool } from '../src/bigquery/connection-pool.js';
import { DatasetManager } from '../src/bigquery/dataset-manager.js';
import { WorkloadIdentityFederation } from '../src/auth/workload-identity.js';
import { QueryMetricsTracker } from '../src/bigquery/query-metrics.js';
import { logger } from '../src/utils/logger.js';

/**
 * Example 1: Basic Health Monitor Setup
 */
export async function basicHealthMonitorSetup() {
  // Initialize components
  const connectionPool = new ConnectionPool({
    minConnections: 2,
    maxConnections: 10,
    acquireTimeoutMs: 30000,
    idleTimeoutMs: 300000,
    projectId: 'my-project',
  });

  const datasetManager = new DatasetManager({
    cacheSize: 100,
    cacheTTLMs: 3600000,
    autoDiscovery: true,
  });

  const queryMetrics = new QueryMetricsTracker({
    slowQueryThresholdMs: 5000,
    expensiveCostThresholdUSD: 0.50,
    enableDetailedTracking: true,
  });

  // Create health monitor with custom thresholds
  const healthMonitor = new HealthMonitor({
    checkInterval: 30000,
    enableAutoChecks: true,
    connectionPoolThresholds: {
      minHealthyConnections: 2,
      maxWaitingRequests: 5,
      maxFailureRate: 0.05,
    },
    cacheThresholds: {
      minHitRate: 0.4,
      maxEvictionRate: 0.3,
    },
    queryThresholds: {
      maxErrorRate: 0.05,
      maxAverageLatency: 3000,
    },
  });

  // Register components
  healthMonitor.registerComponents({
    connectionPool,
    datasetManager,
    queryMetrics,
  });

  return { healthMonitor, connectionPool, datasetManager, queryMetrics };
}

/**
 * Example 2: MCP Server with Health Monitoring
 */
export class MCPServerWithHealthMonitoring {
  private server: Server;
  private healthMonitor: HealthMonitor;
  private healthEndpoints: HealthEndpoints;
  private connectionPool: ConnectionPool;
  private datasetManager: DatasetManager;
  private queryMetrics: QueryMetricsTracker;

  constructor() {
    this.server = new Server({
      name: 'bigquery-mcp-server-with-health',
      version: '1.0.0',
    });

    // Initialize components
    this.connectionPool = new ConnectionPool({
      minConnections: 2,
      maxConnections: 10,
      projectId: process.env.GCP_PROJECT_ID,
    });

    this.datasetManager = new DatasetManager({
      cacheSize: 100,
      cacheTTLMs: 3600000,
    });

    this.queryMetrics = new QueryMetricsTracker();

    // Initialize health monitor
    this.healthMonitor = new HealthMonitor({
      enableAutoChecks: true,
      checkInterval: 30000,
    });

    this.healthMonitor.registerComponents({
      connectionPool: this.connectionPool,
      datasetManager: this.datasetManager,
      queryMetrics: this.queryMetrics,
    });

    this.healthEndpoints = new HealthEndpoints(this.healthMonitor);

    this.setupHealthEventHandlers();
    this.setupMCPHandlers();
  }

  private setupHealthEventHandlers() {
    // Log health check results
    this.healthMonitor.on('health:check', (report) => {
      logger.info('Health check completed', {
        status: report.status,
        components: report.components.length,
        healthyChecks: report.metrics.healthyChecks,
        degradedChecks: report.metrics.degradedChecks,
        unhealthyChecks: report.metrics.unhealthyChecks,
      });
    });

    // Handle health alerts
    this.healthMonitor.on('health:alert', ({ severity, report }) => {
      logger.error('Health alert triggered', {
        severity,
        status: report.status,
        timestamp: report.timestamp,
      });

      // Send to monitoring system
      this.sendHealthAlert(severity, report);
    });
  }

  private async sendHealthAlert(severity: string, report: any) {
    // Example: Send to Cloud Monitoring, PagerDuty, or Slack
    logger.warn('Health alert would be sent to monitoring system', {
      severity,
      unhealthyComponents: report.components
        .filter((c: any) => c.status === HealthStatus.UNHEALTHY)
        .map((c: any) => c.name),
    });
  }

  private setupMCPHandlers() {
    // Add health check tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => ({
      tools: [
        {
          name: 'check_health',
          description: 'Get comprehensive system health status',
          inputSchema: {
            type: 'object',
            properties: {
              component: {
                type: 'string',
                description: 'Optional: Check specific component',
                enum: [
                  'connection-pool',
                  'dataset-manager-cache',
                  'query-performance',
                ],
              },
            },
          },
        },
        {
          name: 'check_readiness',
          description: 'Check if service is ready to accept requests',
          inputSchema: { type: 'object', properties: {} },
        },
        {
          name: 'check_liveness',
          description: 'Check if service is alive and responsive',
          inputSchema: { type: 'object', properties: {} },
        },
        // ... other BigQuery tools
      ],
    }));

    // Handle health check tools
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'check_health':
          return await this.handleHealthCheck(args as { component?: string });

        case 'check_readiness':
          return await this.handleReadinessCheck();

        case 'check_liveness':
          return await this.handleLivenessCheck();

        // ... other tool handlers
      }
    });

    // Add health resources
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => ({
      resources: [
        {
          uri: 'health://system',
          name: 'System Health',
          description: 'Comprehensive system health report',
          mimeType: 'application/json',
        },
        {
          uri: 'health://metrics',
          name: 'Performance Metrics',
          description: 'Query performance and system metrics',
          mimeType: 'application/json',
        },
      ],
    }));

    // Handle health resources
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const { uri } = request.params;

      if (uri === 'health://system') {
        const resource = await this.healthEndpoints.getMCPHealthResource();
        return {
          contents: [resource],
        };
      }

      if (uri === 'health://metrics') {
        const stats = this.queryMetrics.getStats();
        return {
          contents: [
            {
              uri,
              name: 'Performance Metrics',
              description: 'Query performance statistics',
              mimeType: 'application/json',
              text: JSON.stringify(stats, null, 2),
            },
          ],
        };
      }

      throw new Error(`Unknown resource: ${uri}`);
    });
  }

  private async handleHealthCheck(args: { component?: string }) {
    try {
      if (args.component) {
        const health = await this.healthEndpoints.handleComponentHealth(
          args.component
        );
        return {
          content: [
            {
              type: 'text',
              text: health.body,
            },
          ],
        };
      }

      const summary = await this.healthEndpoints.getHealthSummary();
      return {
        content: [
          {
            type: 'text',
            text: summary,
          },
        ],
      };
    } catch (error) {
      logger.error('Health check failed', { error });
      return {
        content: [
          {
            type: 'text',
            text: `Error checking health: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleReadinessCheck() {
    try {
      const result = await this.healthMonitor.checkReadiness();
      const status = result.ready ? '✓ READY' : '✗ NOT READY';

      const components = Object.entries(result.components)
        .map(([name, ready]) => `  ${ready ? '✓' : '✗'} ${name}`)
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `${status}\n\nComponents:\n${components}`,
          },
        ],
      };
    } catch (error) {
      logger.error('Readiness check failed', { error });
      return {
        content: [
          {
            type: 'text',
            text: `Error checking readiness: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  private async handleLivenessCheck() {
    try {
      const result = await this.healthMonitor.checkLiveness();
      const uptimeSeconds = Math.floor(result.uptime / 1000);

      return {
        content: [
          {
            type: 'text',
            text: `✓ ALIVE\n\nUptime: ${uptimeSeconds} seconds`,
          },
        ],
      };
    } catch (error) {
      logger.error('Liveness check failed', { error });
      return {
        content: [
          {
            type: 'text',
            text: `Error checking liveness: ${error}`,
          },
        ],
        isError: true,
      };
    }
  }

  async start() {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);

    logger.info('MCP Server with health monitoring started', {
      autoChecks: true,
      checkInterval: 30000,
    });
  }

  async shutdown() {
    logger.info('Shutting down server');
    this.healthMonitor.shutdown();
    await this.connectionPool.shutdown();
    this.datasetManager.shutdown();
    this.queryMetrics.stopCleanup();
    logger.info('Shutdown complete');
  }
}

/**
 * Example 3: Custom Health Check Thresholds
 */
export function customHealthCheckThresholds() {
  const healthMonitor = new HealthMonitor({
    checkInterval: 60000, // Check every minute
    enableAutoChecks: true,

    // Strict connection pool requirements
    connectionPoolThresholds: {
      minHealthyConnections: 5, // Require at least 5 connections
      maxWaitingRequests: 3, // Alert if more than 3 requests waiting
      maxFailureRate: 0.01, // Only 1% failure allowed
    },

    // High cache performance requirements
    cacheThresholds: {
      minHitRate: 0.7, // Require 70% hit rate
      maxEvictionRate: 0.2, // Max 20% eviction rate
    },

    // Performance SLA requirements
    queryThresholds: {
      maxErrorRate: 0.01, // Only 1% query errors allowed
      maxAverageLatency: 2000, // Max 2 second average latency
    },
  });

  return healthMonitor;
}

/**
 * Example 4: Integration with Cloud Monitoring
 */
export class CloudMonitoringIntegration {
  constructor(
    private healthMonitor: HealthMonitor,
    private projectId: string
  ) {
    this.setupCloudMonitoringExport();
  }

  private setupCloudMonitoringExport() {
    // Export health metrics to Cloud Monitoring
    this.healthMonitor.on('health:check', (report) => {
      this.exportHealthMetrics(report);
    });
  }

  private async exportHealthMetrics(report: any) {
    // Convert health status to numeric value for monitoring
    const statusValue =
      report.status === HealthStatus.HEALTHY
        ? 1
        : report.status === HealthStatus.DEGRADED
        ? 0.5
        : 0;

    // Export to Cloud Monitoring (example)
    logger.info('Exporting health metrics to Cloud Monitoring', {
      status: report.status,
      statusValue,
      components: report.components.length,
    });

    // In production, use Cloud Monitoring API:
    // const monitoring = new Monitoring.MetricServiceClient();
    // await monitoring.createTimeSeries({...});
  }
}

/**
 * Example 5: HTTP Health Endpoints for Cloud Run
 */
import express from 'express';

export function setupHTTPHealthEndpoints(healthMonitor: HealthMonitor) {
  const app = express();
  const healthEndpoints = new HealthEndpoints(healthMonitor);

  // Liveness probe
  app.get('/health/live', async (req, res) => {
    const result = await healthEndpoints.handleLiveness();
    res.status(result.status).json(JSON.parse(result.body));
  });

  // Readiness probe
  app.get('/health/ready', async (req, res) => {
    const result = await healthEndpoints.handleReadiness();
    res.status(result.status).json(JSON.parse(result.body));
  });

  // Comprehensive health
  app.get('/health', async (req, res) => {
    const result = await healthEndpoints.handleHealth();
    res.status(result.status).json(JSON.parse(result.body));
  });

  // Component-specific health
  app.get('/health/component/:name', async (req, res) => {
    const result = await healthEndpoints.handleComponentHealth(req.params.name);
    res.status(result.status).json(JSON.parse(result.body));
  });

  const port = process.env.HEALTH_PORT || 8081;
  app.listen(port, () => {
    logger.info(`Health check endpoints available on port ${port}`);
  });

  return app;
}

/**
 * Example 6: Main Application with Full Integration
 */
export async function main() {
  // Setup components
  const { healthMonitor, connectionPool, datasetManager, queryMetrics } =
    await basicHealthMonitorSetup();

  // Setup MCP server
  const mcpServer = new MCPServerWithHealthMonitoring();

  // Setup HTTP health endpoints for Cloud Run
  setupHTTPHealthEndpoints(healthMonitor);

  // Setup Cloud Monitoring integration
  const cloudMonitoring = new CloudMonitoringIntegration(
    healthMonitor,
    process.env.GCP_PROJECT_ID!
  );

  // Start MCP server
  await mcpServer.start();

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    logger.info('SIGTERM received, shutting down gracefully');
    await mcpServer.shutdown();
    process.exit(0);
  });

  logger.info('Application started with full health monitoring');
}

// Run if executed directly
if (require.main === module) {
  main().catch((error) => {
    logger.error('Application failed to start', { error });
    process.exit(1);
  });
}
