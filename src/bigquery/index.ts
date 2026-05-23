/**
 * BigQuery Module
 *
 * Exports all BigQuery-related components:
 * - Client for database operations
 * - QueryCache for result caching
 * - QueryOptimizer for query optimization
 * - QueryMetricsTracker for performance monitoring
 * - DatasetDiscovery for dataset search and discovery
 */

export {
  BigQueryClient,
  BigQueryClientConfig,
  BigQueryClientConfigSchema,
  QueryResult,
  QueryOptions,
  BigQueryClientError,
} from './client.js';
export { QueryCache, QueryCacheConfig, CacheStats } from './query-cache.js';
export {
  QueryOptimizer,
  QueryOptimizerConfig,
  ValidationResult,
  CostEstimate,
  QueryPlan,
  QueryStage,
  OptimizationSuggestion,
} from './query-optimizer.js';
export {
  QueryMetricsTracker,
  QueryMetricsConfig,
  QueryMetrics,
  QueryStats,
  UsagePattern,
} from './query-metrics.js';
export {
  DatasetDiscovery,
  DatasetDiscoveryConfig,
  DatasetDiscoveryConfigSchema,
  DiscoveredDataset,
  DatasetRelationship,
  AccessPattern,
  SearchQuery,
  SearchResult,
  DiscoveryStats,
  RelationshipGraph,
  GraphNode,
  GraphEdge,
  DatasetCluster,
  DatasetDiscoveryError,
} from './dataset-discovery.js';
export {
  ConnectionPool,
  ConnectionPoolConfig,
  PoolMetrics,
  ConnectionPoolError,
} from './connection-pool.js';
export {
  DatasetManager,
  DatasetManagerConfig,
  DatasetMetadata,
  TableMetadata,
  DatasetManagerError,
} from './dataset-manager.js';
export {
  MultiProjectManager,
  MultiProjectManagerConfig,
  ProjectConfig,
  ProjectContext,
  QuotaUsage,
  PermissionValidationResult,
  ProjectDiscoveryResult,
  CrossProjectQueryOptions,
  MultiProjectManagerError,
  ProjectNotFoundError,
  PermissionDeniedError,
  QuotaExceededError,
} from './multi-project-manager.js';
