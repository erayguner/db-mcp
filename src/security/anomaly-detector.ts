import { logger } from '../utils/logger.js';

/**
 * Behavioral Anomaly Detection for AI Agent Query Patterns
 *
 * Monitors per-user query behavior and detects anomalies:
 * - Volume spikes (>3x average queries/minute)
 * - New dataset access (first-time dataset usage)
 * - Cost spikes (>10x average bytes processed)
 * - Write attempts (first-time DML/DDL)
 * - Unusual timing (queries outside normal active hours)
 */

// ==========================================
// Types & Interfaces
// ==========================================

export interface QueryPattern {
  userId: string;
  toolName: string;
  timestamp: Date;
  bytesProcessed?: number;
  datasetsAccessed: string[];
  isWrite: boolean;
  executionTimeMs?: number;
}

export interface AnomalyAlert {
  type: 'volume_spike' | 'new_dataset_access' | 'unusual_timing' | 'cost_spike' | 'write_attempt';
  severity: 'low' | 'medium' | 'high' | 'critical';
  userId: string;
  message: string;
  details: Record<string, unknown>;
  timestamp: Date;
}

export interface UserBaseline {
  userId: string;
  queryCount: number;
  datasetsAccessed: Set<string>;
  hasWritten: boolean;
  averageBytesProcessed: number;
  totalBytesProcessed: number;
  bytesQueryCount: number;
  hourHistogram: number[]; // 24 entries, one per hour
  queriesPerMinute: number[]; // rolling minute counts
  lastQueryTimestamp: number;
  createdAt: number;
  updatedAt: number;
}

interface InternalQueryRecord {
  timestamp: number;
  bytesProcessed: number;
  hour: number;
}

// ==========================================
// Behavioral Anomaly Detector
// ==========================================

export class BehavioralAnomalyDetector {
  private baselines: Map<string, UserBaseline> = new Map();
  private queryHistory: Map<string, InternalQueryRecord[]> = new Map();
  private alerts: AnomalyAlert[] = [];
  private cleanupInterval: ReturnType<typeof setInterval>;

  private static readonly MAX_QUERIES_PER_USER = 1000;
  private static readonly MAX_ALERTS = 10000;
  private static readonly STALE_BASELINE_MS = 24 * 60 * 60 * 1000; // 24 hours
  private static readonly CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes
  private static readonly VOLUME_SPIKE_MULTIPLIER = 3;
  private static readonly COST_SPIKE_MULTIPLIER = 10;
  private static readonly MIN_QUERIES_FOR_BASELINE = 5;

  constructor() {
    this.cleanupInterval = setInterval(
      () => this.cleanupStaleBaselines(),
      BehavioralAnomalyDetector.CLEANUP_INTERVAL_MS
    );
    this.cleanupInterval.unref();

    logger.info('BehavioralAnomalyDetector initialized');
  }

  /**
   * Record a query pattern and return any triggered anomaly alerts.
   */
  recordQuery(pattern: QueryPattern): AnomalyAlert[] {
    const now = pattern.timestamp.getTime();
    const hour = pattern.timestamp.getUTCHours();
    const triggered: AnomalyAlert[] = [];

    // Ensure baseline exists
    let baseline = this.baselines.get(pattern.userId);
    if (!baseline) {
      baseline = this.createBaseline(pattern.userId, now);
      this.baselines.set(pattern.userId, baseline);
      this.queryHistory.set(pattern.userId, []);
    }

    const history = this.queryHistory.get(pattern.userId)!;

    // --- Detection: Write Attempt ---
    if (pattern.isWrite && !baseline.hasWritten) {
      const alert = this.createAlert(
        'write_attempt',
        'critical',
        pattern.userId,
        `User ${pattern.userId} attempted a write operation (DML/DDL) for the first time`,
        {
          toolName: pattern.toolName,
          datasetsAccessed: pattern.datasetsAccessed,
        }
      );
      triggered.push(alert);
    }

    // --- Detection: New Dataset Access ---
    for (const dataset of pattern.datasetsAccessed) {
      if (!baseline.datasetsAccessed.has(dataset)) {
        const alert = this.createAlert(
          'new_dataset_access',
          'medium',
          pattern.userId,
          `User ${pattern.userId} accessed dataset "${dataset}" for the first time`,
          {
            dataset,
            previousDatasets: Array.from(baseline.datasetsAccessed),
          }
        );
        triggered.push(alert);
      }
    }

    // Only run statistical detections if we have enough baseline data
    if (baseline.queryCount >= BehavioralAnomalyDetector.MIN_QUERIES_FOR_BASELINE) {
      // --- Detection: Volume Spike ---
      const volumeAlert = this.detectVolumeSpike(pattern.userId, now, baseline, history);
      if (volumeAlert) {
        triggered.push(volumeAlert);
      }

      // --- Detection: Cost Spike ---
      if (pattern.bytesProcessed !== undefined && pattern.bytesProcessed > 0) {
        const costAlert = this.detectCostSpike(pattern.userId, pattern.bytesProcessed, baseline);
        if (costAlert) {
          triggered.push(costAlert);
        }
      }

      // --- Detection: Unusual Timing ---
      const timingAlert = this.detectUnusualTiming(pattern.userId, hour, baseline);
      if (timingAlert) {
        triggered.push(timingAlert);
      }
    }

    // Update baseline
    this.updateBaseline(baseline, pattern, now, hour);

    // Store in history (rolling window)
    history.push({
      timestamp: now,
      bytesProcessed: pattern.bytesProcessed ?? 0,
      hour,
    });
    if (history.length > BehavioralAnomalyDetector.MAX_QUERIES_PER_USER) {
      history.shift();
    }

    // Store alerts
    for (const alert of triggered) {
      this.alerts.push(alert);
    }
    if (this.alerts.length > BehavioralAnomalyDetector.MAX_ALERTS) {
      this.alerts = this.alerts.slice(-BehavioralAnomalyDetector.MAX_ALERTS);
    }

    if (triggered.length > 0) {
      logger.warn('Anomaly alerts triggered', {
        userId: pattern.userId,
        alertCount: triggered.length,
        types: triggered.map((a) => a.type),
      });
    }

    return triggered;
  }

  /**
   * Get the baseline for a specific user.
   */
  getBaseline(userId: string): UserBaseline | undefined {
    return this.baselines.get(userId);
  }

  /**
   * Retrieve stored alerts with optional filtering.
   */
  getAlerts(options?: { userId?: string; severity?: string; limit?: number }): AnomalyAlert[] {
    let filtered = this.alerts;

    if (options?.userId) {
      filtered = filtered.filter((a) => a.userId === options.userId);
    }
    if (options?.severity) {
      filtered = filtered.filter((a) => a.severity === options.severity);
    }

    const limit = options?.limit ?? filtered.length;
    return filtered.slice(-limit);
  }

  /**
   * Get summary statistics.
   */
  getStats(): {
    totalAlerts: number;
    alertsBySeverity: Record<string, number>;
    monitoredUsers: number;
  } {
    const alertsBySeverity: Record<string, number> = {
      low: 0,
      medium: 0,
      high: 0,
      critical: 0,
    };

    for (const alert of this.alerts) {
      alertsBySeverity[alert.severity] = (alertsBySeverity[alert.severity] ?? 0) + 1;
    }

    return {
      totalAlerts: this.alerts.length,
      alertsBySeverity,
      monitoredUsers: this.baselines.size,
    };
  }

  /**
   * Shut down the detector and clear the cleanup interval.
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    logger.info('BehavioralAnomalyDetector destroyed');
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  private createBaseline(userId: string, now: number): UserBaseline {
    return {
      userId,
      queryCount: 0,
      datasetsAccessed: new Set<string>(),
      hasWritten: false,
      averageBytesProcessed: 0,
      totalBytesProcessed: 0,
      bytesQueryCount: 0,
      hourHistogram: new Array<number>(24).fill(0),
      queriesPerMinute: [],
      lastQueryTimestamp: now,
      createdAt: now,
      updatedAt: now,
    };
  }

  private updateBaseline(
    baseline: UserBaseline,
    pattern: QueryPattern,
    now: number,
    hour: number
  ): void {
    baseline.queryCount++;
    baseline.updatedAt = now;
    baseline.lastQueryTimestamp = now;
    baseline.hourHistogram[hour]++;

    if (pattern.isWrite) {
      baseline.hasWritten = true;
    }

    for (const dataset of pattern.datasetsAccessed) {
      baseline.datasetsAccessed.add(dataset);
    }

    if (pattern.bytesProcessed !== undefined && pattern.bytesProcessed > 0) {
      baseline.totalBytesProcessed += pattern.bytesProcessed;
      baseline.bytesQueryCount++;
      baseline.averageBytesProcessed = baseline.totalBytesProcessed / baseline.bytesQueryCount;
    }
  }

  private detectVolumeSpike(
    userId: string,
    now: number,
    _baseline: UserBaseline,
    history: InternalQueryRecord[]
  ): AnomalyAlert | null {
    const oneMinuteAgo = now - 60_000;
    const recentCount = history.filter((q) => q.timestamp >= oneMinuteAgo).length;

    // Calculate average queries per minute based on the time span of the history
    const historySpanMs =
      history.length > 1 ? history[history.length - 1].timestamp - history[0].timestamp : 0;

    if (historySpanMs < 60_000) {
      // Not enough time span to calculate meaningful rate
      return null;
    }

    const historySpanMinutes = historySpanMs / 60_000;
    const avgQueriesPerMinute = history.length / historySpanMinutes;

    if (
      avgQueriesPerMinute > 0 &&
      recentCount > avgQueriesPerMinute * BehavioralAnomalyDetector.VOLUME_SPIKE_MULTIPLIER
    ) {
      return this.createAlert(
        'volume_spike',
        'high',
        userId,
        `User ${userId} query volume spike: ${recentCount} queries/min vs ${avgQueriesPerMinute.toFixed(1)} avg`,
        {
          currentRate: recentCount,
          averageRate: avgQueriesPerMinute,
          multiplier: recentCount / avgQueriesPerMinute,
        }
      );
    }

    return null;
  }

  private detectCostSpike(
    userId: string,
    bytesProcessed: number,
    baseline: UserBaseline
  ): AnomalyAlert | null {
    if (baseline.averageBytesProcessed <= 0) {
      return null;
    }

    const multiplier = bytesProcessed / baseline.averageBytesProcessed;

    if (multiplier > BehavioralAnomalyDetector.COST_SPIKE_MULTIPLIER) {
      return this.createAlert(
        'cost_spike',
        'high',
        userId,
        `User ${userId} cost spike: ${this.formatBytes(bytesProcessed)} processed vs ${this.formatBytes(baseline.averageBytesProcessed)} avg`,
        {
          bytesProcessed,
          averageBytes: baseline.averageBytesProcessed,
          multiplier,
        }
      );
    }

    return null;
  }

  private detectUnusualTiming(
    userId: string,
    hour: number,
    baseline: UserBaseline
  ): AnomalyAlert | null {
    const totalQueries = baseline.hourHistogram.reduce((s, v) => s + v, 0);
    if (totalQueries < BehavioralAnomalyDetector.MIN_QUERIES_FOR_BASELINE) {
      return null;
    }

    // The user has never queried at this hour and has a clear pattern
    const hourFraction = baseline.hourHistogram[hour] / totalQueries;
    const activeHours = baseline.hourHistogram.filter((h) => h > 0).length;

    // If the user has used at least a few distinct hours but never this hour,
    // and they have a concentrated usage pattern (active in <=12 hours)
    if (hourFraction === 0 && activeHours > 0 && activeHours <= 12) {
      return this.createAlert(
        'unusual_timing',
        'low',
        userId,
        `User ${userId} querying at unusual hour (UTC ${hour}:00), no prior activity at this hour`,
        {
          hour,
          activeHours,
          histogram: baseline.hourHistogram,
        }
      );
    }

    return null;
  }

  private createAlert(
    type: AnomalyAlert['type'],
    severity: AnomalyAlert['severity'],
    userId: string,
    message: string,
    details: Record<string, unknown>
  ): AnomalyAlert {
    return {
      type,
      severity,
      userId,
      message,
      details,
      timestamp: new Date(),
    };
  }

  private cleanupStaleBaselines(): void {
    const now = Date.now();
    let removed = 0;

    for (const [userId, baseline] of this.baselines) {
      if (now - baseline.updatedAt > BehavioralAnomalyDetector.STALE_BASELINE_MS) {
        this.baselines.delete(userId);
        this.queryHistory.delete(userId);
        removed++;
      }
    }

    if (removed > 0) {
      logger.info('Cleaned up stale anomaly baselines', { removed });
    }
  }

  private formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes}B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
    if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)}GB`;
  }
}
