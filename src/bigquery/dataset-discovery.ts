import { BigQuery } from '@google-cloud/bigquery';
import { EventEmitter } from 'events';
import { z } from 'zod';
import { DatasetManager, DatasetMetadata } from './dataset-manager.js';
import { ConnectionPool } from './connection-pool.js';

/**
 * Configuration schema for Dataset Discovery
 */
export const DatasetDiscoveryConfigSchema = z.object({
  // Discovery settings
  scanIntervalMs: z.number().min(60000).default(300000), // 5 minutes
  maxConcurrentScans: z.number().min(1).max(10).default(3),
  enableAutoDiscovery: z.boolean().default(true),

  // Search settings
  searchIndexSize: z.number().min(100).default(10000),
  fullTextIndexing: z.boolean().default(true),

  // Filtering settings
  includeRegions: z.array(z.string()).optional(),
  excludeRegions: z.array(z.string()).optional(),
  includeLabels: z.record(z.string()).optional(),
  excludeLabels: z.record(z.string()).optional(),

  // Performance settings
  incrementalUpdateEnabled: z.boolean().default(true),
  cacheMetadata: z.boolean().default(true),
  metadataTTLMs: z.number().min(60000).default(3600000), // 1 hour

  // Relationship settings
  buildRelationshipGraph: z.boolean().default(true),
  maxRelationshipDepth: z.number().min(1).max(5).default(3),

  // Access pattern settings
  trackAccessPatterns: z.boolean().default(true),
  accessPatternWindowMs: z.number().min(3600000).default(86400000), // 24 hours
});

export type DatasetDiscoveryConfig = z.infer<typeof DatasetDiscoveryConfigSchema>;

/**
 * Enhanced dataset metadata with discovery features
 */
export interface DiscoveredDataset extends DatasetMetadata {
  // Discovery metadata
  discoveredAt: Date;
  lastUpdatedAt: Date;
  updateCount: number;

  // Search metadata
  searchableText: string;
  keywords: string[];

  // Relationship metadata
  relatedDatasets: DatasetRelationship[];
  dependentTables: string[];

  // Access pattern metadata
  accessPattern: AccessPattern;
  popularityScore: number;

  // Size and cost metadata
  totalSizeBytes: number;
  estimatedMonthlyCost: number;
}

/**
 * Dataset relationship information
 */
export interface DatasetRelationship {
  datasetId: string;
  projectId: string;
  relationshipType: 'REFERENCE' | 'DERIVED' | 'SIMILAR' | 'SHARED_TABLES';
  strength: number; // 0-1 score
  discoveredAt: Date;
}

/**
 * Access pattern tracking
 */
export interface AccessPattern {
  totalAccesses: number;
  uniqueUsers: Set<string>;
  lastAccessedAt: Date;
  accessFrequency: 'VERY_HIGH' | 'HIGH' | 'MEDIUM' | 'LOW' | 'VERY_LOW';
  peakAccessTimes: Date[];
  averageQueryDurationMs: number;
}

/**
 * Search query interface
 */
export interface SearchQuery {
  text?: string;
  labels?: Record<string, string>;
  regions?: string[];
  projects?: string[];
  minSize?: number;
  maxSize?: number;
  createdAfter?: Date;
  createdBefore?: Date;
  hasDescription?: boolean;
  sortBy?: 'relevance' | 'name' | 'size' | 'created' | 'popularity';
  sortOrder?: 'asc' | 'desc';
  limit?: number;
  offset?: number;
}

/**
 * Search result with scoring
 */
export interface SearchResult {
  dataset: DiscoveredDataset;
  relevanceScore: number;
  matchedFields: string[];
  highlights: Record<string, string[]>;
}

/**
 * Discovery statistics
 */
export interface DiscoveryStats {
  totalDatasets: number;
  totalTables: number;
  totalSizeBytes: number;
  projectCount: number;
  regionDistribution: Record<string, number>;
  labelDistribution: Record<string, number>;
  lastFullScan: Date | null;
  lastIncrementalUpdate: Date | null;
  scanDurationMs: number;
  indexedKeywords: number;
  relationshipCount: number;
}

/**
 * Dataset relationship graph
 */
export interface RelationshipGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
  clusters: DatasetCluster[];
}

export interface GraphNode {
  id: string;
  datasetId: string;
  projectId: string;
  label: string;
  size: number;
  popularity: number;
}

export interface GraphEdge {
  source: string;
  target: string;
  type: string;
  strength: number;
}

export interface DatasetCluster {
  id: string;
  datasets: string[];
  commonLabels: Record<string, string>;
  totalSize: number;
  description: string;
}

export class DatasetDiscoveryError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'DatasetDiscoveryError';
  }
}

/**
 * Enterprise Dataset Discovery and Search System
 *
 * Features:
 * - Cross-project dataset discovery
 * - Full-text search with relevance scoring
 * - Advanced filtering and sorting
 * - Dataset relationship mapping
 * - Access pattern tracking
 * - Incremental updates
 * - Performance optimized
 */
export class DatasetDiscovery extends EventEmitter {
  private config: Required<DatasetDiscoveryConfig>;
  private discoveredDatasets: Map<string, DiscoveredDataset> = new Map();
  private searchIndex: Map<string, Set<string>> = new Map(); // keyword -> dataset IDs
  private relationshipGraph: Map<string, Set<DatasetRelationship>> = new Map();
  private discoveryInterval?: NodeJS.Timeout;
  private isScanning = false;
  private stats: DiscoveryStats = {
    totalDatasets: 0,
    totalTables: 0,
    totalSizeBytes: 0,
    projectCount: 0,
    regionDistribution: {},
    labelDistribution: {},
    lastFullScan: null,
    lastIncrementalUpdate: null,
    scanDurationMs: 0,
    indexedKeywords: 0,
    relationshipCount: 0,
  };

  constructor(
    private connectionPool: ConnectionPool,
    private datasetManager: DatasetManager,
    config?: Partial<DatasetDiscoveryConfig>
  ) {
    super();
    this.config = DatasetDiscoveryConfigSchema.parse(config || {}) as Required<DatasetDiscoveryConfig>;

    if (this.config.enableAutoDiscovery) {
      this.startAutoDiscovery();
    }
  }

  /**
   * Discover datasets across multiple projects
   */
  public async discoverDatasets(projectIds: string[]): Promise<DiscoveredDataset[]> {
    if (this.isScanning) {
      throw new DatasetDiscoveryError(
        'Discovery scan already in progress',
        'SCAN_IN_PROGRESS'
      );
    }

    this.isScanning = true;
    const startTime = Date.now();
    this.emit('discovery:started', { projectIds });

    try {
      const client = await this.connectionPool.acquire();

      try {
        const allDiscovered: DiscoveredDataset[] = [];

        // Scan projects concurrently with limit
        for (let i = 0; i < projectIds.length; i += this.config.maxConcurrentScans) {
          const batch = projectIds.slice(i, i + this.config.maxConcurrentScans);

          const batchResults = await Promise.all(
            batch.map(projectId => this.discoverProjectDatasets(client, projectId))
          );

          allDiscovered.push(...batchResults.flat());
        }

        // Build search index
        if (this.config.fullTextIndexing) {
          this.buildSearchIndex(allDiscovered);
        }

        // Build relationship graph
        if (this.config.buildRelationshipGraph) {
          await this.buildRelationshipGraph(allDiscovered);
        }

        // Update statistics
        this.updateStats(allDiscovered, Date.now() - startTime);

        this.emit('discovery:completed', {
          datasetsDiscovered: allDiscovered.length,
          durationMs: Date.now() - startTime,
        });

        return allDiscovered;
      } finally {
        this.connectionPool.release(client);
      }
    } catch (error) {
      this.emit('discovery:error', error);
      throw new DatasetDiscoveryError(
        'Failed to discover datasets',
        'DISCOVERY_ERROR',
        error
      );
    } finally {
      this.isScanning = false;
    }
  }

  /**
   * Discover datasets in a single project
   */
  private async discoverProjectDatasets(
    _client: BigQuery,
    projectId: string
  ): Promise<DiscoveredDataset[]> {
    try {
      const datasets = await this.datasetManager.listDatasets(_client, projectId);
      const discovered: DiscoveredDataset[] = [];

      for (const dataset of datasets) {
        const discoveredDataset = await this.enhanceDatasetMetadata(dataset, _client);

        // Apply filters
        if (this.shouldIncludeDataset(discoveredDataset)) {
          discovered.push(discoveredDataset);
          this.discoveredDatasets.set(
            this.getDatasetKey(discoveredDataset.id, discoveredDataset.projectId),
            discoveredDataset
          );
        }
      }

      this.emit('project:discovered', {
        projectId,
        datasetCount: discovered.length,
      });

      return discovered;
    } catch (error) {
      this.emit('project:error', { projectId, error });
      throw new DatasetDiscoveryError(
        `Failed to discover datasets in project ${projectId}`,
        'PROJECT_DISCOVERY_ERROR',
        error
      );
    }
  }

  /**
   * Enhance dataset metadata with discovery features
   */
  private async enhanceDatasetMetadata(
    dataset: DatasetMetadata,
    _client: BigQuery
  ): Promise<DiscoveredDataset> {
    const now = new Date();

    // Calculate total size
    const totalSizeBytes = dataset.tables.reduce(
      (sum, table) => sum + (table.numBytes || 0),
      0
    );

    // Estimate monthly cost (BigQuery storage pricing: $0.02 per GB)
    const estimatedMonthlyCost = (totalSizeBytes / (1024 ** 3)) * 0.02;

    // Extract keywords for search
    const keywords = this.extractKeywords(dataset);

    // Build searchable text
    const searchableText = this.buildSearchableText(dataset);

    // Initialize access pattern
    const accessPattern: AccessPattern = {
      totalAccesses: dataset.accessCount,
      uniqueUsers: new Set(),
      lastAccessedAt: dataset.lastAccessedAt,
      accessFrequency: this.calculateAccessFrequency(dataset.accessCount),
      peakAccessTimes: [],
      averageQueryDurationMs: 0,
    };

    // Calculate popularity score (0-100)
    const popularityScore = this.calculatePopularityScore(dataset, accessPattern);

    return {
      ...dataset,
      discoveredAt: now,
      lastUpdatedAt: now,
      updateCount: 1,
      searchableText,
      keywords,
      relatedDatasets: [],
      dependentTables: [],
      accessPattern,
      popularityScore,
      totalSizeBytes,
      estimatedMonthlyCost,
    };
  }

  /**
   * Search datasets with advanced filtering and ranking
   */
  public async search(query: SearchQuery): Promise<SearchResult[]> {
    const results: SearchResult[] = [];
    const datasets = Array.from(this.discoveredDatasets.values());

    // Apply filters
    let filtered = this.applyFilters(datasets, query);

    // Text search with relevance scoring
    if (query.text) {
      const scoredResults = this.performTextSearch(filtered, query.text);
      filtered = scoredResults.map(r => r.dataset);

      // Create search results with highlights
      for (const result of scoredResults) {
        results.push({
          dataset: result.dataset,
          relevanceScore: result.score,
          matchedFields: result.matchedFields,
          highlights: result.highlights,
        });
      }
    } else {
      // No text search, just filtered results
      for (const dataset of filtered) {
        results.push({
          dataset,
          relevanceScore: dataset.popularityScore / 100,
          matchedFields: [],
          highlights: {},
        });
      }
    }

    // Sort results
    const sorted = this.sortResults(results, query);

    // Apply pagination
    const offset = query.offset || 0;
    const limit = query.limit || 100;
    const paginated = sorted.slice(offset, offset + limit);

    this.emit('search:completed', {
      query,
      totalResults: sorted.length,
      returnedResults: paginated.length,
    });

    return paginated;
  }

  /**
   * Get dataset by ID
   */
  public getDataset(datasetId: string, projectId: string): DiscoveredDataset | null {
    return this.discoveredDatasets.get(this.getDatasetKey(datasetId, projectId)) || null;
  }

  /**
   * Get all discovered datasets
   */
  public getAllDatasets(): DiscoveredDataset[] {
    return Array.from(this.discoveredDatasets.values());
  }

  /**
   * Get discovery statistics
   */
  public getStats(): DiscoveryStats {
    return { ...this.stats };
  }

  /**
   * Get relationship graph
   */
  public getRelationshipGraph(): RelationshipGraph {
    const nodes: GraphNode[] = [];
    const edges: GraphEdge[] = [];
    const clusterMap = new Map<string, Set<string>>();

    // Build nodes
    for (const dataset of this.discoveredDatasets.values()) {
      nodes.push({
        id: this.getDatasetKey(dataset.id, dataset.projectId),
        datasetId: dataset.id,
        projectId: dataset.projectId,
        label: dataset.description || dataset.id,
        size: dataset.totalSizeBytes,
        popularity: dataset.popularityScore,
      });
    }

    // Build edges
    for (const [key, relationships] of this.relationshipGraph.entries()) {
      for (const rel of relationships) {
        edges.push({
          source: key,
          target: this.getDatasetKey(rel.datasetId, rel.projectId),
          type: rel.relationshipType,
          strength: rel.strength,
        });
      }
    }

    // Build clusters based on labels
    for (const dataset of this.discoveredDatasets.values()) {
      if (dataset.labels) {
        const clusterKey = JSON.stringify(dataset.labels);
        if (!clusterMap.has(clusterKey)) {
          clusterMap.set(clusterKey, new Set());
        }
        clusterMap.get(clusterKey)!.add(this.getDatasetKey(dataset.id, dataset.projectId));
      }
    }

    const clusters: DatasetCluster[] = [];
    let clusterId = 0;
    for (const [labelKey, datasetIds] of clusterMap.entries()) {
      if (datasetIds.size > 1) {
        const labels = JSON.parse(labelKey);
        const totalSize = Array.from(datasetIds).reduce((sum, id) => {
          const dataset = this.discoveredDatasets.get(id);
          return sum + (dataset?.totalSizeBytes || 0);
        }, 0);

        clusters.push({
          id: `cluster-${clusterId++}`,
          datasets: Array.from(datasetIds),
          commonLabels: labels,
          totalSize,
          description: `Cluster with ${datasetIds.size} datasets`,
        });
      }
    }

    return { nodes, edges, clusters };
  }

  /**
   * Perform incremental update
   */
  public async incrementalUpdate(projectIds: string[]): Promise<number> {
    if (!this.config.incrementalUpdateEnabled) {
      throw new DatasetDiscoveryError(
        'Incremental updates are disabled',
        'INCREMENTAL_DISABLED'
      );
    }

    let updatedCount = 0;
    const client = await this.connectionPool.acquire();

    try {
      for (const projectId of projectIds) {
        const currentDatasets = await this.datasetManager.listDatasets(client, projectId);

        for (const dataset of currentDatasets) {
          const key = this.getDatasetKey(dataset.id, dataset.projectId);
          const existing = this.discoveredDatasets.get(key);

          if (!existing || dataset.modifiedAt > existing.lastUpdatedAt) {
            const enhanced = await this.enhanceDatasetMetadata(dataset, client);

            if (existing) {
              enhanced.updateCount = existing.updateCount + 1;
            }

            this.discoveredDatasets.set(key, enhanced);
            updatedCount++;
          }
        }
      }

      this.stats.lastIncrementalUpdate = new Date();
      this.emit('incremental:completed', { updatedCount });

      return updatedCount;
    } finally {
      this.connectionPool.release(client);
    }
  }

  /**
   * Track access pattern
   */
  public trackAccess(datasetId: string, projectId: string, userId: string, durationMs: number): void {
    if (!this.config.trackAccessPatterns) {
      return;
    }

    const key = this.getDatasetKey(datasetId, projectId);
    const dataset = this.discoveredDatasets.get(key);

    if (dataset) {
      dataset.accessPattern.totalAccesses++;
      dataset.accessPattern.uniqueUsers.add(userId);
      dataset.accessPattern.lastAccessedAt = new Date();
      dataset.accessPattern.peakAccessTimes.push(new Date());

      // Update average query duration
      const currentTotal = dataset.accessPattern.averageQueryDurationMs *
        (dataset.accessPattern.totalAccesses - 1);
      dataset.accessPattern.averageQueryDurationMs =
        (currentTotal + durationMs) / dataset.accessPattern.totalAccesses;

      // Recalculate access frequency
      dataset.accessPattern.accessFrequency = this.calculateAccessFrequency(
        dataset.accessPattern.totalAccesses
      );

      // Recalculate popularity score
      dataset.popularityScore = this.calculatePopularityScore(dataset, dataset.accessPattern);

      this.emit('access:tracked', { datasetId, projectId, userId });
    }
  }

  // ===== Private Helper Methods =====

  private getDatasetKey(datasetId: string, projectId: string): string {
    return `${projectId}:${datasetId}`;
  }

  private shouldIncludeDataset(dataset: DiscoveredDataset): boolean {
    // Region filters
    if (this.config.includeRegions && this.config.includeRegions.length > 0) {
      if (!this.config.includeRegions.includes(dataset.location)) {
        return false;
      }
    }

    if (this.config.excludeRegions && this.config.excludeRegions.length > 0) {
      if (this.config.excludeRegions.includes(dataset.location)) {
        return false;
      }
    }

    // Label filters
    if (this.config.includeLabels && dataset.labels) {
      const hasRequiredLabels = Object.entries(this.config.includeLabels).every(
        ([key, value]) => dataset.labels![key] === value
      );
      if (!hasRequiredLabels) {
        return false;
      }
    }

    if (this.config.excludeLabels && dataset.labels) {
      const hasExcludedLabels = Object.entries(this.config.excludeLabels).some(
        ([key, value]) => dataset.labels![key] === value
      );
      if (hasExcludedLabels) {
        return false;
      }
    }

    return true;
  }

  private extractKeywords(dataset: DatasetMetadata): string[] {
    const keywords = new Set<string>();

    // Dataset ID and project
    keywords.add(dataset.id.toLowerCase());
    keywords.add(dataset.projectId.toLowerCase());

    // Description words
    if (dataset.description) {
      const words = dataset.description.toLowerCase().split(/\W+/);
      words.forEach(word => {
        if (word.length > 3) {
          keywords.add(word);
        }
      });
    }

    // Labels
    if (dataset.labels) {
      Object.entries(dataset.labels).forEach(([key, value]) => {
        keywords.add(key.toLowerCase());
        keywords.add(value.toLowerCase());
      });
    }

    // Table names
    dataset.tables.forEach(table => {
      keywords.add(table.id.toLowerCase());
    });

    return Array.from(keywords);
  }

  private buildSearchableText(dataset: DatasetMetadata): string {
    const parts = [
      dataset.id,
      dataset.projectId,
      dataset.location,
      dataset.description || '',
    ];

    if (dataset.labels) {
      parts.push(JSON.stringify(dataset.labels));
    }

    dataset.tables.forEach(table => {
      parts.push(table.id);
    });

    return parts.join(' ').toLowerCase();
  }

  private calculateAccessFrequency(accessCount: number): AccessPattern['accessFrequency'] {
    if (accessCount > 1000) return 'VERY_HIGH';
    if (accessCount > 100) return 'HIGH';
    if (accessCount > 10) return 'MEDIUM';
    if (accessCount > 0) return 'LOW';
    return 'VERY_LOW';
  }

  private calculatePopularityScore(
    dataset: DatasetMetadata,
    accessPattern: AccessPattern
  ): number {
    // Weighted scoring: access count (40%), table count (20%), size (20%), recency (20%)
    const accessScore = Math.min(accessPattern.totalAccesses / 100, 1) * 40;
    const tableScore = Math.min(dataset.tableCount / 50, 1) * 20;
    const sizeScore = Math.min(dataset.tables.reduce((s, t) => s + (t.numBytes || 0), 0) / (1024 ** 4), 1) * 20;

    const daysSinceAccess = (Date.now() - accessPattern.lastAccessedAt.getTime()) / (1000 * 60 * 60 * 24);
    const recencyScore = Math.max(0, 1 - daysSinceAccess / 365) * 20;

    return Math.round(accessScore + tableScore + sizeScore + recencyScore);
  }

  private buildSearchIndex(datasets: DiscoveredDataset[]): void {
    this.searchIndex.clear();

    for (const dataset of datasets) {
      const key = this.getDatasetKey(dataset.id, dataset.projectId);

      for (const keyword of dataset.keywords) {
        if (!this.searchIndex.has(keyword)) {
          this.searchIndex.set(keyword, new Set());
        }
        this.searchIndex.get(keyword)!.add(key);
      }
    }

    this.stats.indexedKeywords = this.searchIndex.size;
    this.emit('index:built', { keywordCount: this.stats.indexedKeywords });
  }

  private async buildRelationshipGraph(datasets: DiscoveredDataset[]): Promise<void> {
    this.relationshipGraph.clear();

    // Find relationships based on table references, similar schemas, etc.
    for (let i = 0; i < datasets.length; i++) {
      const dataset1 = datasets[i];
      const key1 = this.getDatasetKey(dataset1.id, dataset1.projectId);

      for (let j = i + 1; j < datasets.length; j++) {
        const dataset2 = datasets[j];
        const key2 = this.getDatasetKey(dataset2.id, dataset2.projectId);

        const relationships = this.findRelationships(dataset1, dataset2);

        if (relationships.length > 0) {
          if (!this.relationshipGraph.has(key1)) {
            this.relationshipGraph.set(key1, new Set());
          }
          if (!this.relationshipGraph.has(key2)) {
            this.relationshipGraph.set(key2, new Set());
          }

          relationships.forEach(rel => {
            this.relationshipGraph.get(key1)!.add({
              ...rel,
              datasetId: dataset2.id,
              projectId: dataset2.projectId,
            });

            this.relationshipGraph.get(key2)!.add({
              ...rel,
              datasetId: dataset1.id,
              projectId: dataset1.projectId,
            });
          });
        }
      }
    }

    this.stats.relationshipCount = Array.from(this.relationshipGraph.values())
      .reduce((sum, rels) => sum + rels.size, 0);

    this.emit('relationships:built', { relationshipCount: this.stats.relationshipCount });
  }

  private findRelationships(
    dataset1: DiscoveredDataset,
    dataset2: DiscoveredDataset
  ): Array<Omit<DatasetRelationship, 'datasetId' | 'projectId'>> {
    const relationships: Array<Omit<DatasetRelationship, 'datasetId' | 'projectId'>> = [];

    // Check for shared labels
    if (dataset1.labels && dataset2.labels) {
      const sharedLabels = Object.keys(dataset1.labels).filter(
        key => dataset2.labels![key] === dataset1.labels![key]
      );

      if (sharedLabels.length > 0) {
        relationships.push({
          relationshipType: 'SIMILAR',
          strength: sharedLabels.length / Math.max(
            Object.keys(dataset1.labels).length,
            Object.keys(dataset2.labels).length
          ),
          discoveredAt: new Date(),
        });
      }
    }

    // Check for table name similarities
    const table1Names = new Set(dataset1.tables.map(t => t.id.toLowerCase()));
    const table2Names = new Set(dataset2.tables.map(t => t.id.toLowerCase()));
    const sharedTableNames = Array.from(table1Names).filter(name => table2Names.has(name));

    if (sharedTableNames.length > 0) {
      relationships.push({
        relationshipType: 'SHARED_TABLES',
        strength: sharedTableNames.length / Math.max(table1Names.size, table2Names.size),
        discoveredAt: new Date(),
      });
    }

    return relationships;
  }

  private applyFilters(datasets: DiscoveredDataset[], query: SearchQuery): DiscoveredDataset[] {
    return datasets.filter(dataset => {
      // Label filter
      if (query.labels) {
        if (!dataset.labels) return false;
        const matches = Object.entries(query.labels).every(
          ([key, value]) => dataset.labels![key] === value
        );
        if (!matches) return false;
      }

      // Region filter
      if (query.regions && query.regions.length > 0) {
        if (!query.regions.includes(dataset.location)) return false;
      }

      // Project filter
      if (query.projects && query.projects.length > 0) {
        if (!query.projects.includes(dataset.projectId)) return false;
      }

      // Size filters
      if (query.minSize !== undefined && dataset.totalSizeBytes < query.minSize) {
        return false;
      }
      if (query.maxSize !== undefined && dataset.totalSizeBytes > query.maxSize) {
        return false;
      }

      // Date filters
      if (query.createdAfter && dataset.createdAt < query.createdAfter) {
        return false;
      }
      if (query.createdBefore && dataset.createdAt > query.createdBefore) {
        return false;
      }

      // Description filter
      if (query.hasDescription !== undefined) {
        const hasDesc = !!dataset.description;
        if (hasDesc !== query.hasDescription) return false;
      }

      return true;
    });
  }

  private performTextSearch(
    datasets: DiscoveredDataset[],
    searchText: string
  ): Array<{ dataset: DiscoveredDataset; score: number; matchedFields: string[]; highlights: Record<string, string[]> }> {
    const terms = searchText.toLowerCase().split(/\W+/).filter(t => t.length > 2);
    const results: Array<{ dataset: DiscoveredDataset; score: number; matchedFields: string[]; highlights: Record<string, string[]> }> = [];

    for (const dataset of datasets) {
      let score = 0;
      const matchedFields: string[] = [];
      const highlights: Record<string, string[]> = {};

      // Search in dataset ID (high weight)
      if (dataset.id.toLowerCase().includes(searchText.toLowerCase())) {
        score += 10;
        matchedFields.push('id');
        highlights.id = [dataset.id];
      }

      // Search in description (medium weight)
      if (dataset.description) {
        const matches = terms.filter(term =>
          dataset.description!.toLowerCase().includes(term)
        );
        if (matches.length > 0) {
          score += matches.length * 5;
          matchedFields.push('description');
          highlights.description = matches;
        }
      }

      // Search in keywords (low weight)
      const keywordMatches = dataset.keywords.filter(keyword =>
        terms.some(term => keyword.includes(term))
      );
      if (keywordMatches.length > 0) {
        score += keywordMatches.length * 2;
        matchedFields.push('keywords');
        highlights.keywords = keywordMatches;
      }

      // Search in table names
      const tableMatches = dataset.tables.filter(table =>
        terms.some(term => table.id.toLowerCase().includes(term))
      );
      if (tableMatches.length > 0) {
        score += tableMatches.length * 3;
        matchedFields.push('tables');
        highlights.tables = tableMatches.map(t => t.id);
      }

      // Boost by popularity
      score *= (1 + dataset.popularityScore / 200);

      if (score > 0) {
        results.push({ dataset, score, matchedFields, highlights });
      }
    }

    return results.sort((a, b) => b.score - a.score);
  }

  private sortResults(results: SearchResult[], query: SearchQuery): SearchResult[] {
    const sortBy = query.sortBy || 'relevance';
    const sortOrder = query.sortOrder || 'desc';

    const sorted = [...results].sort((a, b) => {
      let comparison = 0;

      switch (sortBy) {
        case 'relevance':
          comparison = a.relevanceScore - b.relevanceScore;
          break;
        case 'name':
          comparison = a.dataset.id.localeCompare(b.dataset.id);
          break;
        case 'size':
          comparison = a.dataset.totalSizeBytes - b.dataset.totalSizeBytes;
          break;
        case 'created':
          comparison = a.dataset.createdAt.getTime() - b.dataset.createdAt.getTime();
          break;
        case 'popularity':
          comparison = a.dataset.popularityScore - b.dataset.popularityScore;
          break;
      }

      return sortOrder === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }

  private updateStats(datasets: DiscoveredDataset[], scanDurationMs: number): void {
    const projectIds = new Set<string>();
    const regions: Record<string, number> = {};
    const labels: Record<string, number> = {};

    let totalTables = 0;
    let totalSize = 0;

    for (const dataset of datasets) {
      projectIds.add(dataset.projectId);
      totalTables += dataset.tableCount;
      totalSize += dataset.totalSizeBytes;

      regions[dataset.location] = (regions[dataset.location] || 0) + 1;

      if (dataset.labels) {
        Object.keys(dataset.labels).forEach(key => {
          labels[key] = (labels[key] || 0) + 1;
        });
      }
    }

    this.stats = {
      totalDatasets: datasets.length,
      totalTables,
      totalSizeBytes: totalSize,
      projectCount: projectIds.size,
      regionDistribution: regions,
      labelDistribution: labels,
      lastFullScan: new Date(),
      lastIncrementalUpdate: this.stats.lastIncrementalUpdate,
      scanDurationMs,
      indexedKeywords: this.stats.indexedKeywords,
      relationshipCount: this.stats.relationshipCount,
    };
  }

  private startAutoDiscovery(): void {
    this.discoveryInterval = setInterval(() => {
      this.emit('auto-discovery:trigger');
    }, this.config.scanIntervalMs);

    this.emit('auto-discovery:started', {
      intervalMs: this.config.scanIntervalMs,
    });
  }

  /**
   * Invalidate cached dataset
   */
  public invalidate(datasetId: string, projectId: string): void {
    const key = this.getDatasetKey(datasetId, projectId);
    this.discoveredDatasets.delete(key);
    this.relationshipGraph.delete(key);
    this.emit('dataset:invalidated', { datasetId, projectId });
  }

  /**
   * Shutdown and cleanup
   */
  public shutdown(): void {
    if (this.discoveryInterval) {
      clearInterval(this.discoveryInterval);
    }

    this.discoveredDatasets.clear();
    this.searchIndex.clear();
    this.relationshipGraph.clear();

    this.emit('shutdown');
  }
}
