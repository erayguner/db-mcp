import { Query, JobMetadata, TableField } from '@google-cloud/bigquery';
import { z } from 'zod';
import { EventEmitter } from 'events';
import { ConnectionPool } from './connection-pool.js';
import { DatasetManager, DatasetMetadata, TableMetadata } from './dataset-manager.js';

// Google Cloud credentials interface
export interface BigQueryCredentials {
  client_email?: string;
  private_key?: string;
  project_id?: string;
  [key: string]: unknown;
}

// BigQuery error interface
export interface BigQueryError extends Error {
  code?: string | number;
  errors?: Array<{
    message: string;
    domain?: string;
    reason?: string;
  }>;
}

// Schema field type (from BigQuery)
export type SchemaField = TableField;

// Zod schemas for validation
export const BigQueryClientConfigSchema = z.object({
  projectId: z.string().optional(),
  location: z.string().optional(),
  keyFilename: z.string().optional(),
  credentials: z.record(z.unknown()).optional(),
  connectionPool: z
    .object({
      minConnections: z.number().min(1).default(2),
      maxConnections: z.number().min(1).default(10),
      acquireTimeoutMs: z.number().min(100).default(30000),
      idleTimeoutMs: z.number().min(1000).default(300000),
      healthCheckIntervalMs: z.number().min(1000).default(60000),
      maxRetries: z.number().min(0).default(3),
      retryDelayMs: z.number().min(100).default(1000),
      // Keep in sync with ConnectionPoolConfigSchema.
      shutdownDrainTimeoutMs: z.number().min(0).default(30000),
    })
    .default({}),
  datasetManager: z
    .object({
      // Keep these bounds in sync with DatasetManagerConfigSchema.
      cacheSize: z.number().min(1).default(100),
      cacheTTLMs: z.number().min(1).default(3600000),
      autoDiscovery: z.boolean().default(true),
      discoveryIntervalMs: z.number().min(1).default(300000),
    })
    .default({}),
  retry: z
    .object({
      maxRetries: z.number().min(0).default(3),
      initialDelayMs: z.number().min(100).default(1000),
      maxDelayMs: z.number().min(1000).default(32000),
      backoffMultiplier: z.number().min(1).default(2),
      retryableErrors: z
        .array(z.string())
        .default(['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND', 'RATE_LIMIT_EXCEEDED', 'BACKEND_ERROR']),
    })
    .default({}),
  queryDefaults: z
    .object({
      useLegacySql: z.boolean().default(false),
      location: z.string().optional(),
      maximumBytesBilled: z.string().optional(),
      timeoutMs: z.number().optional(),
    })
    .default({}),
});

export type BigQueryClientConfig = z.infer<typeof BigQueryClientConfigSchema>;
export type BigQueryClientInputConfig = z.input<typeof BigQueryClientConfigSchema>;

export interface QueryOptions extends Query {
  retry?: boolean;
  maxRetries?: number;
}

/** Metadata for a BigQuery job, as surfaced by `bigquery://jobs/{jobId}`. */
export interface JobInfo {
  jobId: string;
  state: string;
  startTime?: string;
  endTime?: string;
  durationMs?: number;
  totalBytesProcessed?: string;
  cacheHit?: boolean;
  error?: string;
}

/**
 * A single stage of a BigQuery query execution plan.
 *
 * Every numeric field is optional on purpose: BigQuery omits counters it did
 * not measure, and an omitted counter must stay `undefined` rather than being
 * defaulted to `0`, which a caller would read as a measured zero.
 */
export interface QueryPlanStage {
  id?: string;
  name: string;
  status?: string;
  slotMs?: number;
  recordsRead?: number;
  recordsWritten?: number;
  steps: string[];
}

/**
 * A BigQuery query execution plan, as reported by the job's statistics.
 *
 * A plan only exists for a job BigQuery actually executed. Dry runs, and jobs
 * fully served from cache, report no stages — in that case `stages` is empty
 * and `totalSlotMs` is `undefined`. Neither is a measurement of zero.
 */
export interface QueryPlan {
  jobId: string;
  stages: QueryPlanStage[];
  totalSlotMs?: number;
  totalBytesProcessed?: string;
  cacheHit?: boolean;
}

export interface QueryResult<T = Record<string, unknown>> {
  rows: T[];
  totalRows: number;
  schema: SchemaField[];
  jobId: string;
  cacheHit?: boolean;
  totalBytesProcessed?: string;
  totalSlotMs?: string;
  executionTimeMs: number;
}

/**
 * Build `{ key: n }` from a BigQuery counter, or `{}` when the API did not
 * report it. Spreading the result keeps unreported counters absent from the
 * object entirely, instead of coercing a missing value into a fabricated `0`.
 */
function toOptionalNumber<K extends string>(
  key: K,
  value: string | number | null | undefined
): Partial<Record<K, number>> {
  if (value === undefined || value === null || value === '') {
    return {};
  }

  const parsed = Number(value);
  return Number.isFinite(parsed) ? ({ [key]: parsed } as Record<K, number>) : {};
}

export class BigQueryClientError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown,
    public readonly retryable: boolean = false
  ) {
    super(message);
    this.name = 'BigQueryClientError';
  }
}

export class BigQueryClient extends EventEmitter {
  private config: BigQueryClientConfig;
  private connectionPool: ConnectionPool;
  private datasetManager: DatasetManager;
  private isShuttingDown = false;

  constructor(config: BigQueryClientInputConfig) {
    super();
    this.config = this.parseAndValidateConfig(config);

    // Initialize connection pool
    this.connectionPool = new ConnectionPool({
      ...this.config.connectionPool,
      projectId: this.config.projectId,
      keyFilename: this.config.keyFilename,
      credentials: this.config.credentials,
    });

    // Initialize dataset manager
    this.datasetManager = new DatasetManager({
      ...this.config.datasetManager,
      projectId: this.config.projectId,
    });

    this.setupEventHandlers();
  }

  private parseAndValidateConfig(config: BigQueryClientInputConfig): BigQueryClientConfig {
    const parsed = BigQueryClientConfigSchema.parse(config);

    // Merge top-level location into queryDefaults if not present
    if (parsed.location && !parsed.queryDefaults.location) {
      parsed.queryDefaults.location = parsed.location;
    }

    return parsed;
  }

  private setupEventHandlers(): void {
    // Forward connection pool events
    this.connectionPool.on('error', (error) => {
      this.emit('pool:error', error);
    });

    this.connectionPool.on('connection:acquired', (data) => {
      this.emit('pool:connection:acquired', data);
    });

    this.connectionPool.on('connection:released', (data) => {
      this.emit('pool:connection:released', data);
    });

    // Forward dataset manager events
    this.datasetManager.on('cache:hit', (data) => {
      this.emit('cache:hit', data);
    });

    this.datasetManager.on('cache:miss', (data) => {
      this.emit('cache:miss', data);
    });
  }

  /**
   * Execute a query with retry logic and connection pooling
   */
  public async query<T = Record<string, unknown>>(options: QueryOptions): Promise<QueryResult<T>> {
    if (this.isShuttingDown) {
      throw new BigQueryClientError(
        'Cannot execute query: client is shutting down',
        'CLIENT_SHUTDOWN'
      );
    }

    const startTime = Date.now();
    const shouldRetry = options.retry !== false;
    const maxRetries = options.maxRetries ?? this.config.retry.maxRetries;

    let lastError: Error | null = null;
    let attempt = 0;

    while (attempt <= maxRetries) {
      try {
        const result = await this.executeQuery<T>(options);

        if (attempt > 0) {
          this.emit('query:retry:success', {
            attempt,
            totalAttempts: attempt + 1,
            executionTimeMs: Date.now() - startTime,
          });
        }

        return result;
      } catch (error) {
        lastError = error as Error;

        const isRetryable =
          shouldRetry && attempt < maxRetries && this.isRetryableError(error as Error);

        if (!isRetryable) {
          throw this.wrapError(error as Error, false);
        }

        attempt++;
        const delayMs = this.calculateBackoff(attempt);

        this.emit('query:retry:attempt', {
          attempt,
          maxRetries,
          delayMs,
          error: (error as Error).message,
        });

        await this.sleep(delayMs);
      }
    }

    // All retries exhausted
    throw new BigQueryClientError(
      `Query failed after ${maxRetries + 1} attempts: ${lastError?.message}`,
      'MAX_RETRIES_EXCEEDED',
      lastError,
      false
    );
  }

  /**
   * Execute a single query attempt
   */
  private async executeQuery<T>(options: QueryOptions): Promise<QueryResult<T>> {
    const client = await this.connectionPool.acquire();
    const startTime = Date.now();

    try {
      // Merge with defaults
      const queryOptions: Query = {
        ...this.config.queryDefaults,
        ...options,
        query: options.query,
      };

      // Execute query
      const [job] = await client.createQueryJob(queryOptions);
      this.emit('query:started', { jobId: job.id });

      // Get results with metadata
      const [rows, , response] = await job.getQueryResults();
      const jobMetadataResponse = await job.getMetadata();
      const jobMetadata = jobMetadataResponse[0] as JobMetadata;

      const executionTimeMs = Date.now() - startTime;

      // Extract schema fields from query results response
      const schemaFields = (response?.schema?.fields as SchemaField[]) || [];

      const result: QueryResult<T> = {
        rows: rows as T[],
        totalRows: rows.length,
        schema: schemaFields,
        jobId: job.id!,
        cacheHit: jobMetadata.statistics?.query?.cacheHit,
        totalBytesProcessed: jobMetadata.statistics?.query?.totalBytesProcessed,
        totalSlotMs: jobMetadata.statistics?.query?.totalSlotMs,
        executionTimeMs,
      };

      this.emit('query:completed', {
        jobId: job.id,
        executionTimeMs,
        totalRows: result.totalRows,
        cacheHit: result.cacheHit,
      });

      return result;
    } finally {
      this.connectionPool.release(client);
    }
  }

  /**
   * Execute a dry run query to estimate costs
   */
  public async dryRun(
    query: string,
    options?: Partial<QueryOptions>
  ): Promise<{
    totalBytesProcessed: string;
    estimatedCostUSD: number;
  }> {
    const client = await this.connectionPool.acquire();

    try {
      const [job] = await client.createQueryJob({
        ...this.config.queryDefaults,
        ...options,
        query,
        dryRun: true,
      });

      const metadataResponse = await job.getMetadata();
      const metadata = metadataResponse[0] as JobMetadata;
      const totalBytesProcessed = metadata.statistics?.query?.totalBytesProcessed || '0';

      // BigQuery on-demand pricing: $6.25 per TB (as of 2025)
      const bytesProcessed = parseInt(totalBytesProcessed);
      const terabytesProcessed = bytesProcessed / 1024 ** 4;
      const estimatedCostUSD = terabytesProcessed * 6.25;

      return {
        totalBytesProcessed,
        estimatedCostUSD,
      };
    } finally {
      this.connectionPool.release(client);
    }
  }

  /**
   * Fetch metadata for a previously submitted query job.
   *
   * Backs the `bigquery://jobs/{jobId}` resource template, which was advertised
   * but always failed because this method did not exist.
   */
  public async getJob(jobId: string): Promise<JobInfo> {
    const client = await this.connectionPool.acquire();

    try {
      const job = client.job(jobId);
      const metadataResponse = await job.getMetadata();
      const metadata = metadataResponse[0] as JobMetadata;
      const stats = metadata.statistics;
      const query = stats?.query;

      const startMs = stats?.startTime ? Number(stats.startTime) : undefined;
      const endMs = stats?.endTime ? Number(stats.endTime) : undefined;

      return {
        jobId,
        state: (metadata as { status?: { state?: string } }).status?.state ?? 'UNKNOWN',
        ...(startMs !== undefined ? { startTime: new Date(startMs).toISOString() } : {}),
        ...(endMs !== undefined ? { endTime: new Date(endMs).toISOString() } : {}),
        ...(startMs !== undefined && endMs !== undefined ? { durationMs: endMs - startMs } : {}),
        ...(query?.totalBytesProcessed !== undefined
          ? { totalBytesProcessed: String(query.totalBytesProcessed) }
          : {}),
        ...(query?.cacheHit !== undefined ? { cacheHit: Boolean(query.cacheHit) } : {}),
        ...((metadata as { status?: { errorResult?: { message?: string } } }).status?.errorResult
          ? {
              error: (metadata as { status?: { errorResult?: { message?: string } } }).status!
                .errorResult!.message,
            }
          : {}),
      };
    } finally {
      this.connectionPool.release(client);
    }
  }

  /**
   * Fetch the real execution plan for a previously executed query job.
   *
   * Reads `statistics.query.queryPlan` from the job metadata. Counters BigQuery
   * did not report are left `undefined` rather than zero-filled, so a caller can
   * always tell "not measured" from "measured as zero".
   */
  public async getQueryPlan(jobId: string): Promise<QueryPlan> {
    const client = await this.connectionPool.acquire();

    try {
      const job = client.job(jobId);
      const metadataResponse = await job.getMetadata();
      const metadata = metadataResponse[0] as JobMetadata;
      const queryStats = metadata.statistics?.query;

      const stages: QueryPlanStage[] = (queryStats?.queryPlan ?? []).map((stage) => ({
        ...(stage.id !== undefined ? { id: String(stage.id) } : {}),
        name: stage.name ?? 'unnamed stage',
        ...(stage.status !== undefined ? { status: stage.status } : {}),
        ...toOptionalNumber('slotMs', stage.slotMs),
        ...toOptionalNumber('recordsRead', stage.recordsRead),
        ...toOptionalNumber('recordsWritten', stage.recordsWritten),
        steps: (stage.steps ?? []).flatMap((step) =>
          step.substeps?.length ? step.substeps : step.kind ? [step.kind] : []
        ),
      }));

      return {
        jobId,
        stages,
        ...toOptionalNumber('totalSlotMs', queryStats?.totalSlotMs),
        ...(queryStats?.totalBytesProcessed !== undefined
          ? { totalBytesProcessed: String(queryStats.totalBytesProcessed) }
          : {}),
        ...(queryStats?.cacheHit !== undefined ? { cacheHit: Boolean(queryStats.cacheHit) } : {}),
      };
    } finally {
      this.connectionPool.release(client);
    }
  }

  /**
   * Get dataset metadata with caching
   */
  public async getDataset(datasetId: string, projectId?: string): Promise<DatasetMetadata> {
    const client = await this.connectionPool.acquire();
    try {
      return await this.datasetManager.getDataset(client, datasetId, projectId);
    } finally {
      this.connectionPool.release(client);
    }
  }

  /**
   * Get table metadata with caching
   */
  public async getTable(
    datasetId: string,
    tableId: string,
    projectId?: string
  ): Promise<TableMetadata> {
    const client = await this.connectionPool.acquire();
    try {
      return await this.datasetManager.getTable(client, datasetId, tableId, projectId);
    } finally {
      this.connectionPool.release(client);
    }
  }

  /**
   * List all datasets with caching
   */
  public async listDatasets(projectId?: string): Promise<DatasetMetadata[]> {
    const client = await this.connectionPool.acquire();
    try {
      return await this.datasetManager.listDatasets(client, projectId);
    } finally {
      this.connectionPool.release(client);
    }
  }

  /**
   * List tables in a dataset with caching
   */
  public async listTables(datasetId: string, projectId?: string): Promise<TableMetadata[]> {
    const client = await this.connectionPool.acquire();
    try {
      return await this.datasetManager.listTables(client, datasetId, projectId);
    } finally {
      this.connectionPool.release(client);
    }
  }

  /**
   * Invalidate dataset/table cache
   */
  public invalidateCache(pattern?: string): void {
    this.datasetManager.invalidate(pattern);
    this.emit('cache:invalidated', { pattern });
  }

  /**
   * Get connection pool metrics
   */
  public getPoolMetrics() {
    return this.connectionPool.getMetrics();
  }

  /**
   * Get cache statistics
   */
  public getCacheStats() {
    return this.datasetManager.getCacheStats();
  }

  /**
   * Check if client is healthy
   */
  public isHealthy(): boolean {
    return !this.isShuttingDown && this.connectionPool.isHealthy();
  }

  /**
   * Get the configured project ID
   */
  public getProjectId(): string {
    return this.config.projectId ?? '';
  }

  /**
   * Test connection to BigQuery
   */
  public async testConnection(): Promise<boolean> {
    try {
      const client = await this.connectionPool.acquire();
      try {
        // Probe with a dry-run `SELECT 1`, matching ConnectionPool's health
        // check. Listing datasets only exercises metadata access: a principal
        // holding bigquery.datasets.list but not bigquery.jobs.create would be
        // reported healthy while every actual query fails.
        await client.createQueryJob({ query: 'SELECT 1', dryRun: true });
        return true;
      } finally {
        this.connectionPool.release(client);
      }
    } catch {
      return false;
    }
  }

  /**
   * Get table schema
   */
  public async getTableSchema(
    datasetId: string,
    tableId: string,
    projectId?: string
  ): Promise<SchemaField[]> {
    const table = await this.getTable(datasetId, tableId, projectId);
    return table.schema;
  }

  /**
   * Determine if error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();
    const errorCode = (error as BigQueryError).code;

    // Check against configured retryable errors
    for (const retryableError of this.config.retry.retryableErrors) {
      if (errorMessage.includes(retryableError.toLowerCase()) || errorCode === retryableError) {
        return true;
      }
    }

    // Check for specific BigQuery error codes
    const retryableCodes: (string | number)[] = [
      'RATE_LIMIT_EXCEEDED',
      'QUOTA_EXCEEDED',
      'BACKEND_ERROR',
      'DEADLINE_EXCEEDED',
      503, // Service Unavailable
      429, // Too Many Requests
    ];

    if (errorCode !== undefined && retryableCodes.includes(errorCode)) {
      return true;
    }

    return false;
  }

  /**
   * Calculate exponential backoff delay
   */
  private calculateBackoff(attempt: number): number {
    const delay = Math.min(
      this.config.retry.initialDelayMs * Math.pow(this.config.retry.backoffMultiplier, attempt - 1),
      this.config.retry.maxDelayMs
    );

    // Add jitter (±20%)
    const jitter = delay * 0.2 * (Math.random() * 2 - 1);
    return Math.floor(delay + jitter);
  }

  /**
   * Wrap error with additional context
   */
  private wrapError(error: Error, retryable: boolean): BigQueryClientError {
    const code = (error as BigQueryError).code?.toString() || 'UNKNOWN_ERROR';

    return new BigQueryClientError(error.message, code, error, retryable);
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Shutdown client and cleanup resources
   */
  public async shutdown(): Promise<void> {
    if (this.isShuttingDown) {
      return;
    }

    this.isShuttingDown = true;
    this.emit('shutdown:started');

    try {
      // Shutdown dataset manager
      this.datasetManager.shutdown();

      // Shutdown connection pool
      await this.connectionPool.shutdown();

      this.emit('shutdown:completed');
    } catch (error) {
      this.emit('error', new BigQueryClientError('Error during shutdown', 'SHUTDOWN_ERROR', error));
      throw error;
    }
  }
}
