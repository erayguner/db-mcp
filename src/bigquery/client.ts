import { BigQuery, Query, QueryResultsOptions } from '@google-cloud/bigquery';
import { z } from 'zod';
import { EventEmitter } from 'events';
import { ConnectionPool, ConnectionPoolConfig } from './connection-pool.js';
import { DatasetManager, DatasetManagerConfig, DatasetMetadata, TableMetadata } from './dataset-manager.js';

// Zod schemas for validation
export const BigQueryClientConfigSchema = z.object({
  projectId: z.string().optional(),
  keyFilename: z.string().optional(),
  credentials: z.any().optional(),
  connectionPool: z.object({
    minConnections: z.number().min(1).default(2),
    maxConnections: z.number().min(1).default(10),
    acquireTimeoutMs: z.number().min(100).default(30000),
    idleTimeoutMs: z.number().min(1000).default(300000),
    healthCheckIntervalMs: z.number().min(1000).default(60000),
    maxRetries: z.number().min(0).default(3),
    retryDelayMs: z.number().min(100).default(1000),
  }).optional(),
  datasetManager: z.object({
    cacheSize: z.number().min(10).default(100),
    cacheTTLMs: z.number().min(1000).default(3600000),
    autoDiscovery: z.boolean().default(true),
    discoveryIntervalMs: z.number().min(60000).default(300000),
  }).optional(),
  retry: z.object({
    maxRetries: z.number().min(0).default(3),
    initialDelayMs: z.number().min(100).default(1000),
    maxDelayMs: z.number().min(1000).default(32000),
    backoffMultiplier: z.number().min(1).default(2),
    retryableErrors: z.array(z.string()).default([
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'RATE_LIMIT_EXCEEDED',
      'BACKEND_ERROR',
    ]),
  }).optional(),
  queryDefaults: z.object({
    useLegacySql: z.boolean().default(false),
    location: z.string().optional(),
    maximumBytesBilled: z.string().optional(),
    timeoutMs: z.number().optional(),
  }).optional(),
});

export type BigQueryClientConfig = z.infer<typeof BigQueryClientConfigSchema>;

export interface QueryOptions extends Query {
  retry?: boolean;
  maxRetries?: number;
}

export interface QueryResult<T = any> {
  rows: T[];
  totalRows: number;
  schema: any[];
  jobId: string;
  cacheHit?: boolean;
  totalBytesProcessed?: string;
  totalSlotMs?: string;
  executionTimeMs: number;
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
  private config: Required<BigQueryClientConfig>;
  private connectionPool: ConnectionPool;
  private datasetManager: DatasetManager;
  private isShuttingDown = false;

  constructor(config: BigQueryClientConfig) {
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

  private parseAndValidateConfig(config: BigQueryClientConfig): Required<BigQueryClientConfig> {
    const parsed = BigQueryClientConfigSchema.parse(config);

    return {
      projectId: parsed.projectId,
      keyFilename: parsed.keyFilename,
      credentials: parsed.credentials,
      connectionPool: parsed.connectionPool || {
        minConnections: 2,
        maxConnections: 10,
        acquireTimeoutMs: 30000,
        idleTimeoutMs: 300000,
        healthCheckIntervalMs: 60000,
        maxRetries: 3,
        retryDelayMs: 1000,
      },
      datasetManager: parsed.datasetManager || {
        cacheSize: 100,
        cacheTTLMs: 3600000,
        autoDiscovery: true,
        discoveryIntervalMs: 300000,
      },
      retry: parsed.retry || {
        maxRetries: 3,
        initialDelayMs: 1000,
        maxDelayMs: 32000,
        backoffMultiplier: 2,
        retryableErrors: [
          'ECONNRESET',
          'ETIMEDOUT',
          'ENOTFOUND',
          'RATE_LIMIT_EXCEEDED',
          'BACKEND_ERROR',
        ],
      },
      queryDefaults: parsed.queryDefaults || {
        useLegacySql: false,
        location: undefined,
        maximumBytesBilled: undefined,
        timeoutMs: undefined,
      },
    };
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
  public async query<T = any>(options: QueryOptions): Promise<QueryResult<T>> {
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

        const isRetryable = shouldRetry &&
                           attempt < maxRetries &&
                           this.isRetryableError(error as Error);

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

      // Get results
      const [rows] = await job.getQueryResults();
      const [metadata] = await job.getMetadata();

      const executionTimeMs = Date.now() - startTime;

      const result: QueryResult<T> = {
        rows: rows as T[],
        totalRows: rows.length,
        schema: metadata.configuration?.query?.destinationTable?.schema?.fields || [],
        jobId: job.id!,
        cacheHit: metadata.statistics?.query?.cacheHit,
        totalBytesProcessed: metadata.statistics?.query?.totalBytesProcessed,
        totalSlotMs: metadata.statistics?.query?.totalSlotMs,
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
  public async dryRun(query: string, options?: Partial<QueryOptions>): Promise<{
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

      const [metadata] = await job.getMetadata();
      const totalBytesProcessed = metadata.statistics?.query?.totalBytesProcessed || '0';

      // BigQuery pricing: $5 per TB processed (as of 2024)
      const bytesProcessed = parseInt(totalBytesProcessed);
      const terabytesProcessed = bytesProcessed / (1024 ** 4);
      const estimatedCostUSD = terabytesProcessed * 5;

      return {
        totalBytesProcessed,
        estimatedCostUSD,
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
   * Determine if error is retryable
   */
  private isRetryableError(error: Error): boolean {
    const errorMessage = error.message.toLowerCase();
    const errorCode = (error as any).code;

    // Check against configured retryable errors
    for (const retryableError of this.config.retry.retryableErrors) {
      if (errorMessage.includes(retryableError.toLowerCase()) ||
          errorCode === retryableError) {
        return true;
      }
    }

    // Check for specific BigQuery error codes
    const retryableCodes = [
      'RATE_LIMIT_EXCEEDED',
      'QUOTA_EXCEEDED',
      'BACKEND_ERROR',
      'DEADLINE_EXCEEDED',
      503, // Service Unavailable
      429, // Too Many Requests
    ];

    if (retryableCodes.includes(errorCode)) {
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
    const code = (error as any).code || 'UNKNOWN_ERROR';

    return new BigQueryClientError(
      error.message,
      code,
      error,
      retryable
    );
  }

  /**
   * Sleep utility for retry delays
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
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
      this.emit('error', new BigQueryClientError(
        'Error during shutdown',
        'SHUTDOWN_ERROR',
        error
      ));
      throw error;
    }
  }

  /**
   * Create a query builder for fluent API
   */
  public createQueryBuilder(): QueryBuilder {
    return new QueryBuilder(this);
  }
}

/**
 * Fluent query builder for BigQuery
 */
export class QueryBuilder {
  private queryParts: {
    select?: string[];
    from?: string;
    where?: string[];
    groupBy?: string[];
    having?: string[];
    orderBy?: string[];
    limit?: number;
    offset?: number;
  } = {};

  private parameters: Record<string, any> = {};

  constructor(private client: BigQueryClient) {}

  select(...columns: string[]): this {
    this.queryParts.select = columns;
    return this;
  }

  from(table: string): this {
    this.queryParts.from = table;
    return this;
  }

  where(condition: string): this {
    if (!this.queryParts.where) {
      this.queryParts.where = [];
    }
    this.queryParts.where.push(condition);
    return this;
  }

  groupBy(...columns: string[]): this {
    this.queryParts.groupBy = columns;
    return this;
  }

  having(condition: string): this {
    if (!this.queryParts.having) {
      this.queryParts.having = [];
    }
    this.queryParts.having.push(condition);
    return this;
  }

  orderBy(...columns: string[]): this {
    this.queryParts.orderBy = columns;
    return this;
  }

  limit(count: number): this {
    this.queryParts.limit = count;
    return this;
  }

  offset(count: number): this {
    this.queryParts.offset = count;
    return this;
  }

  param(name: string, value: any): this {
    this.parameters[name] = value;
    return this;
  }

  build(): string {
    const parts: string[] = [];

    // SELECT
    if (this.queryParts.select && this.queryParts.select.length > 0) {
      parts.push(`SELECT ${this.queryParts.select.join(', ')}`);
    } else {
      parts.push('SELECT *');
    }

    // FROM
    if (this.queryParts.from) {
      parts.push(`FROM ${this.queryParts.from}`);
    }

    // WHERE
    if (this.queryParts.where && this.queryParts.where.length > 0) {
      parts.push(`WHERE ${this.queryParts.where.join(' AND ')}`);
    }

    // GROUP BY
    if (this.queryParts.groupBy && this.queryParts.groupBy.length > 0) {
      parts.push(`GROUP BY ${this.queryParts.groupBy.join(', ')}`);
    }

    // HAVING
    if (this.queryParts.having && this.queryParts.having.length > 0) {
      parts.push(`HAVING ${this.queryParts.having.join(' AND ')}`);
    }

    // ORDER BY
    if (this.queryParts.orderBy && this.queryParts.orderBy.length > 0) {
      parts.push(`ORDER BY ${this.queryParts.orderBy.join(', ')}`);
    }

    // LIMIT
    if (this.queryParts.limit !== undefined) {
      parts.push(`LIMIT ${this.queryParts.limit}`);
    }

    // OFFSET
    if (this.queryParts.offset !== undefined) {
      parts.push(`OFFSET ${this.queryParts.offset}`);
    }

    return parts.join('\n');
  }

  async execute<T = any>(options?: Partial<QueryOptions>): Promise<QueryResult<T>> {
    const query = this.build();
    const params = Object.entries(this.parameters).map(([name, value]) => ({
      name,
      parameterType: { type: this.inferType(value) },
      parameterValue: { value: String(value) },
    }));

    return this.client.query<T>({
      ...options,
      query,
      params: params.length > 0 ? params : undefined,
    });
  }

  async dryRun(options?: Partial<QueryOptions>): Promise<{
    totalBytesProcessed: string;
    estimatedCostUSD: number;
  }> {
    const query = this.build();
    return this.client.dryRun(query, options);
  }

  private inferType(value: any): string {
    if (typeof value === 'number') {
      return Number.isInteger(value) ? 'INT64' : 'FLOAT64';
    }
    if (typeof value === 'boolean') {
      return 'BOOL';
    }
    if (value instanceof Date) {
      return 'TIMESTAMP';
    }
    return 'STRING';
  }
}
