import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { recordError } from '../telemetry/metrics.js';
import { setSpanAttributes } from '../telemetry/tracing.js';

/**
 * Enterprise Security Audit Logger
 *
 * Comprehensive audit logging for:
 * - Authentication events
 * - Authorization decisions
 * - Permission checks
 * - Token operations
 * - Security violations
 * - Access patterns
 */

// ==========================================
// Types & Schemas
// ==========================================

export enum AuditEventType {
  // Authentication
  AUTH_SUCCESS = 'auth.success',
  AUTH_FAILURE = 'auth.failure',
  TOKEN_ISSUED = 'auth.token.issued',
  TOKEN_REFRESHED = 'auth.token.refreshed',
  TOKEN_EXPIRED = 'auth.token.expired',
  TOKEN_REVOKED = 'auth.token.revoked',

  // Authorization
  AUTHZ_GRANTED = 'authz.granted',
  AUTHZ_DENIED = 'authz.denied',
  PERMISSION_CHECK = 'authz.permission.check',
  ROLE_CHECK = 'authz.role.check',

  // Access
  RESOURCE_ACCESS = 'access.resource',
  QUERY_EXECUTED = 'access.query.executed',
  DATA_READ = 'access.data.read',
  DATA_WRITE = 'access.data.write',

  // Security Events
  SECURITY_VIOLATION = 'security.violation',
  RATE_LIMIT_EXCEEDED = 'security.rate_limit',
  INVALID_TOKEN = 'security.invalid_token',
  SUSPICIOUS_ACTIVITY = 'security.suspicious',

  // Administrative
  ADMIN_ACTION = 'admin.action',
  CONFIG_CHANGE = 'admin.config.change',
  CACHE_INVALIDATED = 'admin.cache.invalidated',
}

export enum AuditSeverity {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
  CRITICAL = 'critical',
}

export const AuditEventSchema = z.object({
  // Core fields
  timestamp: z.date(),
  eventType: z.nativeEnum(AuditEventType),
  severity: z.nativeEnum(AuditSeverity),

  // Identity
  principal: z.string(), // User/service account
  principalType: z.enum(['user', 'service_account', 'wif', 'compute', 'unknown']).optional(),
  impersonator: z.string().optional(), // For impersonation

  // Action
  action: z.string(), // What was attempted
  resource: z.string().optional(), // Target resource
  outcome: z.enum(['success', 'failure', 'denied']),

  // Context
  projectId: z.string().optional(),
  datasetId: z.string().optional(),
  tableId: z.string().optional(),
  query: z.string().optional(),

  // Security
  ipAddress: z.string().optional(),
  userAgent: z.string().optional(),
  sessionId: z.string().optional(),

  // Details
  message: z.string(),
  metadata: z.record(z.any()).optional(),
  errorDetails: z.string().optional(),

  // Performance
  durationMs: z.number().optional(),
  bytesProcessed: z.number().optional(),
});

export type AuditEvent = z.infer<typeof AuditEventSchema>;

export interface AuditQueryOptions {
  principal?: string;
  eventType?: AuditEventType;
  severity?: AuditSeverity;
  outcome?: 'success' | 'failure' | 'denied';
  startTime?: Date;
  endTime?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditStatistics {
  totalEvents: number;
  eventsByType: Record<string, number>;
  eventsBySeverity: Record<string, number>;
  uniquePrincipals: number;
  authSuccesses: number;
  authFailures: number;
  authzDenials: number;
  securityViolations: number;
  timeRange: {
    earliest?: Date;
    latest?: Date;
  };
}

// ==========================================
// Audit Event Store
// ==========================================

class AuditEventStore {
  private events: AuditEvent[] = [];
  private maxEvents: number;
  private retentionMs: number;

  constructor(maxEvents: number = 100000, retentionDays: number = 90) {
    this.maxEvents = maxEvents;
    this.retentionMs = retentionDays * 24 * 60 * 60 * 1000;

    // Cleanup old events every hour
    setInterval(() => this.cleanup(), 3600000);

    logger.info('Audit event store initialized', {
      maxEvents,
      retentionDays,
    });
  }

  /**
   * Store audit event
   */
  store(event: AuditEvent): void {
    // Validate event
    const validated = AuditEventSchema.parse(event);

    // Add to store
    this.events.push(validated);

    // Trim if too large
    if (this.events.length > this.maxEvents) {
      const excess = this.events.length - this.maxEvents;
      this.events = this.events.slice(excess);
      logger.warn('Audit store trimmed', { eventsRemoved: excess });
    }
  }

  /**
   * Query audit events
   */
  query(options: AuditQueryOptions = {}): AuditEvent[] {
    let results = [...this.events];

    // Filter by principal
    if (options.principal) {
      results = results.filter(e => e.principal === options.principal);
    }

    // Filter by event type
    if (options.eventType) {
      results = results.filter(e => e.eventType === options.eventType);
    }

    // Filter by severity
    if (options.severity) {
      results = results.filter(e => e.severity === options.severity);
    }

    // Filter by outcome
    if (options.outcome) {
      results = results.filter(e => e.outcome === options.outcome);
    }

    // Filter by time range
    if (options.startTime) {
      results = results.filter(e => e.timestamp >= options.startTime!);
    }
    if (options.endTime) {
      results = results.filter(e => e.timestamp <= options.endTime!);
    }

    // Sort by timestamp (newest first)
    results.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());

    // Apply pagination
    const offset = options.offset || 0;
    const limit = options.limit || 100;
    return results.slice(offset, offset + limit);
  }

  /**
   * Get statistics
   */
  getStatistics(): AuditStatistics {
    const eventsByType: Record<string, number> = {};
    const eventsBySeverity: Record<string, number> = {};
    const principals = new Set<string>();

    let authSuccesses = 0;
    let authFailures = 0;
    let authzDenials = 0;
    let securityViolations = 0;
    let earliest: Date | undefined;
    let latest: Date | undefined;

    for (const event of this.events) {
      // Count by type
      eventsByType[event.eventType] = (eventsByType[event.eventType] || 0) + 1;

      // Count by severity
      eventsBySeverity[event.severity] = (eventsBySeverity[event.severity] || 0) + 1;

      // Track principals
      principals.add(event.principal);

      // Count specific events
      if (event.eventType === AuditEventType.AUTH_SUCCESS) {
        authSuccesses++;
      } else if (event.eventType === AuditEventType.AUTH_FAILURE) {
        authFailures++;
      } else if (event.eventType === AuditEventType.AUTHZ_DENIED) {
        authzDenials++;
      } else if (event.eventType === AuditEventType.SECURITY_VIOLATION) {
        securityViolations++;
      }

      // Track time range
      if (!earliest || event.timestamp < earliest) {
        earliest = event.timestamp;
      }
      if (!latest || event.timestamp > latest) {
        latest = event.timestamp;
      }
    }

    return {
      totalEvents: this.events.length,
      eventsByType,
      eventsBySeverity,
      uniquePrincipals: principals.size,
      authSuccesses,
      authFailures,
      authzDenials,
      securityViolations,
      timeRange: { earliest, latest },
    };
  }

  /**
   * Export events
   */
  export(format: 'json' | 'csv' = 'json'): string {
    if (format === 'csv') {
      return this.exportCsv();
    }
    return JSON.stringify(this.events, null, 2);
  }

  /**
   * Export as CSV
   */
  private exportCsv(): string {
    const headers = [
      'timestamp',
      'eventType',
      'severity',
      'principal',
      'action',
      'resource',
      'outcome',
      'message',
      'errorDetails',
    ].join(',');

    const rows = this.events.map(e => [
      e.timestamp.toISOString(),
      e.eventType,
      e.severity,
      e.principal,
      e.action,
      e.resource || '',
      e.outcome,
      JSON.stringify(e.message),
      e.errorDetails || '',
    ].join(','));

    return headers + '\n' + rows.join('\n');
  }

  /**
   * Cleanup old events
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.retentionMs;
    const originalLength = this.events.length;

    this.events = this.events.filter(
      e => e.timestamp.getTime() > cutoff
    );

    const removed = originalLength - this.events.length;
    if (removed > 0) {
      logger.info('Cleaned up old audit events', { removed });
    }
  }

  /**
   * Clear all events
   */
  clear(): void {
    const count = this.events.length;
    this.events = [];
    logger.info('Audit store cleared', { eventsRemoved: count });
  }
}

// ==========================================
// Main Audit Logger
// ==========================================

export class SecurityAuditLogger {
  private store: AuditEventStore;
  private enableCloudLogging: boolean;

  constructor(options: {
    maxEvents?: number;
    retentionDays?: number;
    enableCloudLogging?: boolean;
  } = {}) {
    this.store = new AuditEventStore(
      options.maxEvents,
      options.retentionDays
    );
    this.enableCloudLogging = options.enableCloudLogging ?? true;

    logger.info('Security audit logger initialized', {
      enableCloudLogging: this.enableCloudLogging,
    });
  }

  /**
   * Log audit event
   */
  log(event: Omit<AuditEvent, 'timestamp'>): void {
    const fullEvent: AuditEvent = {
      ...event,
      timestamp: new Date(),
    };

    // Store in memory
    this.store.store(fullEvent);

    // Log to Cloud Logging
    if (this.enableCloudLogging) {
      this.logToCloud(fullEvent);
    }

    // Record metrics
    this.recordMetrics(fullEvent);

    // Set trace attributes
    this.setTraceAttributes(fullEvent);
  }

  /**
   * Log authentication success
   */
  logAuthSuccess(params: {
    principal: string;
    principalType?: AuditEvent['principalType'];
    action: string;
    metadata?: Record<string, any>;
  }): void {
    this.log({
      eventType: AuditEventType.AUTH_SUCCESS,
      severity: AuditSeverity.INFO,
      principal: params.principal,
      principalType: params.principalType,
      action: params.action,
      outcome: 'success',
      message: `Authentication successful for ${params.principal}`,
      metadata: params.metadata,
    });
  }

  /**
   * Log authentication failure
   */
  logAuthFailure(params: {
    principal: string;
    action: string;
    errorDetails: string;
    metadata?: Record<string, any>;
  }): void {
    this.log({
      eventType: AuditEventType.AUTH_FAILURE,
      severity: AuditSeverity.WARNING,
      principal: params.principal,
      action: params.action,
      outcome: 'failure',
      message: `Authentication failed for ${params.principal}`,
      errorDetails: params.errorDetails,
      metadata: params.metadata,
    });
  }

  /**
   * Log authorization denial
   */
  logAuthzDenial(params: {
    principal: string;
    action: string;
    resource: string;
    reason: string;
    metadata?: Record<string, any>;
  }): void {
    this.log({
      eventType: AuditEventType.AUTHZ_DENIED,
      severity: AuditSeverity.WARNING,
      principal: params.principal,
      action: params.action,
      resource: params.resource,
      outcome: 'denied',
      message: `Authorization denied: ${params.reason}`,
      metadata: params.metadata,
    });
  }

  /**
   * Log security violation
   */
  logSecurityViolation(params: {
    principal: string;
    action: string;
    severity: AuditSeverity;
    message: string;
    metadata?: Record<string, any>;
  }): void {
    this.log({
      eventType: AuditEventType.SECURITY_VIOLATION,
      severity: params.severity,
      principal: params.principal,
      action: params.action,
      outcome: 'failure',
      message: params.message,
      metadata: params.metadata,
    });
  }

  /**
   * Log token operation
   */
  logTokenOperation(params: {
    eventType: AuditEventType;
    principal: string;
    action: string;
    metadata?: Record<string, any>;
  }): void {
    this.log({
      eventType: params.eventType,
      severity: AuditSeverity.INFO,
      principal: params.principal,
      action: params.action,
      outcome: 'success',
      message: `Token operation: ${params.action}`,
      metadata: params.metadata,
    });
  }

  /**
   * Query audit trail
   */
  query(options: AuditQueryOptions = {}): AuditEvent[] {
    return this.store.query(options);
  }

  /**
   * Get statistics
   */
  getStatistics(): AuditStatistics {
    return this.store.getStatistics();
  }

  /**
   * Export audit trail
   */
  export(format: 'json' | 'csv' = 'json'): string {
    return this.store.export(format);
  }

  /**
   * Clear audit trail
   */
  clear(): void {
    this.store.clear();
  }

  /**
   * Log to Google Cloud Logging
   */
  private logToCloud(event: AuditEvent): void {
    const logLevel = this.severityToLogLevel(event.severity);
    const logData = {
      audit: true,
      eventType: event.eventType,
      principal: event.principal,
      action: event.action,
      resource: event.resource,
      outcome: event.outcome,
      ...event.metadata,
    };

    logger.log(logLevel, event.message, logData);
  }

  /**
   * Record metrics for audit event
   */
  private recordMetrics(event: AuditEvent): void {
    // Record failures and violations
    if (event.outcome === 'failure' || event.outcome === 'denied') {
      recordError(`audit_${event.eventType}`);
    }

    // Record security violations specifically
    if (event.eventType === AuditEventType.SECURITY_VIOLATION) {
      recordError('security_violation');
    }
  }

  /**
   * Set trace attributes
   */
  private setTraceAttributes(event: AuditEvent): void {
    setSpanAttributes({
      'audit.event_type': event.eventType,
      'audit.principal': event.principal,
      'audit.outcome': event.outcome,
      'audit.severity': event.severity,
    });
  }

  /**
   * Convert severity to log level
   */
  private severityToLogLevel(severity: AuditSeverity): string {
    switch (severity) {
      case AuditSeverity.DEBUG: return 'debug';
      case AuditSeverity.INFO: return 'info';
      case AuditSeverity.WARNING: return 'warn';
      case AuditSeverity.ERROR: return 'error';
      case AuditSeverity.CRITICAL: return 'error';
      default: return 'info';
    }
  }
}

// Export singleton instance
let auditLoggerInstance: SecurityAuditLogger | null = null;

export function getAuditLogger(options?: ConstructorParameters<typeof SecurityAuditLogger>[0]): SecurityAuditLogger {
  if (!auditLoggerInstance) {
    auditLoggerInstance = new SecurityAuditLogger(options);
  }
  return auditLoggerInstance;
}
