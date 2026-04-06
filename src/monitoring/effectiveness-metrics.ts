import { logger } from '../utils/logger.js';

/**
 * Intelligence Effectiveness Metrics
 *
 * Tracks tool call quality and usage patterns to measure
 * how effectively AI agents use the MCP server tools.
 *
 * Metrics include:
 * - First-try success rate
 * - Per-tool success rates and latency (avg, P95)
 * - Retry rate
 * - Exploration efficiency (useful vs total calls)
 * - Peak hours distribution
 * - Average calls per session
 */

// ==========================================
// Types & Interfaces
// ==========================================

export interface ToolCallRecord {
  toolName: string;
  sessionId?: string;
  timestamp: Date;
  success: boolean;
  executionTimeMs: number;
  wasRetry: boolean;
  resultRowCount?: number;
  userSatisfaction?: 'used' | 'ignored' | 'refined';
}

export interface ToolReport {
  toolName: string;
  totalCalls: number;
  successRate: number;
  retryRate: number;
  averageLatencyMs: number;
  p95LatencyMs: number;
  averageRowCount: number;
  satisfactionBreakdown: Record<string, number>;
}

export interface EffectivenessMetrics {
  firstTrySuccessRate: number;
  averageCallsPerSession: number;
  toolSuccessRates: Record<string, number>;
  retryRate: number;
  averageLatencyByTool: Record<string, number>;
  p95LatencyByTool: Record<string, number>;
  explorationEfficiency: number;
  peakHoursDistribution: number[];
}

// ==========================================
// Effectiveness Tracker
// ==========================================

export class EffectivenessTracker {
  private records: ToolCallRecord[] = [];
  private cleanupInterval: ReturnType<typeof setInterval>;

  private static readonly MAX_RECORDS = 10000;
  private static readonly CLEANUP_INTERVAL_MS = 10 * 60 * 1000; // 10 minutes

  constructor() {
    this.cleanupInterval = setInterval(
      () => this.trimRecords(),
      EffectivenessTracker.CLEANUP_INTERVAL_MS,
    );
    this.cleanupInterval.unref();

    logger.info('EffectivenessTracker initialized');
  }

  /**
   * Record a tool call for metrics tracking.
   */
  recordToolCall(record: ToolCallRecord): void {
    this.records.push(record);

    if (this.records.length > EffectivenessTracker.MAX_RECORDS) {
      this.records = this.records.slice(-EffectivenessTracker.MAX_RECORDS);
    }

    logger.debug('Tool call recorded', {
      tool: record.toolName,
      success: record.success,
      latencyMs: record.executionTimeMs,
      wasRetry: record.wasRetry,
    });
  }

  /**
   * Get aggregated effectiveness metrics across all tools and sessions.
   */
  getMetrics(): EffectivenessMetrics {
    if (this.records.length === 0) {
      return this.emptyMetrics();
    }

    // --- First try success rate ---
    const nonRetries = this.records.filter(r => !r.wasRetry);
    const firstTrySuccessRate = nonRetries.length > 0
      ? nonRetries.filter(r => r.success).length / nonRetries.length
      : 0;

    // --- Retry rate ---
    const retryRate = this.records.filter(r => r.wasRetry).length / this.records.length;

    // --- Per-tool aggregations ---
    const toolGroups = this.groupByTool();
    const toolSuccessRates: Record<string, number> = {};
    const averageLatencyByTool: Record<string, number> = {};
    const p95LatencyByTool: Record<string, number> = {};

    for (const [tool, calls] of toolGroups) {
      toolSuccessRates[tool] = calls.filter(r => r.success).length / calls.length;

      const latencies = calls.map(r => r.executionTimeMs).sort((a, b) => a - b);
      averageLatencyByTool[tool] = latencies.reduce((s, v) => s + v, 0) / latencies.length;
      p95LatencyByTool[tool] = this.percentile(latencies, 95);
    }

    // --- Average calls per session ---
    const sessionGroups = this.groupBySession();
    const sessionCounts = Array.from(sessionGroups.values()).map(s => s.length);
    const averageCallsPerSession = sessionCounts.length > 0
      ? sessionCounts.reduce((s, v) => s + v, 0) / sessionCounts.length
      : 0;

    // --- Exploration efficiency ---
    // "Useful" calls: successful, not a retry, and either used or resulted in rows
    const usefulCalls = this.records.filter(
      r => r.success &&
        !r.wasRetry &&
        (r.userSatisfaction === 'used' || r.userSatisfaction === undefined),
    ).length;
    const explorationEfficiency = this.records.length > 0
      ? usefulCalls / this.records.length
      : 0;

    // --- Peak hours distribution ---
    const peakHoursDistribution = new Array<number>(24).fill(0);
    for (const record of this.records) {
      const hour = record.timestamp.getUTCHours();
      peakHoursDistribution[hour]++;
    }

    return {
      firstTrySuccessRate,
      averageCallsPerSession,
      toolSuccessRates,
      retryRate,
      averageLatencyByTool,
      p95LatencyByTool,
      explorationEfficiency,
      peakHoursDistribution,
    };
  }

  /**
   * Get a detailed report for a specific tool.
   */
  getToolReport(toolName: string): ToolReport {
    const calls = this.records.filter(r => r.toolName === toolName);

    if (calls.length === 0) {
      return {
        toolName,
        totalCalls: 0,
        successRate: 0,
        retryRate: 0,
        averageLatencyMs: 0,
        p95LatencyMs: 0,
        averageRowCount: 0,
        satisfactionBreakdown: {},
      };
    }

    const successRate = calls.filter(r => r.success).length / calls.length;
    const retryRate = calls.filter(r => r.wasRetry).length / calls.length;

    const latencies = calls.map(r => r.executionTimeMs).sort((a, b) => a - b);
    const averageLatencyMs = latencies.reduce((s, v) => s + v, 0) / latencies.length;
    const p95LatencyMs = this.percentile(latencies, 95);

    const rowCounts = calls
      .filter(r => r.resultRowCount !== undefined)
      .map(r => r.resultRowCount!);
    const averageRowCount = rowCounts.length > 0
      ? rowCounts.reduce((s, v) => s + v, 0) / rowCounts.length
      : 0;

    const satisfactionBreakdown: Record<string, number> = {};
    for (const call of calls) {
      const key = call.userSatisfaction ?? 'unknown';
      satisfactionBreakdown[key] = (satisfactionBreakdown[key] ?? 0) + 1;
    }

    return {
      toolName,
      totalCalls: calls.length,
      successRate,
      retryRate,
      averageLatencyMs,
      p95LatencyMs,
      averageRowCount,
      satisfactionBreakdown,
    };
  }

  /**
   * Shut down the tracker and clear the cleanup interval.
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    logger.info('EffectivenessTracker destroyed');
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  private groupByTool(): Map<string, ToolCallRecord[]> {
    const groups = new Map<string, ToolCallRecord[]>();
    for (const record of this.records) {
      let group = groups.get(record.toolName);
      if (!group) {
        group = [];
        groups.set(record.toolName, group);
      }
      group.push(record);
    }
    return groups;
  }

  private groupBySession(): Map<string, ToolCallRecord[]> {
    const groups = new Map<string, ToolCallRecord[]>();
    for (const record of this.records) {
      const key = record.sessionId ?? '__no_session__';
      let group = groups.get(key);
      if (!group) {
        group = [];
        groups.set(key, group);
      }
      group.push(record);
    }
    return groups;
  }

  /**
   * Calculate the Nth percentile from a sorted array.
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    if (sorted.length === 1) return sorted[0];

    const index = (p / 100) * (sorted.length - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    if (lower === upper) return sorted[lower];

    const fraction = index - lower;
    return sorted[lower] + fraction * (sorted[upper] - sorted[lower]);
  }

  private trimRecords(): void {
    if (this.records.length > EffectivenessTracker.MAX_RECORDS) {
      const removed = this.records.length - EffectivenessTracker.MAX_RECORDS;
      this.records = this.records.slice(-EffectivenessTracker.MAX_RECORDS);
      logger.info('Trimmed effectiveness records', { removed });
    }
  }

  private emptyMetrics(): EffectivenessMetrics {
    return {
      firstTrySuccessRate: 0,
      averageCallsPerSession: 0,
      toolSuccessRates: {},
      retryRate: 0,
      averageLatencyByTool: {},
      p95LatencyByTool: {},
      explorationEfficiency: 0,
      peakHoursDistribution: new Array<number>(24).fill(0),
    };
  }
}
