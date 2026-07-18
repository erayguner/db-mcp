import { BigQuery, Dataset, Table, TableField } from '@google-cloud/bigquery';
import { z } from 'zod';
import { EventEmitter } from 'events';

// BigQuery API metadata interfaces
// These extend the types returned by the BigQuery SDK
export interface BigQueryDatasetReference {
  projectId: string;
  datasetId: string;
}

export interface BigQueryTableReference {
  projectId: string;
  datasetId: string;
  tableId: string;
}

export interface BigQueryDatasetMetadata {
  kind: string;
  id: string;
  datasetReference: BigQueryDatasetReference;
  location: string;
  creationTime: string;
  lastModifiedTime: string;
  description?: string;
  labels?: Record<string, string>;
  access?: Array<{
    role: string;
    specialGroup?: string;
    userByEmail?: string;
  }>;
  defaultTableExpirationMs?: string;
  defaultPartitionExpirationMs?: string;
}

export interface BigQueryTableSchema {
  fields: TableField[];
}

export interface BigQueryTableMetadata {
  kind: string;
  id: string;
  tableReference: BigQueryTableReference;
  type: 'TABLE' | 'VIEW' | 'EXTERNAL' | 'MATERIALIZED_VIEW';
  schema?: BigQueryTableSchema;
  numRows?: string;
  numBytes?: string;
  creationTime: string;
  lastModifiedTime: string;
  expirationTime?: string;
  description?: string;
  labels?: Record<string, string>;
  location?: string;
}

// Zod schemas
export const DatasetManagerConfigSchema = z.object({
  // Lower bounds only guard against zero/negative values. Previous floors
  // (cacheSize >= 10, cacheTTLMs >= 1000, discoveryIntervalMs >= 60000) were
  // arbitrary and rejected legitimate small configurations.
  cacheSize: z.number().min(1).default(100),
  cacheTTLMs: z.number().min(1).default(3600000), // 1 hour default
  autoDiscovery: z.boolean().default(true),
  discoveryIntervalMs: z.number().min(1).default(300000), // 5 minutes
  projectId: z.string().optional(),
});

export type DatasetManagerConfig = z.infer<typeof DatasetManagerConfigSchema>;

export interface DatasetMetadata {
  id: string;
  projectId: string;
  location: string;
  createdAt: Date;
  modifiedAt: Date;
  description?: string;
  labels?: Record<string, string>;
  tableCount: number;
  tables: TableMetadata[];
  lastAccessedAt: Date;
  accessCount: number;
}

export interface TableMetadata {
  id: string;
  datasetId: string;
  projectId: string;
  type: 'TABLE' | 'VIEW' | 'EXTERNAL' | 'MATERIALIZED_VIEW';
  schema: TableField[];
  numRows?: number;
  numBytes?: number;
  createdAt: Date;
  modifiedAt: Date;
  expirationTime?: Date;
  description?: string;
}

interface CacheEntry<T> {
  data: T;
  cachedAt: Date;
  expiresAt: Date;
  accessCount: number;
}

export class DatasetManagerError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'DatasetManagerError';
  }
}

export class DatasetManager extends EventEmitter {
  private config: Required<DatasetManagerConfig>;
  private datasetCache: Map<string, CacheEntry<DatasetMetadata>> = new Map();
  private tableCache: Map<string, CacheEntry<TableMetadata>> = new Map();
  private discoveryInterval?: NodeJS.Timeout;
  private accessOrder: string[] = []; // For LRU tracking

  // Lifetime hit/miss counters backing getCacheStats().hitRate.
  private datasetCounters = { hits: 0, misses: 0 };
  private tableCounters = { hits: 0, misses: 0 };

  constructor(config: DatasetManagerConfig) {
    super();
    this.config = DatasetManagerConfigSchema.parse(config) as Required<DatasetManagerConfig>;

    if (this.config.autoDiscovery) {
      this.startAutoDiscovery();
    }
  }

  /**
   * Get dataset metadata with caching
   */
  public async getDataset(
    client: BigQuery,
    datasetId: string,
    projectId?: string
  ): Promise<DatasetMetadata> {
    const cacheKey = this.getDatasetCacheKey(datasetId, projectId);

    // Check cache first
    const cached = this.getCachedDataset(cacheKey);
    if (cached) {
      this.datasetCounters.hits++;
      this.updateAccessOrder(cacheKey);
      this.emit('cache:hit', { type: 'dataset', key: cacheKey });
      return cached;
    }

    // Fetch from BigQuery
    this.datasetCounters.misses++;
    this.emit('cache:miss', { type: 'dataset', key: cacheKey });
    const metadata = await this.fetchDatasetMetadata(client, datasetId, projectId);

    // Cache the result
    this.cacheDataset(cacheKey, metadata);

    return metadata;
  }

  /**
   * Get table metadata with caching
   */
  public async getTable(
    client: BigQuery,
    datasetId: string,
    tableId: string,
    projectId?: string
  ): Promise<TableMetadata> {
    const cacheKey = this.getTableCacheKey(datasetId, tableId, projectId);

    // Check cache
    const cached = this.getCachedTable(cacheKey);
    if (cached) {
      this.tableCounters.hits++;
      this.updateAccessOrder(cacheKey);
      this.emit('cache:hit', { type: 'table', key: cacheKey });
      return cached;
    }

    // Fetch from BigQuery
    this.tableCounters.misses++;
    this.emit('cache:miss', { type: 'table', key: cacheKey });
    const metadata = await this.fetchTableMetadata(client, datasetId, tableId, projectId);

    // Cache the result
    this.cacheTable(cacheKey, metadata);

    return metadata;
  }

  /**
   * List all datasets with caching
   */
  public async listDatasets(client: BigQuery, projectId?: string): Promise<DatasetMetadata[]> {
    try {
      const [datasets] = await client.getDatasets({ projectId });

      const metadataPromises = datasets.map(async (dataset) => {
        const datasetId = dataset.id!;
        const cacheKey = this.getDatasetCacheKey(datasetId, projectId);

        // Check cache
        const cached = this.getCachedDataset(cacheKey);
        if (cached) {
          return cached;
        }

        // Fetch and cache
        const metadata = await this.fetchDatasetMetadata(client, datasetId, projectId);
        this.cacheDataset(cacheKey, metadata);
        return metadata;
      });

      return await Promise.all(metadataPromises);
    } catch (error) {
      throw new DatasetManagerError('Failed to list datasets', 'LIST_DATASETS_ERROR', error);
    }
  }

  /**
   * List tables in a dataset with caching
   */
  public async listTables(
    client: BigQuery,
    datasetId: string,
    projectId?: string
  ): Promise<TableMetadata[]> {
    try {
      const dataset = client.dataset(datasetId, { projectId });
      const [tables] = await dataset.getTables();

      const metadataPromises = tables.map(async (table) => {
        const tableId = table.id!;
        const cacheKey = this.getTableCacheKey(datasetId, tableId, projectId);

        // Check cache
        const cached = this.getCachedTable(cacheKey);
        if (cached) {
          return cached;
        }

        // Fetch and cache
        const metadata = await this.fetchTableMetadata(client, datasetId, tableId, projectId);
        this.cacheTable(cacheKey, metadata);
        return metadata;
      });

      return await Promise.all(metadataPromises);
    } catch (error) {
      throw new DatasetManagerError(
        `Failed to list tables in dataset ${datasetId}`,
        'LIST_TABLES_ERROR',
        error
      );
    }
  }

  /**
   * Fetch dataset metadata from BigQuery
   */
  private async fetchDatasetMetadata(
    client: BigQuery,
    datasetId: string,
    projectId?: string
  ): Promise<DatasetMetadata> {
    try {
      const dataset: Dataset = client.dataset(datasetId, { projectId });
      const metadataResponse = await dataset.getMetadata();
      const metadata = metadataResponse[0] as unknown as BigQueryDatasetMetadata;
      const [tables] = await dataset.getTables();

      const tableMetadataPromises = tables.map((table: Table) =>
        this.fetchTableMetadata(client, datasetId, table.id!, projectId)
      );
      const tableMetadata = await Promise.all(tableMetadataPromises);

      const datasetRef = metadata.datasetReference;
      const resolvedProjectId = projectId || datasetRef?.projectId || '';

      return {
        id: datasetId,
        projectId: resolvedProjectId,
        location: metadata.location || '',
        createdAt: new Date(parseInt(metadata.creationTime, 10)),
        modifiedAt: new Date(parseInt(metadata.lastModifiedTime, 10)),
        description: metadata.description,
        labels: metadata.labels,
        tableCount: tables.length,
        tables: tableMetadata,
        lastAccessedAt: new Date(),
        accessCount: 1,
      };
    } catch (error) {
      throw new DatasetManagerError(
        `Failed to fetch metadata for dataset ${datasetId}`,
        'FETCH_DATASET_ERROR',
        error
      );
    }
  }

  /**
   * Fetch table metadata from BigQuery
   */
  private async fetchTableMetadata(
    client: BigQuery,
    datasetId: string,
    tableId: string,
    projectId?: string
  ): Promise<TableMetadata> {
    try {
      const table: Table = client.dataset(datasetId, { projectId }).table(tableId);
      const metadataResponse = await table.getMetadata();
      const metadata = metadataResponse[0] as unknown as BigQueryTableMetadata;

      const tableRef = metadata.tableReference;
      const resolvedProjectId = projectId || tableRef?.projectId || '';

      return {
        id: tableId,
        datasetId,
        projectId: resolvedProjectId,
        type: metadata.type,
        schema: metadata.schema?.fields || [],
        numRows: metadata.numRows ? parseInt(metadata.numRows, 10) : undefined,
        numBytes: metadata.numBytes ? parseInt(metadata.numBytes, 10) : undefined,
        createdAt: new Date(parseInt(metadata.creationTime, 10)),
        modifiedAt: new Date(parseInt(metadata.lastModifiedTime, 10)),
        expirationTime: metadata.expirationTime
          ? new Date(parseInt(metadata.expirationTime, 10))
          : undefined,
        description: metadata.description,
      };
    } catch (error) {
      throw new DatasetManagerError(
        `Failed to fetch metadata for table ${datasetId}.${tableId}`,
        'FETCH_TABLE_ERROR',
        error
      );
    }
  }

  /**
   * Cache dataset metadata with LRU eviction
   */
  private cacheDataset(key: string, metadata: DatasetMetadata): void {
    // Evict if cache is full
    if (this.datasetCache.size >= this.config.cacheSize) {
      this.evictLRU('dataset');
    }

    const entry: CacheEntry<DatasetMetadata> = {
      data: metadata,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.cacheTTLMs),
      accessCount: 1,
    };

    this.datasetCache.set(key, entry);
    this.updateAccessOrder(key);

    this.emit('cache:set', { type: 'dataset', key });
  }

  /**
   * Cache table metadata with LRU eviction
   */
  private cacheTable(key: string, metadata: TableMetadata): void {
    // Evict if cache is full
    if (this.tableCache.size >= this.config.cacheSize) {
      this.evictLRU('table');
    }

    const entry: CacheEntry<TableMetadata> = {
      data: metadata,
      cachedAt: new Date(),
      expiresAt: new Date(Date.now() + this.config.cacheTTLMs),
      accessCount: 1,
    };

    this.tableCache.set(key, entry);
    this.updateAccessOrder(key);

    this.emit('cache:set', { type: 'table', key });
  }

  /**
   * Get cached dataset if valid
   */
  private getCachedDataset(key: string): DatasetMetadata | null {
    const entry = this.datasetCache.get(key);

    if (!entry) {
      return null;
    }

    // Check expiration
    if (new Date() > entry.expiresAt) {
      this.datasetCache.delete(key);
      this.emit('cache:expired', { type: 'dataset', key });
      return null;
    }

    entry.accessCount++;
    entry.data.lastAccessedAt = new Date();
    entry.data.accessCount++;

    return entry.data;
  }

  /**
   * Get cached table if valid
   */
  private getCachedTable(key: string): TableMetadata | null {
    const entry = this.tableCache.get(key);

    if (!entry) {
      return null;
    }

    // Check expiration
    if (new Date() > entry.expiresAt) {
      this.tableCache.delete(key);
      this.emit('cache:expired', { type: 'table', key });
      return null;
    }

    entry.accessCount++;

    return entry.data;
  }

  /**
   * Update LRU access order
   */
  private updateAccessOrder(key: string): void {
    // Remove if exists
    const index = this.accessOrder.indexOf(key);
    if (index !== -1) {
      this.accessOrder.splice(index, 1);
    }

    // Add to end (most recently used)
    this.accessOrder.push(key);
  }

  /**
   * Evict least recently used item
   */
  private evictLRU(type: 'dataset' | 'table'): void {
    if (this.accessOrder.length === 0) {
      return;
    }

    const cache = type === 'dataset' ? this.datasetCache : this.tableCache;

    // Find the least recently used key that exists in the cache
    for (let i = 0; i < this.accessOrder.length; i++) {
      const key = this.accessOrder[i];
      if (cache.has(key)) {
        cache.delete(key);
        this.accessOrder.splice(i, 1);
        this.emit('cache:evicted', { type, key, reason: 'lru' });
        return;
      }
    }
  }

  /**
   * Generate cache key for dataset
   */
  private getDatasetCacheKey(datasetId: string, projectId?: string): string {
    return projectId ? `${projectId}:${datasetId}` : datasetId;
  }

  /**
   * Generate cache key for table
   */
  private getTableCacheKey(datasetId: string, tableId: string, projectId?: string): string {
    return projectId ? `${projectId}:${datasetId}.${tableId}` : `${datasetId}.${tableId}`;
  }

  /**
   * Start auto-discovery process
   */
  private startAutoDiscovery(): void {
    this.discoveryInterval = setInterval(() => {
      this.emit('discovery:started');
      // Discovery will be triggered by client usage
    }, this.config.discoveryIntervalMs);
    // Prevent keeping the event loop alive in tests
    if (typeof this.discoveryInterval.unref === 'function') {
      this.discoveryInterval.unref();
    }
  }

  /**
   * Invalidate cache entries
   */
  public invalidate(pattern?: string): void {
    if (!pattern) {
      // Clear all
      this.datasetCache.clear();
      this.tableCache.clear();
      this.accessOrder = [];
      this.emit('cache:cleared', { reason: 'manual' });
      return;
    }

    // Clear matching entries
    const regex = new RegExp(pattern);

    const datasetKeys = Array.from(this.datasetCache.keys());
    for (const key of datasetKeys) {
      if (regex.test(key)) {
        this.datasetCache.delete(key);
        this.emit('cache:invalidated', { type: 'dataset', key });
      }
    }

    const tableKeys = Array.from(this.tableCache.keys());
    for (const key of tableKeys) {
      if (regex.test(key)) {
        this.tableCache.delete(key);
        this.emit('cache:invalidated', { type: 'table', key });
      }
    }

    // Clean up access order
    this.accessOrder = this.accessOrder.filter(
      (key) => this.datasetCache.has(key) || this.tableCache.has(key)
    );
  }

  /**
   * Get cache statistics
   */
  public getCacheStats() {
    return {
      datasets: {
        size: this.datasetCache.size,
        maxSize: this.config.cacheSize,
        hitRate: this.calculateHitRate('dataset'),
      },
      tables: {
        size: this.tableCache.size,
        maxSize: this.config.cacheSize,
        hitRate: this.calculateHitRate('table'),
      },
      lruQueue: this.accessOrder.length,
    };
  }

  /**
   * Cache hit rate as a fraction in [0, 1].
   *
   * Previously this returned `totalAccessCount / cache.size`, which is the mean
   * number of accesses per resident entry — not a hit rate. It ignored misses
   * entirely (no miss counter existed) and was unbounded above 1.0, so any
   * consumer treating it as a ratio read a meaningless number.
   */
  private calculateHitRate(type: 'dataset' | 'table'): number {
    const counters = type === 'dataset' ? this.datasetCounters : this.tableCounters;
    const total = counters.hits + counters.misses;

    if (total === 0) {
      return 0;
    }

    return counters.hits / total;
  }

  /**
   * Shutdown and cleanup
   */
  public shutdown(): void {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
    }

    this.datasetCache.clear();
    this.tableCache.clear();
    this.accessOrder = [];

    this.emit('shutdown');
  }
}
