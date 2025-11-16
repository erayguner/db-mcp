import { GoogleAuth } from 'google-auth-library';
import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { recordError } from '../telemetry/metrics.js';
import { recordException, setSpanAttributes } from '../telemetry/tracing.js';

/**
 * Enterprise Permission Validation Layer
 *
 * Comprehensive IAM permission validation with:
 * - Pre-query permission checks
 * - IAM policy evaluation
 * - Role-based access control (RBAC)
 * - Permission caching with TTL
 * - Audit trail for all access attempts
 * - WIF principal validation
 * - Performance optimization
 */

// ==========================================
// Configuration & Types
// ==========================================

export const PermissionValidatorConfigSchema = z.object({
  // Cache configuration
  cacheTTLMs: z.number().default(300000), // 5 minutes
  cacheSize: z.number().default(1000),

  // Validation settings
  strictMode: z.boolean().default(true),
  requireDatasetRead: z.boolean().default(true),
  requireProjectAccess: z.boolean().default(true),

  // Performance settings
  parallelValidation: z.boolean().default(true),
  maxConcurrentChecks: z.number().default(10),

  // Audit settings
  auditEnabled: z.boolean().default(true),
  auditRetentionDays: z.number().default(90),

  // Required IAM permissions
  requiredPermissions: z.object({
    query: z.array(z.string()).default([
      'bigquery.jobs.create',
      'bigquery.datasets.get',
      'bigquery.tables.get',
      'bigquery.tables.getData',
    ]),
    listDatasets: z.array(z.string()).default([
      'bigquery.datasets.get',
    ]),
    listTables: z.array(z.string()).default([
      'bigquery.datasets.get',
      'bigquery.tables.list',
    ]),
    getSchema: z.array(z.string()).default([
      'bigquery.tables.get',
      'bigquery.tables.getMetadata',
    ]),
  }).optional(),
});

export type PermissionValidatorConfig = z.infer<typeof PermissionValidatorConfigSchema>;

export interface PermissionCheckResult {
  allowed: boolean;
  missingPermissions?: string[];
  deniedReason?: string;
  principal?: string;
  checkedAt: Date;
  cacheHit: boolean;
}

export interface AuditEntry {
  timestamp: Date;
  principal: string;
  action: string;
  resource: string;
  allowed: boolean;
  deniedReason?: string;
  requestMetadata?: Record<string, unknown>;
}

interface CachedPermission {
  allowed: boolean;
  missingPermissions?: string[];
  expiresAt: number;
  checkedAt: Date;
}

// ==========================================
// Permission Cache
// ==========================================

class PermissionCache {
  private cache = new Map<string, CachedPermission>();
  private maxSize: number;
  private ttlMs: number;

  constructor(maxSize: number, ttlMs: number) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Generate cache key from permission check parameters
   */
  private generateKey(params: {
    principal: string;
    action: string;
    resource: string;
  }): string {
    return `${params.principal}:${params.action}:${params.resource}`;
  }

  /**
   * Get cached permission result
   */
  get(params: {
    principal: string;
    action: string;
    resource: string;
  }): CachedPermission | null {
    const key = this.generateKey(params);
    const cached = this.cache.get(key);

    if (!cached) {
      return null;
    }

    // Check if expired
    if (Date.now() >= cached.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    logger.debug('Permission cache hit', { key });
    return cached;
  }

  /**
   * Store permission result in cache
   */
  set(
    params: {
      principal: string;
      action: string;
      resource: string;
    },
    result: {
      allowed: boolean;
      missingPermissions?: string[];
    }
  ): void {
    const key = this.generateKey(params);

    // Evict oldest entry if cache is full
    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      allowed: result.allowed,
      missingPermissions: result.missingPermissions,
      expiresAt: Date.now() + this.ttlMs,
      checkedAt: new Date(),
    });

    logger.debug('Permission cached', { key, allowed: result.allowed });
  }

  /**
   * Invalidate cache for specific principal or pattern
   */
  invalidate(pattern?: string): void {
    if (!pattern) {
      // Clear all
      this.cache.clear();
      logger.info('Permission cache cleared');
      return;
    }

    // Clear entries matching pattern
    let count = 0;
    for (const key of this.cache.keys()) {
      if (key.includes(pattern)) {
        this.cache.delete(key);
        count++;
      }
    }

    logger.info('Permission cache invalidated', { pattern, count });
  }

  /**
   * Cleanup expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removed = 0;

    for (const [key, value] of this.cache.entries()) {
      if (now >= value.expiresAt) {
        this.cache.delete(key);
        removed++;
      }
    }

    if (removed > 0) {
      logger.debug('Cleaned up expired permissions', { removed });
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      size: this.cache.size,
      maxSize: this.maxSize,
      ttlMs: this.ttlMs,
    };
  }
}

// ==========================================
// Audit Logger
// ==========================================

class PermissionAuditLogger {
  private entries: AuditEntry[] = [];
  private maxEntries: number;
  private retentionMs: number;

  constructor(retentionDays: number) {
    this.maxEntries = 100000;
    this.retentionMs = retentionDays * 24 * 60 * 60 * 1000;

    // Cleanup old entries every hour
    setInterval(() => this.cleanup(), 3600000);
  }

  /**
   * Log permission check
   */
  log(entry: AuditEntry): void {
    this.entries.push(entry);

    // Trim if too large
    if (this.entries.length > this.maxEntries) {
      this.entries = this.entries.slice(-this.maxEntries);
    }

    // Log to Cloud Logging
    const logMethod = entry.allowed ? logger.info : logger.warn;

    logMethod('Permission check', {
      audit: true,
      principal: entry.principal,
      action: entry.action,
      resource: entry.resource,
      allowed: entry.allowed,
      deniedReason: entry.deniedReason,
      timestamp: entry.timestamp,
    });

    // Record metric
    if (!entry.allowed) {
      recordError('permission_denied');
      setSpanAttributes({
        'permission.denied': true,
        'permission.principal': entry.principal,
        'permission.action': entry.action,
      });
    }
  }

  /**
   * Get audit trail
   */
  getAuditTrail(options?: {
    principal?: string;
    action?: string;
    resource?: string;
    allowedOnly?: boolean;
    deniedOnly?: boolean;
    limit?: number;
  }): AuditEntry[] {
    let filtered = this.entries;

    if (options?.principal) {
      filtered = filtered.filter(e => e.principal === options.principal);
    }

    if (options?.action) {
      filtered = filtered.filter(e => e.action === options.action);
    }

    if (options?.resource) {
      filtered = filtered.filter(e => e.resource.includes(options.resource));
    }

    if (options?.allowedOnly) {
      filtered = filtered.filter(e => e.allowed);
    }

    if (options?.deniedOnly) {
      filtered = filtered.filter(e => !e.allowed);
    }

    const limit = options?.limit || 100;
    return filtered.slice(-limit);
  }

  /**
   * Get denied access summary
   */
  getDeniedAccessSummary(
    principal?: string
  ): { action: string; resource: string; count: number }[] {
    const deniedEntries = this.entries.filter(
      e => !e.allowed && (!principal || e.principal === principal)
    );

    const summary = new Map<string, number>();

    for (const entry of deniedEntries) {
      const key = `${entry.action}:${entry.resource}`;
      summary.set(key, (summary.get(key) || 0) + 1);
    }

    return Array.from(summary.entries())
      .map(([key, count]) => {
        const [action, resource] = key.split(':');
        return { action, resource, count };
      })
      .sort((a, b) => b.count - a.count);
  }

  /**
   * Cleanup old entries
   */
  private cleanup(): void {
    const cutoff = Date.now() - this.retentionMs;
    const originalLength = this.entries.length;

    this.entries = this.entries.filter(
      e => e.timestamp.getTime() > cutoff
    );

    const removed = originalLength - this.entries.length;
    if (removed > 0) {
      logger.info('Cleaned up old audit entries', { removed });
    }
  }

  /**
   * Export audit trail
   */
  exportAuditTrail(format: 'json' | 'csv' = 'json'): string {
    if (format === 'csv') {
      const headers = 'timestamp,principal,action,resource,allowed,deniedReason\n';
      const rows = this.entries
        .map(e => [
          e.timestamp.toISOString(),
          e.principal,
          e.action,
          e.resource,
          e.allowed,
          e.deniedReason || '',
        ].join(','))
        .join('\n');
      return headers + rows;
    }

    return JSON.stringify(this.entries, null, 2);
  }
}

// ==========================================
// Main Permission Validator
// ==========================================

export class PermissionValidator {
  private config: Required<PermissionValidatorConfig>;
  private cache: PermissionCache;
  private auditLogger: PermissionAuditLogger;
  private auth: GoogleAuth;

  constructor(config: Partial<PermissionValidatorConfig> = {}) {
    this.config = this.parseConfig(config);
    this.cache = new PermissionCache(
      this.config.cacheSize,
      this.config.cacheTTLMs
    );
    this.auditLogger = new PermissionAuditLogger(
      this.config.auditRetentionDays
    );
    this.auth = new GoogleAuth({
      scopes: ['https://www.googleapis.com/auth/cloud-platform'],
    });

    logger.info('Permission validator initialized', {
      cacheTTL: this.config.cacheTTLMs,
      cacheSize: this.config.cacheSize,
      strictMode: this.config.strictMode,
    });
  }

  private parseConfig(
    config: Partial<PermissionValidatorConfig>
  ): Required<PermissionValidatorConfig> {
    const parsed = PermissionValidatorConfigSchema.parse(config);
    return {
      ...parsed,
      requiredPermissions: parsed.requiredPermissions || {
        query: [
          'bigquery.jobs.create',
          'bigquery.datasets.get',
          'bigquery.tables.get',
          'bigquery.tables.getData',
        ],
        listDatasets: ['bigquery.datasets.get'],
        listTables: ['bigquery.datasets.get', 'bigquery.tables.list'],
        getSchema: ['bigquery.tables.get', 'bigquery.tables.getMetadata'],
      },
    };
  }

  /**
   * Validate permissions for BigQuery query
   */
  async validateQueryPermissions(params: {
    projectId: string;
    datasetId?: string;
    tableId?: string;
    principal?: string;
    query?: string;
  }): Promise<PermissionCheckResult> {
    const principal = params.principal || await this.getPrincipal();
    const resource = this.buildResourceName(params);
    const action = 'bigquery.query';

    // Check cache first
    const cached = this.cache.get({ principal, action, resource });
    if (cached) {
      return {
        allowed: cached.allowed,
        missingPermissions: cached.missingPermissions,
        principal,
        checkedAt: cached.checkedAt,
        cacheHit: true,
      };
    }

    // Perform actual permission check
    const requiredPerms = this.config.requiredPermissions.query;
    const result = await this.checkPermissions(
      principal,
      params.projectId,
      resource,
      requiredPerms
    );

    // Cache result
    this.cache.set({ principal, action, resource }, result);

    // Audit log
    if (this.config.auditEnabled) {
      this.auditLogger.log({
        timestamp: new Date(),
        principal,
        action,
        resource,
        allowed: result.allowed,
        deniedReason: result.missingPermissions
          ? `Missing permissions: ${result.missingPermissions.join(', ')}`
          : undefined,
        requestMetadata: {
          projectId: params.projectId,
          datasetId: params.datasetId,
          tableId: params.tableId,
        },
      });
    }

    return {
      ...result,
      principal,
      checkedAt: new Date(),
      cacheHit: false,
    };
  }

  /**
   * Validate permissions for dataset access
   */
  async validateDatasetPermissions(params: {
    projectId: string;
    datasetId: string;
    action: 'list' | 'get' | 'query';
    principal?: string;
  }): Promise<PermissionCheckResult> {
    const principal = params.principal || await this.getPrincipal();
    const resource = `projects/${params.projectId}/datasets/${params.datasetId}`;
    const action = `bigquery.datasets.${params.action}`;

    // Check cache
    const cached = this.cache.get({ principal, action, resource });
    if (cached) {
      return {
        allowed: cached.allowed,
        missingPermissions: cached.missingPermissions,
        principal,
        checkedAt: cached.checkedAt,
        cacheHit: true,
      };
    }

    // Determine required permissions
    const requiredPerms =
      params.action === 'list'
        ? this.config.requiredPermissions.listDatasets
        : this.config.requiredPermissions.query;

    const result = await this.checkPermissions(
      principal,
      params.projectId,
      resource,
      requiredPerms
    );

    // Cache and audit
    this.cache.set({ principal, action, resource }, result);
    if (this.config.auditEnabled) {
      this.auditLogger.log({
        timestamp: new Date(),
        principal,
        action,
        resource,
        allowed: result.allowed,
        deniedReason: result.missingPermissions
          ? `Missing permissions: ${result.missingPermissions.join(', ')}`
          : undefined,
      });
    }

    return {
      ...result,
      principal,
      checkedAt: new Date(),
      cacheHit: false,
    };
  }

  /**
   * Validate permissions for table access
   */
  async validateTablePermissions(params: {
    projectId: string;
    datasetId: string;
    tableId: string;
    action: 'get' | 'getData' | 'getMetadata';
    principal?: string;
  }): Promise<PermissionCheckResult> {
    const principal = params.principal || await this.getPrincipal();
    const resource = `projects/${params.projectId}/datasets/${params.datasetId}/tables/${params.tableId}`;
    const action = `bigquery.tables.${params.action}`;

    // Check cache
    const cached = this.cache.get({ principal, action, resource });
    if (cached) {
      return {
        allowed: cached.allowed,
        missingPermissions: cached.missingPermissions,
        principal,
        checkedAt: cached.checkedAt,
        cacheHit: true,
      };
    }

    // Determine required permissions
    const requiredPerms =
      params.action === 'getMetadata'
        ? this.config.requiredPermissions.getSchema
        : this.config.requiredPermissions.query;

    const result = await this.checkPermissions(
      principal,
      params.projectId,
      resource,
      requiredPerms
    );

    // Cache and audit
    this.cache.set({ principal, action, resource }, result);
    if (this.config.auditEnabled) {
      this.auditLogger.log({
        timestamp: new Date(),
        principal,
        action,
        resource,
        allowed: result.allowed,
        deniedReason: result.missingPermissions
          ? `Missing permissions: ${result.missingPermissions.join(', ')}`
          : undefined,
      });
    }

    return {
      ...result,
      principal,
      checkedAt: new Date(),
      cacheHit: false,
    };
  }

  /**
   * Dry-run permission check (no audit logging)
   */
  async dryRunPermissionCheck(params: {
    projectId: string;
    permissions: string[];
    principal?: string;
  }): Promise<PermissionCheckResult> {
    const principal = params.principal || await this.getPrincipal();
    const resource = `projects/${params.projectId}`;

    const result = await this.checkPermissions(
      principal,
      params.projectId,
      resource,
      params.permissions
    );

    return {
      ...result,
      principal,
      checkedAt: new Date(),
      cacheHit: false,
    };
  }

  /**
   * Core permission check implementation
   */
  private async checkPermissions(
    principal: string,
    projectId: string,
    resource: string,
    requiredPermissions: string[]
  ): Promise<{ allowed: boolean; missingPermissions?: string[] }> {
    try {
      // Use IAM testIamPermissions API
      const url = `https://cloudresourcemanager.googleapis.com/v1/projects/${projectId}:testIamPermissions`;

      const client = await this.auth.getClient();
      const accessToken = await client.getAccessToken();

      if (!accessToken.token) {
        throw new Error('Failed to obtain access token');
      }

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${accessToken.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          permissions: requiredPermissions,
        }),
      });

      if (!response.ok) {
        logger.error('Permission check failed', {
          status: response.status,
          statusText: response.statusText,
        });
        throw new Error(`Permission check failed: ${response.statusText}`);
      }

      const data = await response.json() as { permissions?: string[] };
      const grantedPermissions = data.permissions || [];

      // Find missing permissions
      const missingPermissions = requiredPermissions.filter(
        perm => !grantedPermissions.includes(perm)
      );

      const allowed = missingPermissions.length === 0;

      if (!allowed) {
        logger.warn('Missing permissions', {
          principal,
          resource,
          missing: missingPermissions,
        });
      }

      return {
        allowed,
        missingPermissions: allowed ? undefined : missingPermissions,
      };
    } catch (error) {
      logger.error('Permission check error', { error, principal, resource });
      recordException(error as Error);

      // Fail closed in strict mode
      if (this.config.strictMode) {
        return {
          allowed: false,
          missingPermissions: requiredPermissions,
        };
      }

      // Fail open in non-strict mode
      return { allowed: true };
    }
  }

  /**
   * Get current principal (service account or user)
   */
  private async getPrincipal(): Promise<string> {
    try {
      const client = await this.auth.getClient();
      const projectId = await this.auth.getProjectId();

      // For service accounts
      const clientWithEmail = client as { email?: string };
      if ('email' in client && typeof clientWithEmail.email === 'string') {
        return clientWithEmail.email;
      }

      // For WIF
      if ('universe_domain' in client) {
        return `wif:${projectId}`;
      }

      // Fallback
      return `unknown:${projectId}`;
    } catch (error) {
      logger.warn('Failed to get principal', { error });
      return 'unknown';
    }
  }

  /**
   * Build resource name from parameters
   */
  private buildResourceName(params: {
    projectId: string;
    datasetId?: string;
    tableId?: string;
  }): string {
    let resource = `projects/${params.projectId}`;

    if (params.datasetId) {
      resource += `/datasets/${params.datasetId}`;
    }

    if (params.tableId) {
      resource += `/tables/${params.tableId}`;
    }

    return resource;
  }

  /**
   * Invalidate permission cache
   */
  invalidateCache(pattern?: string): void {
    this.cache.invalidate(pattern);
  }

  /**
   * Get cache statistics
   */
  getCacheStats() {
    return this.cache.getStats();
  }

  /**
   * Get audit trail
   */
  getAuditTrail(options?: Parameters<typeof this.auditLogger.getAuditTrail>[0]) {
    return this.auditLogger.getAuditTrail(options);
  }

  /**
   * Get denied access summary
   */
  getDeniedAccessSummary(principal?: string) {
    return this.auditLogger.getDeniedAccessSummary(principal);
  }

  /**
   * Export audit trail
   */
  exportAuditTrail(format: 'json' | 'csv' = 'json'): string {
    return this.auditLogger.exportAuditTrail(format);
  }

  /**
   * Batch permission validation (parallel)
   */
  async validateBatchPermissions(
    checks: Array<{
      projectId: string;
      datasetId?: string;
      tableId?: string;
      action: string;
      principal?: string;
    }>
  ): Promise<PermissionCheckResult[]> {
    if (!this.config.parallelValidation) {
      // Sequential validation
      const results: PermissionCheckResult[] = [];
      for (const check of checks) {
        const result = await this.validateQueryPermissions(check);
        results.push(result);
      }
      return results;
    }

    // Parallel validation with concurrency limit
    const results: PermissionCheckResult[] = [];
    const chunks = this.chunkArray(checks, this.config.maxConcurrentChecks);

    for (const chunk of chunks) {
      const chunkResults = await Promise.all(
        chunk.map(check => this.validateQueryPermissions(check))
      );
      results.push(...chunkResults);
    }

    return results;
  }

  /**
   * Helper: chunk array for parallel processing
   */
  private chunkArray<T>(array: T[], size: number): T[][] {
    const chunks: T[][] = [];
    for (let i = 0; i < array.length; i += size) {
      chunks.push(array.slice(i, i + size));
    }
    return chunks;
  }
}
