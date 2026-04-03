import { z } from 'zod';
import { EventEmitter } from 'events';
import { BigQueryClient, BigQueryClientInputConfig, QueryResult } from './client.js';
import { ConnectionPool } from './connection-pool.js';
import { DatasetManager, DatasetMetadata } from './dataset-manager.js';

/**
 * Zod Schemas for Multi-Project Manager
 */
export const ProjectConfigSchema = z.object({
  projectId: z.string().min(1),
  displayName: z.string().optional(),
  keyFilename: z.string().optional(),
  credentials: z.record(z.unknown()).optional(),
  location: z.string().optional(),
  labels: z.record(z.string()).optional(),
  priority: z.enum(['high', 'medium', 'low']).default('medium'),
  enabled: z.boolean().default(true),
  quotas: z.object({
    maxQueriesPerDay: z.number().optional(),
    maxBytesProcessedPerDay: z.string().optional(),
    maxConcurrentQueries: z.number().optional(),
  }).optional(),
});

export const MultiProjectManagerConfigSchema = z.object({
  projects: z.array(ProjectConfigSchema).min(1),
  defaultProjectId: z.string().optional(),
  autoDiscovery: z.boolean().default(true),
  discoveryIntervalMs: z.number().min(60000).default(300000),
  connectionPool: z.object({
    minConnectionsPerProject: z.number().min(1).default(2),
    maxConnectionsPerProject: z.number().min(1).default(10),
    acquireTimeoutMs: z.number().min(100).default(30000),
    idleTimeoutMs: z.number().min(1000).default(300000),
  }).optional(),
  datasetManager: z.object({
    cacheSize: z.number().min(10).default(100),
    cacheTTLMs: z.number().min(1000).default(3600000),
  }).optional(),
  crossProjectQueries: z.object({
    enabled: z.boolean().default(true),
    maxProjects: z.number().min(1).default(5),
  }).optional(),
  permissionValidation: z.object({
    enabled: z.boolean().default(true),
    cacheValidationResults: z.boolean().default(true),
    validationTTLMs: z.number().min(60000).default(300000),
  }).optional(),
});

export type ProjectConfig = z.infer<typeof ProjectConfigSchema>;
export type MultiProjectManagerConfig = z.infer<typeof MultiProjectManagerConfigSchema>;

/**
 * Type Definitions for BigQuery Operations
 */

/**
 * Credentials for BigQuery authentication
 */
export interface ProjectConfigCredentials {
  client_email?: string;
  private_key?: string;
  project_id?: string;
  [key: string]: unknown;
}

/**
 * Query execution metrics and metadata
 */
export interface QueryMetrics {
  totalBytesProcessed?: string | number;
  totalBytesBilled?: string | number;
  cacheHit?: boolean;
  queryId?: string;
  jobId?: string;
  location?: string;
  [key: string]: unknown;
}

/**
 * Cross-project query result
 */
export interface CrossProjectQueryResult<T = unknown> {
  projectId: string;
  result: QueryResult<T> | null;
  error: Error | null;
}

/**
 * Project metrics data
 */
export interface ProjectMetricsData {
  accessCount: number;
  lastAccessed: Date;
  quota?: QuotaUsage;
  poolMetrics: {
    totalConnections: number;
    activeConnections: number;
    idleConnections: number;
    waitingRequests: number;
  };
  cacheStats: {
    datasets: {
      size: number;
      maxSize: number;
      hitRate: number;
    };
    tables: {
      size: number;
      maxSize: number;
      hitRate: number;
    };
    lruQueue: number;
  };
}

/**
 * Aggregated metrics response
 */
export interface AggregatedMetrics {
  totalProjects: number;
  enabledProjects: number;
  totalQueries: number;
  totalBytesProcessed: string;
  avgQueriesPerProject: number;
  projectMetrics: Map<string, ProjectMetricsData>;
}

/**
 * Project Context and Metadata
 */
export interface ProjectContext {
  projectId: string;
  displayName?: string;
  location?: string;
  labels?: Record<string, string>;
  priority: 'high' | 'medium' | 'low';
  enabled: boolean;
  client: BigQueryClient;
  connectionPool: ConnectionPool;
  datasetManager: DatasetManager;
  createdAt: Date;
  lastAccessedAt: Date;
  accessCount: number;
  quotaUsage?: QuotaUsage;
}

export interface QuotaUsage {
  queriesExecuted: number;
  bytesProcessed: string;
  concurrentQueries: number;
  lastResetAt: Date;
  limits?: {
    maxQueriesPerDay?: number;
    maxBytesProcessedPerDay?: string;
    maxConcurrentQueries?: number;
  };
}

export interface PermissionValidationResult {
  hasAccess: boolean;
  permissions: string[];
  missingPermissions?: string[];
  validatedAt: Date;
  expiresAt: Date;
}

export interface CrossProjectQueryOptions {
  projectIds: string[];
  datasetMappings?: Map<string, string>; // projectId -> datasetId
  allowPartialResults?: boolean;
}

export interface ProjectDiscoveryResult {
  projectId: string;
  accessible: boolean;
  datasets: DatasetMetadata[];
  permissions: string[];
  quotas?: QuotaUsage;
  error?: Error;
}

/**
 * Multi-Project Manager Error Classes
 */
export class MultiProjectManagerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly projectId?: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'MultiProjectManagerError';
  }
}

export class ProjectNotFoundError extends MultiProjectManagerError {
  constructor(projectId: string) {
    super(
      `Project not found: ${projectId}`,
      'PROJECT_NOT_FOUND',
      projectId
    );
  }
}

export class PermissionDeniedError extends MultiProjectManagerError {
  constructor(projectId: string, operation: string, missingPermissions?: string[]) {
    super(
      `Permission denied for operation '${operation}' on project ${projectId}`,
      'PERMISSION_DENIED',
      projectId,
      { operation, missingPermissions }
    );
  }
}

export class QuotaExceededError extends MultiProjectManagerError {
  constructor(projectId: string, quotaType: string, current: number, limit: number) {
    super(
      `Quota exceeded for ${quotaType} on project ${projectId}: ${current}/${limit}`,
      'QUOTA_EXCEEDED',
      projectId,
      { quotaType, current, limit }
    );
  }
}

/**
 * Enterprise Multi-Project Dataset Connection Manager
 *
 * Manages concurrent connections to multiple GCP BigQuery projects with:
 * - Automatic project discovery and enumeration
 * - Cross-project dataset access management
 * - Project-specific permission validation
 * - Resource quota tracking per project
 * - Project context switching
 * - Comprehensive error handling
 */
export class MultiProjectManager extends EventEmitter {
  private config: Required<MultiProjectManagerConfig>;
  private projects: Map<string, ProjectContext> = new Map();
  private currentProjectId?: string;
  private discoveryInterval?: NodeJS.Timeout;
  private isShuttingDown = false;

  // Permission validation cache
  private permissionCache: Map<string, PermissionValidationResult> = new Map();

  // Quota tracking
  private quotaResetInterval?: NodeJS.Timeout;

  constructor(config: MultiProjectManagerConfig) {
    super();
    this.config = this.parseAndValidateConfig(config);
    void this.initialize();
  }

  /**
   * Parse and validate configuration
   */
  private parseAndValidateConfig(config: MultiProjectManagerConfig): Required<MultiProjectManagerConfig> {
    const parsed = MultiProjectManagerConfigSchema.parse(config);

    return {
      projects: parsed.projects,
      defaultProjectId: parsed.defaultProjectId || parsed.projects[0].projectId,
      autoDiscovery: parsed.autoDiscovery,
      discoveryIntervalMs: parsed.discoveryIntervalMs,
      connectionPool: parsed.connectionPool || {
        minConnectionsPerProject: 2,
        maxConnectionsPerProject: 10,
        acquireTimeoutMs: 30000,
        idleTimeoutMs: 300000,
      },
      datasetManager: parsed.datasetManager || {
        cacheSize: 100,
        cacheTTLMs: 3600000,
      },
      crossProjectQueries: parsed.crossProjectQueries || {
        enabled: true,
        maxProjects: 5,
      },
      permissionValidation: parsed.permissionValidation || {
        enabled: true,
        cacheValidationResults: true,
        validationTTLMs: 300000,
      },
    };
  }

  /**
   * Initialize all configured projects
   */
  private initialize(): void {
    try {
      this.emit('initialization:started', {
        projectCount: this.config.projects.length,
      });

      // Initialize projects
      let successCount = 0;
      let failureCount = 0;

      this.config.projects.forEach((projectConfig, index) => {
        try {
          this.initializeProject(projectConfig);
          successCount++;
        } catch (err) {
          failureCount++;
          const projectId = this.config.projects[index].projectId;
          this.emit('project:initialization:failed', {
            projectId,
            error: err instanceof Error ? err : new Error(String(err)),
          });
        }
      });

      // Set default project
      if (this.config.defaultProjectId) {
        this.currentProjectId = this.config.defaultProjectId;
      }

      // Start auto-discovery if enabled
      if (this.config.autoDiscovery) {
        this.startAutoDiscovery();
      }

      // Start quota reset interval (daily)
      this.startQuotaResetInterval();

      this.emit('initialization:completed', {
        successCount,
        failureCount,
        totalProjects: this.config.projects.length,
      });
    } catch (error) {
      this.emit('initialization:error', error);
      throw new MultiProjectManagerError(
        'Failed to initialize multi-project manager',
        'INITIALIZATION_ERROR',
        undefined,
        error
      );
    }
  }

  /**
   * Initialize a single project
   */
  private initializeProject(projectConfig: ProjectConfig): void {
    const { projectId } = projectConfig;

    try {
      // Create BigQuery client for this project
      const clientConfig: BigQueryClientInputConfig = {
        projectId,
        keyFilename: projectConfig.keyFilename,
        credentials: projectConfig.credentials,
        connectionPool: {
          minConnections: this.config.connectionPool.minConnectionsPerProject,
          maxConnections: this.config.connectionPool.maxConnectionsPerProject,
          acquireTimeoutMs: this.config.connectionPool.acquireTimeoutMs,
          idleTimeoutMs: this.config.connectionPool.idleTimeoutMs,
          healthCheckIntervalMs: 60000,
          maxRetries: 3,
          retryDelayMs: 1000,
        },
        datasetManager: {
          cacheSize: this.config.datasetManager.cacheSize,
          cacheTTLMs: this.config.datasetManager.cacheTTLMs,
          autoDiscovery: true,
          discoveryIntervalMs: 300000,
        },
      };

      const client = new BigQueryClient(clientConfig);

      // Create dedicated connection pool
      const connectionPool = new ConnectionPool({
        ...this.config.connectionPool,
        projectId,
        keyFilename: projectConfig.keyFilename,
        credentials: projectConfig.credentials,
        minConnections: this.config.connectionPool.minConnectionsPerProject,
        maxConnections: this.config.connectionPool.maxConnectionsPerProject,
        acquireTimeoutMs: this.config.connectionPool.acquireTimeoutMs,
        idleTimeoutMs: this.config.connectionPool.idleTimeoutMs,
        healthCheckIntervalMs: 60000,
        maxRetries: 3,
        retryDelayMs: 1000,
      });

      // Create dataset manager
      const datasetManager = new DatasetManager({
        ...this.config.datasetManager,
        projectId,
        autoDiscovery: true,
        discoveryIntervalMs: this.config.discoveryIntervalMs,
      });

      // Create project context
      const context: ProjectContext = {
        projectId,
        displayName: projectConfig.displayName,
        location: projectConfig.location,
        labels: projectConfig.labels,
        priority: projectConfig.priority,
        enabled: projectConfig.enabled,
        client,
        connectionPool,
        datasetManager,
        createdAt: new Date(),
        lastAccessedAt: new Date(),
        accessCount: 0,
        quotaUsage: {
          queriesExecuted: 0,
          bytesProcessed: '0',
          concurrentQueries: 0,
          lastResetAt: new Date(),
          limits: projectConfig.quotas,
        },
      };

      // Setup event forwarding
      this.setupProjectEventHandlers(context);

      // Store project context
      this.projects.set(projectId, context);

      this.emit('project:initialized', { projectId });
    } catch (error) {
      throw new MultiProjectManagerError(
        `Failed to initialize project ${projectId}`,
        'PROJECT_INIT_ERROR',
        projectId,
        error
      );
    }
  }

  /**
   * Setup event handlers for project context
   */
  private setupProjectEventHandlers(context: ProjectContext): void {
    const { projectId, client } = context;

    // Forward client events with project context
    client.on('query:started', (data: unknown) => {
      this.emit('project:query:started', { projectId, ...(data as Record<string, unknown>) });
    });

    client.on('query:completed', (data: unknown) => {
      this.updateQuotaUsage(projectId, data as QueryMetrics);
      this.emit('project:query:completed', { projectId, ...(data as Record<string, unknown>) });
    });

    client.on('error', (error: Error) => {
      this.emit('project:error', { projectId, error });
    });
  }

  /**
   * Discover all accessible projects
   */
  public async discoverProjects(): Promise<ProjectDiscoveryResult[]> {
    this.emit('discovery:started');

    const discoveries = await Promise.allSettled(
      Array.from(this.projects.values()).map(context =>
        this.discoverProject(context)
      )
    );

    const results: ProjectDiscoveryResult[] = discoveries.map((result, index) => {
      const projectId = Array.from(this.projects.keys())[index];

      if (result.status === 'fulfilled') {
        return result.value;
      } else {
        return {
          projectId,
          accessible: false,
          datasets: [],
          permissions: [],
          error: result.reason instanceof Error ? result.reason : new Error(String(result.reason)),
        };
      }
    });

    this.emit('discovery:completed', {
      total: results.length,
      accessible: results.filter(r => r.accessible).length,
    });

    return results;
  }

  /**
   * Discover single project metadata
   */
  private async discoverProject(context: ProjectContext): Promise<ProjectDiscoveryResult> {
    const { projectId, client } = context;

    try {
      // List all datasets
      const datasets = await client.listDatasets(projectId);

      // Check permissions
      const permissions = await this.getProjectPermissions(projectId);

      // Get quota information
      const quotas = context.quotaUsage;

      return {
        projectId,
        accessible: true,
        datasets,
        permissions,
        quotas,
      };
    } catch (error) {
      return {
        projectId,
        accessible: false,
        datasets: [],
        permissions: [],
        error: error as Error,
      };
    }
  }

  /**
   * Get permissions for a project
   */
  private async getProjectPermissions(projectId: string): Promise<string[]> {
    if (!this.config.permissionValidation.enabled) {
      return [];
    }

    // Check cache
    const cacheKey = `permissions:${projectId}`;
    const cached = this.permissionCache.get(cacheKey);

    if (cached && new Date() < cached.expiresAt) {
      this.emit('permission:cache:hit', { projectId });
      return cached.permissions;
    }

    // Fetch from BigQuery (simplified - in production use IAM API)
    try {
      const context = this.getProjectContext(projectId);
      const client = await context.connectionPool.acquire();

      // Test basic permissions with dry run
      await client.createQueryJob({
        query: 'SELECT 1',
        dryRun: true,
      });

      const permissions = [
        'bigquery.jobs.create',
        'bigquery.datasets.get',
        'bigquery.tables.list',
      ];

      // Cache results
      if (this.config.permissionValidation.cacheValidationResults) {
        const result: PermissionValidationResult = {
          hasAccess: true,
          permissions,
          validatedAt: new Date(),
          expiresAt: new Date(Date.now() + this.config.permissionValidation.validationTTLMs),
        };
        this.permissionCache.set(cacheKey, result);
      }

      context.connectionPool.release(client);
      return permissions;
    } catch (error) {
      this.emit('permission:check:failed', { projectId, error });
      return [];
    }
  }

  /**
   * Validate permissions for specific operation
   */
  public async validatePermission(
    projectId: string,
    operation: string,
    requiredPermissions: string[]
  ): Promise<PermissionValidationResult> {
    if (!this.config.permissionValidation.enabled) {
      return {
        hasAccess: true,
        permissions: requiredPermissions,
        validatedAt: new Date(),
        expiresAt: new Date(Date.now() + this.config.permissionValidation.validationTTLMs),
      };
    }

    const projectPermissions = await this.getProjectPermissions(projectId);
    const missingPermissions = requiredPermissions.filter(
      perm => !projectPermissions.includes(perm)
    );

    const hasAccess = missingPermissions.length === 0;

    if (!hasAccess) {
      throw new PermissionDeniedError(projectId, operation, missingPermissions);
    }

    return {
      hasAccess,
      permissions: projectPermissions,
      validatedAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.permissionValidation.validationTTLMs),
    };
  }

  /**
   * Switch current project context
   */
  public switchProject(projectId: string): void {
    if (!this.projects.has(projectId)) {
      throw new ProjectNotFoundError(projectId);
    }

    const previousProject = this.currentProjectId;
    this.currentProjectId = projectId;

    const context = this.projects.get(projectId)!;
    context.lastAccessedAt = new Date();
    context.accessCount++;

    this.emit('project:switched', {
      from: previousProject,
      to: projectId,
    });
  }

  /**
   * Get current project context
   */
  public getCurrentProject(): ProjectContext {
    if (!this.currentProjectId) {
      throw new MultiProjectManagerError(
        'No current project set',
        'NO_CURRENT_PROJECT'
      );
    }

    return this.getProjectContext(this.currentProjectId);
  }

  /**
   * Get specific project context
   */
  public getProjectContext(projectId: string): ProjectContext {
    const context = this.projects.get(projectId);

    if (!context) {
      throw new ProjectNotFoundError(projectId);
    }

    if (!context.enabled) {
      throw new MultiProjectManagerError(
        `Project ${projectId} is disabled`,
        'PROJECT_DISABLED',
        projectId
      );
    }

    return context;
  }

  /**
   * List all managed projects
   */
  public listProjects(filters?: {
    enabled?: boolean;
    priority?: 'high' | 'medium' | 'low';
    hasLabel?: Record<string, string>;
  }): ProjectContext[] {
    let projects = Array.from(this.projects.values());

    if (filters) {
      if (filters.enabled !== undefined) {
        projects = projects.filter(p => p.enabled === filters.enabled);
      }

      if (filters.priority) {
        projects = projects.filter(p => p.priority === filters.priority);
      }

      if (filters.hasLabel) {
        projects = projects.filter(p => {
          if (!p.labels) return false;
          return Object.entries(filters.hasLabel!).every(
            ([key, value]) => p.labels![key] === value
          );
        });
      }
    }

    return projects;
  }

  /**
   * Execute cross-project query
   */
  public async executeCrossProjectQuery<T = unknown>(
    query: string,
    options: CrossProjectQueryOptions
  ): Promise<Map<string, CrossProjectQueryResult<T>>> {
    if (!this.config.crossProjectQueries.enabled) {
      throw new MultiProjectManagerError(
        'Cross-project queries are disabled',
        'CROSS_PROJECT_DISABLED'
      );
    }

    if (options.projectIds.length > this.config.crossProjectQueries.maxProjects) {
      throw new MultiProjectManagerError(
        `Cannot query more than ${this.config.crossProjectQueries.maxProjects} projects simultaneously`,
        'TOO_MANY_PROJECTS'
      );
    }

    this.emit('cross-project:query:started', {
      projectIds: options.projectIds,
      query,
    });

    // Execute queries in parallel across projects
    const queryPromises = options.projectIds.map(async (projectId) => {
      try {
        const context = this.getProjectContext(projectId);
        const result = await context.client.query<T>({
          query,
          location: context.location,
        });

        return { projectId, result, error: null };
      } catch (error) {
        if (options.allowPartialResults) {
          return {
            projectId,
            result: null,
            error: error instanceof Error ? error : new Error(String(error))
          };
        }
        throw error;
      }
    });

    const results = await Promise.allSettled(queryPromises);
    const resultMap = new Map<string, CrossProjectQueryResult<T>>();

    results.forEach((result, index) => {
      const projectId = options.projectIds[index];

      if (result.status === 'fulfilled') {
        resultMap.set(projectId, result.value);
      } else {
        resultMap.set(projectId, {
          projectId,
          result: null,
          error: result.reason instanceof Error ? result.reason : new Error(String(result.reason))
        });
      }
    });

    this.emit('cross-project:query:completed', {
      projectIds: options.projectIds,
      successCount: Array.from(resultMap.values()).filter(r => !r.error).length,
    });

    return resultMap;
  }

  /**
   * Update quota usage for project
   */
  private updateQuotaUsage(projectId: string, queryData: QueryMetrics): void {
    const context = this.projects.get(projectId);
    if (!context || !context.quotaUsage) return;

    const quota = context.quotaUsage;
    quota.queriesExecuted++;

    if (queryData.totalBytesProcessed) {
      const currentBytes = BigInt(quota.bytesProcessed);
      const newBytes = BigInt(queryData.totalBytesProcessed);
      quota.bytesProcessed = (currentBytes + newBytes).toString();
    }

    // Check quota limits
    if (quota.limits) {
      if (quota.limits.maxQueriesPerDay &&
        quota.queriesExecuted >= quota.limits.maxQueriesPerDay) {
        this.emit('quota:exceeded', {
          projectId,
          quotaType: 'queries',
          current: quota.queriesExecuted,
          limit: quota.limits.maxQueriesPerDay,
        });
      }

      if (quota.limits.maxBytesProcessedPerDay &&
        BigInt(quota.bytesProcessed) >= BigInt(quota.limits.maxBytesProcessedPerDay)) {
        this.emit('quota:exceeded', {
          projectId,
          quotaType: 'bytes',
          current: quota.bytesProcessed,
          limit: quota.limits.maxBytesProcessedPerDay,
        });
      }
    }
  }

  /**
   * Start automatic project discovery
   */
  private startAutoDiscovery(): void {
    this.discoveryInterval = setInterval(async () => {
      try {
        await this.discoverProjects();
      } catch (error) {
        this.emit('discovery:error', error);
      }
    }, this.config.discoveryIntervalMs);

    this.emit('auto-discovery:started', {
      intervalMs: this.config.discoveryIntervalMs,
    });
  }

  /**
   * Start quota reset interval (daily)
   */
  private startQuotaResetInterval(): void {
    const resetQuotas = () => {
      this.projects.forEach((context) => {
        if (context.quotaUsage) {
          context.quotaUsage.queriesExecuted = 0;
          context.quotaUsage.bytesProcessed = '0';
          context.quotaUsage.concurrentQueries = 0;
          context.quotaUsage.lastResetAt = new Date();
        }
      });

      this.emit('quota:reset', {
        projectCount: this.projects.size,
      });
    };

    // Reset at midnight
    const now = new Date();
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(0, 0, 0, 0);

    const msUntilMidnight = tomorrow.getTime() - now.getTime();

    setTimeout(() => {
      resetQuotas();
      // Then set daily interval
      this.quotaResetInterval = setInterval(resetQuotas, 24 * 60 * 60 * 1000);
    }, msUntilMidnight);
  }

  /**
   * Get aggregated metrics across all projects
   */
  public getAggregatedMetrics(): AggregatedMetrics {
    const metrics = {
      totalProjects: this.projects.size,
      enabledProjects: 0,
      totalQueries: 0,
      totalBytesProcessed: BigInt(0),
      avgQueriesPerProject: 0,
      projectMetrics: new Map<string, ProjectMetricsData>(),
    };

    this.projects.forEach((context, projectId) => {
      if (context.enabled) metrics.enabledProjects++;

      if (context.quotaUsage) {
        metrics.totalQueries += context.quotaUsage.queriesExecuted;
        metrics.totalBytesProcessed += BigInt(context.quotaUsage.bytesProcessed);
      }

      metrics.projectMetrics.set(projectId, {
        accessCount: context.accessCount,
        lastAccessed: context.lastAccessedAt,
        quota: context.quotaUsage,
        poolMetrics: context.client.getPoolMetrics(),
        cacheStats: context.client.getCacheStats(),
      });
    });

    metrics.avgQueriesPerProject = metrics.totalProjects > 0
      ? metrics.totalQueries / metrics.totalProjects
      : 0;

    return {
      ...metrics,
      totalBytesProcessed: metrics.totalBytesProcessed.toString(),
    };
  }

  /**
   * Add new project dynamically
   */
  public addProject(projectConfig: ProjectConfig): void {
    if (this.projects.has(projectConfig.projectId)) {
      throw new MultiProjectManagerError(
        `Project ${projectConfig.projectId} already exists`,
        'PROJECT_ALREADY_EXISTS',
        projectConfig.projectId
      );
    }

    this.initializeProject(projectConfig);
    this.emit('project:added', { projectId: projectConfig.projectId });
  }

  /**
   * Remove project
   */
  public async removeProject(projectId: string): Promise<void> {
    const context = this.projects.get(projectId);

    if (!context) {
      throw new ProjectNotFoundError(projectId);
    }

    // Shutdown project resources
    await context.client.shutdown();
    await context.connectionPool.shutdown();
    context.datasetManager.shutdown();

    // Remove from map
    this.projects.delete(projectId);

    // Update current project if needed
    if (this.currentProjectId === projectId) {
      const remainingProjects = Array.from(this.projects.keys());
      this.currentProjectId = remainingProjects[0];
    }

    this.emit('project:removed', { projectId });
  }

  /**
   * Enable/disable project
   */
  public setProjectEnabled(projectId: string, enabled: boolean): void {
    const context = this.getProjectContext(projectId);
    context.enabled = enabled;

    this.emit('project:status:changed', {
      projectId,
      enabled,
    });
  }

  /**
   * Check if manager is healthy
   */
  public isHealthy(): boolean {
    if (this.isShuttingDown) return false;

    const healthyProjects = Array.from(this.projects.values()).filter(
      context => context.enabled && context.client.isHealthy()
    );

    return healthyProjects.length > 0;
  }

  /**
   * Shutdown all projects and cleanup
   */
  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) return;

    this.isShuttingDown = true;
    this.emit('shutdown:started');

    // Stop intervals
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
    }
    if (this.quotaResetInterval) {
      clearInterval(this.quotaResetInterval);
    }

    // Shutdown all projects
    const shutdownPromises = Array.from(this.projects.values()).map(async (context) => {
      try {
        await context.client.shutdown();
        await context.connectionPool.shutdown();
        context.datasetManager.shutdown();
      } catch (error) {
        this.emit('project:shutdown:error', {
          projectId: context.projectId,
          error,
        });
      }
    });

    await Promise.allSettled(shutdownPromises);

    // Clear caches
    this.projects.clear();
    this.permissionCache.clear();

    this.emit('shutdown:completed');
  }
}
