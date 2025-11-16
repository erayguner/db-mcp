import { HealthMonitor, HealthStatus } from './health-monitor.js';
import { logger } from '../utils/logger.js';

/**
 * Health Check Endpoints for HTTP/MCP Integration
 *
 * Provides standardized health check endpoints compatible with:
 * - Google Cloud Run health checks
 * - Kubernetes liveness/readiness probes
 * - Load balancer health checks
 * - MCP protocol health reporting
 */

export interface HealthEndpointResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

/**
 * Health Endpoints Manager
 */
export class HealthEndpoints {
  constructor(private healthMonitor: HealthMonitor) {}

  /**
   * Liveness endpoint - Cloud Run compatible
   * Returns 200 if service is alive, 503 if not
   */
  async handleLiveness(): Promise<HealthEndpointResponse> {
    try {
      const result = await this.healthMonitor.checkLiveness();

      if (result.alive) {
        return {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
          body: JSON.stringify({
            status: 'alive',
            timestamp: result.timestamp,
            uptime: result.uptime,
          }),
        };
      }

      return {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        body: JSON.stringify({
          status: 'dead',
          timestamp: result.timestamp,
        }),
      };
    } catch (error) {
      logger.error('Liveness check failed', { error });
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'error', error: String(error) }),
      };
    }
  }

  /**
   * Readiness endpoint - Cloud Run compatible
   * Returns 200 if service is ready, 503 if not
   */
  async handleReadiness(): Promise<HealthEndpointResponse> {
    try {
      const result = await this.healthMonitor.checkReadiness();

      if (result.ready) {
        return {
          status: 200,
          headers: {
            'Content-Type': 'application/json',
            'Cache-Control': 'no-cache, no-store, must-revalidate',
          },
          body: JSON.stringify({
            status: 'ready',
            components: result.components,
            timestamp: result.timestamp,
          }),
        };
      }

      return {
        status: 503,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        body: JSON.stringify({
          status: 'not_ready',
          components: result.components,
          timestamp: result.timestamp,
        }),
      };
    } catch (error) {
      logger.error('Readiness check failed', { error });
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'error', error: String(error) }),
      };
    }
  }

  /**
   * Comprehensive health endpoint
   * Returns detailed health information
   */
  async handleHealth(): Promise<HealthEndpointResponse> {
    try {
      const report = await this.healthMonitor.performHealthCheck();

      const statusCode = this.getStatusCode(report.status);

      return {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        body: JSON.stringify(report, null, 2),
      };
    } catch (error) {
      logger.error('Health check failed', { error });
      return {
        status: 503,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          status: HealthStatus.UNHEALTHY,
          error: String(error),
          timestamp: Date.now(),
        }),
      };
    }
  }

  /**
   * Component-specific health endpoint
   * Returns health information for a specific component
   */
  async handleComponentHealth(componentName: string): Promise<HealthEndpointResponse> {
    try {
      // Perform health check to get latest data
      await this.healthMonitor.performHealthCheck();

      const component = this.healthMonitor.getComponentHealth(componentName);

      if (!component) {
        return {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            error: `Component '${componentName}' not found`,
            availableComponents: await this.getAvailableComponents(),
          }),
        };
      }

      const statusCode = this.getStatusCode(component.status);

      return {
        status: statusCode,
        headers: {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-cache, no-store, must-revalidate',
        },
        body: JSON.stringify(component, null, 2),
      };
    } catch (error) {
      logger.error('Component health check failed', { error, componentName });
      return {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ error: String(error) }),
      };
    }
  }

  /**
   * Get available components
   */
  private async getAvailableComponents(): Promise<string[]> {
    const report = this.healthMonitor.getLastHealthReport();
    if (!report) {
      return [];
    }
    return report.components.map(c => c.name);
  }

  /**
   * Convert health status to HTTP status code
   */
  private getStatusCode(status: HealthStatus): number {
    switch (status) {
      case HealthStatus.HEALTHY:
        return 200;
      case HealthStatus.DEGRADED:
        return 200; // Still accepting requests, but with warnings
      case HealthStatus.UNHEALTHY:
        return 503;
      default:
        return 500;
    }
  }

  /**
   * MCP-compatible health report
   * Returns health information in MCP resource format
   */
  async getMCPHealthResource(): Promise<{
    uri: string;
    name: string;
    description: string;
    mimeType: string;
    text: string;
  }> {
    const report = await this.healthMonitor.performHealthCheck();

    return {
      uri: 'health://system',
      name: 'System Health',
      description: 'Comprehensive system health report',
      mimeType: 'application/json',
      text: JSON.stringify(report, null, 2),
    };
  }

  /**
   * Get health summary for MCP tool response
   */
  async getHealthSummary(): Promise<string> {
    const report = await this.healthMonitor.performHealthCheck();

    const summary = [
      `System Status: ${report.status.toUpperCase()}`,
      `Uptime: ${this.formatUptime(report.uptime)}`,
      `Components: ${report.components.length}`,
      ``,
      'Component Status:',
    ];

    for (const component of report.components) {
      const icon = this.getStatusIcon(component.status);
      const checkCount = Object.keys(component.checks).length;
      summary.push(
        `  ${icon} ${component.name}: ${component.status} (${checkCount} checks)`
      );
    }

    if (report.metrics) {
      summary.push('');
      summary.push('Health Metrics:');
      summary.push(`  Total Checks: ${report.metrics.totalChecks}`);
      summary.push(`  Healthy: ${report.metrics.healthyChecks}`);
      if (report.metrics.degradedChecks > 0) {
        summary.push(`  Degraded: ${report.metrics.degradedChecks}`);
      }
      if (report.metrics.unhealthyChecks > 0) {
        summary.push(`  Unhealthy: ${report.metrics.unhealthyChecks}`);
      }
    }

    return summary.join('\n');
  }

  /**
   * Get status icon for display
   */
  private getStatusIcon(status: HealthStatus): string {
    switch (status) {
      case HealthStatus.HEALTHY:
        return '✓';
      case HealthStatus.DEGRADED:
        return '⚠';
      case HealthStatus.UNHEALTHY:
        return '✗';
      default:
        return '?';
    }
  }

  /**
   * Format uptime for display
   */
  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) {
      return `${days}d ${hours % 24}h ${minutes % 60}m`;
    } else if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    } else if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    } else {
      return `${seconds}s`;
    }
  }
}
