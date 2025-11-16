import { BigQuery } from '@google-cloud/bigquery';
import { z } from 'zod';
import { EventEmitter } from 'events';

// Helper types for BigQuery metadata
interface DatasetMetadataRaw {
  datasetReference?: {
    projectId?: string;
    datasetId?: string;
  };
  location?: string;
  creationTime?: string;
  lastModifiedTime?: string;
  description?: string;
  labels?: Record<string, string>;
}

interface TableMetadataRaw {
  tableReference?: {
    projectId?: string;
    datasetId?: string;
    tableId?: string;
  };
  type?: string;
  schema?: {
    fields?: unknown[];
  };
  numRows?: string;
  numBytes?: string;
  creationTime?: string;
  lastModifiedTime?: string;
  expirationTime?: string;
}

function safeGetDatasetReference(metadata: unknown): { projectId: string } {
  const meta = metadata as DatasetMetadataRaw | undefined;
  return {
    projectId: meta?.datasetReference?.projectId ?? '',
  };
}

function safeGetTableReference(metadata: unknown): { projectId: string } {
  const meta = metadata as TableMetadataRaw | undefined;
  return {
    projectId: meta?.tableReference?.projectId ?? '',
  };
}

function safeGetDatasetMetadata(metadata: unknown): {
  location: string;
  creationTime: string;
  lastModifiedTime: string;
  description?: string;
  labels?: Record<string, string>;
} {
  const meta = metadata as DatasetMetadataRaw | undefined;
  return {
    location: meta?.location ?? '',
    creationTime: meta?.creationTime ?? '0',
    lastModifiedTime: meta?.lastModifiedTime ?? '0',
    description: meta?.description,
    labels: meta?.labels,
  };
}

function safeGetTableMetadata(metadata: unknown): {
  type: string;
  schema: unknown[];
  numRows?: string;
  numBytes?: string;
  creationTime: string;
  lastModifiedTime: string;
  expirationTime?: string;
} {
  const meta = metadata as TableMetadataRaw | undefined;
  return {
    type: meta?.type ?? 'TABLE',
    schema: meta?.schema?.fields ?? [],
    numRows: meta?.numRows,
    numBytes: meta?.numBytes,
    creationTime: meta?.creationTime ?? '0',
    lastModifiedTime: meta?.lastModifiedTime ?? '0',
    expirationTime: meta?.expirationTime,
  };
}

// Zod schemas
export const DatasetManagerConfigSchema = z.object({
  cacheSize: z.number().min(10).default(100),
  cacheTTLMs: z.number().min(1000).default(3600000), // 1 hour default
  autoDiscovery: z.boolean().default(true),
  discoveryIntervalMs: z.number().min(60000).default(300000), // 5 minutes
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
  schema: unknown[];
  numRows?: number;
  numBytes?: number;
  createdAt: Date;
  modifiedAt: Date;
  expirationTime?: Date;
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
      this.updateAccessOrder(cacheKey);
      this.emit('cache:hit', { type: 'dataset', key: cacheKey });
      return cached;
    }

    // Fetch from BigQuery
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
      this.updateAccessOrder(cacheKey);
      this.emit('cache:hit', { type: 'table', key: cacheKey });
      return cached;
    }

    // Fetch from BigQuery
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
      const datasetsResult = await client.getDatasets({ projectId });
      const datasets = datasetsResult[0];

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
      const err = error instanceof Error ? error : new Error(String(error));
      throw new DatasetManagerError(
        `Failed to list datasets: ${err.message}`,
        'LIST_DATASETS_ERROR',
        err
      );
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
      const tablesResult = await dataset.getTables();
      const tables = tablesResult[0];

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
      const err = error instanceof Error ? error : new Error(String(error));
      throw new DatasetManagerError(
        `Failed to list tables in dataset ${datasetId}: ${err.message}`,
        'LIST_TABLES_ERROR',
        err
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
      const dataset = client.dataset(datasetId, { projectId });
      const metadataResult = await dataset.getMetadata();
      const metadata = metadataResult[0] as DatasetMetadataRaw;
      const tablesResult = await dataset.getTables();
      const tables = tablesResult[0];

      const tableMetadataPromises = tables.map(table =>
        this.fetchTableMetadata(client, datasetId, table.id!, projectId)
      );
      const tableMetadata = await Promise.all(tableMetadataPromises);

      const datasetRef = safeGetDatasetReference(metadata);
      const datasetMeta = safeGetDatasetMetadata(metadata);

      return {
        id: datasetId,
        projectId: projectId || datasetRef.projectId,
        location: datasetMeta.location,
        createdAt: new Date(parseInt(datasetMeta.creationTime, 10)),
        modifiedAt: new Date(parseInt(datasetMeta.lastModifiedTime, 10)),
        description: datasetMeta.description,
        labels: datasetMeta.labels,
        tableCount: tables.length,
        tables: tableMetadata,
        lastAccessedAt: new Date(),
        accessCount: 1,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new DatasetManagerError(
        `Failed to fetch metadata for dataset ${datasetId}: ${err.message}`,
        'FETCH_DATASET_ERROR',
        err
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
      const table = client.dataset(datasetId, { projectId }).table(tableId);
      const metadataResult = await table.getMetadata();
      const metadata = metadataResult[0] as TableMetadataRaw;

      const tableRef = safeGetTableReference(metadata);
      const tableMeta = safeGetTableMetadata(metadata);

      return {
        id: tableId,
        datasetId,
        projectId: projectId || tableRef.projectId,
        type: tableMeta.type as TableMetadata['type'],
        schema: tableMeta.schema,
        numRows: tableMeta.numRows ? parseInt(tableMeta.numRows, 10) : undefined,
        numBytes: tableMeta.numBytes ? parseInt(tableMeta.numBytes, 10) : undefined,
        createdAt: new Date(parseInt(tableMeta.creationTime, 10)),
        modifiedAt: new Date(parseInt(tableMeta.lastModifiedTime, 10)),
        expirationTime: tableMeta.expirationTime
          ? new Date(parseInt(tableMeta.expirationTime, 10))
          : undefined,
      };
    } catch (error) {
      const err = error instanceof Error ? error : new Error(String(error));
      throw new DatasetManagerError(
        `Failed to fetch metadata for table ${datasetId}.${tableId}: ${err.message}`,
        'FETCH_TABLE_ERROR',
        err
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
    return projectId
      ? `${projectId}:${datasetId}.${tableId}`
      : `${datasetId}.${tableId}`;
  }

  /**
   * Start auto-discovery process
   */
  private startAutoDiscovery(): void {
    this.discoveryInterval = setInterval(() => {
      this.emit('discovery:started');
      // Discovery will be triggered by client usage
    }, this.config.discoveryIntervalMs);
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

    for (const key of this.datasetCache.keys()) {
      if (regex.test(key)) {
        this.datasetCache.delete(key);
        this.emit('cache:invalidated', { type: 'dataset', key });
      }
    }

    for (const key of this.tableCache.keys()) {
      if (regex.test(key)) {
        this.tableCache.delete(key);
        this.emit('cache:invalidated', { type: 'table', key });
      }
    }

    // Clean up access order
    this.accessOrder = this.accessOrder.filter(
      key => this.datasetCache.has(key) || this.tableCache.has(key)
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

  private calculateHitRate(type: 'dataset' | 'table'): number {
    // This is a simplified calculation
    // In production, you'd track hits/misses over time
    const cache = type === 'dataset' ? this.datasetCache : this.tableCache;
    if (cache.size === 0) return 0;

    const totalAccess = Array.from(cache.values()).reduce(
      (sum, entry) => sum + entry.accessCount,
      0
    );

    return cache.size > 0 ? totalAccess / cache.size : 0;
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
