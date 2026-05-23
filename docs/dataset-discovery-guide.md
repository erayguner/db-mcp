# Dataset Discovery and Search System

Enterprise-grade dataset discovery and search system for BigQuery MCP server with cross-project discovery, full-text
search, relationship mapping, and access pattern tracking.

## Features

### Core Capabilities

- **Cross-Project Discovery**: Scan and catalog datasets across multiple GCP projects
- **Full-Text Search**: Fast, relevance-scored search with keyword indexing
- **Advanced Filtering**: Filter by labels, regions, size, dates, and custom criteria
- **Relationship Mapping**: Automatic discovery of dataset relationships and dependencies
- **Access Pattern Tracking**: Monitor usage patterns and popularity metrics
- **Incremental Updates**: Efficient updates for changed datasets only
- **Performance Optimized**: Concurrent scanning with configurable limits

### Search Features

- Text search with relevance scoring
- Multiple sort options (relevance, name, size, created date, popularity)
- Pagination support
- Search result highlighting
- Matched field identification

### Relationship Graph

- Dataset similarity detection
- Shared table identification
- Cluster formation based on labels
- Visual graph representation with nodes and edges
- Relationship strength scoring

### Access Pattern Analysis

- Total access tracking
- Unique user counting
- Access frequency classification
- Peak time identification
- Average query duration
- Popularity scoring

## Installation

The DatasetDiscovery module is part of the BigQuery package:

```typescript
import { DatasetDiscovery, ConnectionPool, DatasetManager, DatasetDiscoveryConfig } from './bigquery';
```

## Quick Start

### Basic Setup

```typescript
import { DatasetDiscovery, ConnectionPool, DatasetManager } from './bigquery';

// Create connection pool
const connectionPool = new ConnectionPool({
  projectId: 'your-project-id',
  minConnections: 2,
  maxConnections: 10,
});

// Create dataset manager
const datasetManager = new DatasetManager({
  cacheSize: 100,
  cacheTTLMs: 3600000,
  autoDiscovery: true,
});

// Create discovery instance
const discovery = new DatasetDiscovery(connectionPool, datasetManager, {
  enableAutoDiscovery: true,
  fullTextIndexing: true,
  buildRelationshipGraph: true,
  trackAccessPatterns: true,
});
```

### Discover Datasets

```typescript
// Discover datasets across multiple projects
const datasets = await discovery.discoverDatasets(['project-1', 'project-2', 'project-3']);

console.log(`Discovered ${datasets.length} datasets`);
```

## Configuration

### Full Configuration Options

```typescript
interface DatasetDiscoveryConfig {
  // Discovery settings
  scanIntervalMs: number; // Auto-discovery interval (default: 300000)
  maxConcurrentScans: number; // Max concurrent project scans (default: 3)
  enableAutoDiscovery: boolean; // Enable auto-discovery (default: true)

  // Search settings
  searchIndexSize: number; // Search index capacity (default: 10000)
  fullTextIndexing: boolean; // Enable full-text indexing (default: true)

  // Filtering settings
  includeRegions?: string[]; // Only include these regions
  excludeRegions?: string[]; // Exclude these regions
  includeLabels?: Record<string, string>; // Only include datasets with these labels
  excludeLabels?: Record<string, string>; // Exclude datasets with these labels

  // Performance settings
  incrementalUpdateEnabled: boolean; // Enable incremental updates (default: true)
  cacheMetadata: boolean; // Cache metadata (default: true)
  metadataTTLMs: number; // Metadata cache TTL (default: 3600000)

  // Relationship settings
  buildRelationshipGraph: boolean; // Build relationship graph (default: true)
  maxRelationshipDepth: number; // Max depth for relationships (default: 3)

  // Access pattern settings
  trackAccessPatterns: boolean; // Track access patterns (default: true)
  accessPatternWindowMs: number; // Access pattern window (default: 86400000)
}
```

### Example Configurations

#### Production Configuration

```typescript
const prodConfig: DatasetDiscoveryConfig = {
  scanIntervalMs: 600000, // 10 minutes
  maxConcurrentScans: 5,
  enableAutoDiscovery: true,
  searchIndexSize: 50000,
  fullTextIndexing: true,
  includeRegions: ['EU'],
  incrementalUpdateEnabled: true,
  cacheMetadata: true,
  metadataTTLMs: 1800000, // 30 minutes
  buildRelationshipGraph: true,
  maxRelationshipDepth: 3,
  trackAccessPatterns: true,
  accessPatternWindowMs: 86400000, // 24 hours
};
```

#### Development Configuration

```typescript
const devConfig: DatasetDiscoveryConfig = {
  scanIntervalMs: 300000, // 5 minutes
  maxConcurrentScans: 2,
  enableAutoDiscovery: false,
  searchIndexSize: 10000,
  fullTextIndexing: true,
  incrementalUpdateEnabled: true,
  cacheMetadata: true,
  metadataTTLMs: 3600000, // 1 hour
  buildRelationshipGraph: false,
  maxRelationshipDepth: 2,
  trackAccessPatterns: false,
  accessPatternWindowMs: 3600000, // 1 hour
};
```

## Usage Examples

### Search Operations

#### Basic Text Search

```typescript
const results = await discovery.search({
  text: 'user analytics',
});

results.forEach((result) => {
  console.log(`Dataset: ${result.dataset.id}`);
  console.log(`Relevance: ${result.relevanceScore}`);
  console.log(`Matched: ${result.matchedFields.join(', ')}`);
  console.log(`Highlights:`, result.highlights);
});
```

#### Advanced Filtering

```typescript
const results = await discovery.search({
  text: 'customer',
  labels: { env: 'prod', team: 'analytics' },
  regions: ['EU'],
  minSize: 1024 * 1024 * 100, // 100MB minimum
  maxSize: 1024 * 1024 * 1024 * 10, // 10GB maximum
  createdAfter: new Date('2024-01-01'),
  hasDescription: true,
  sortBy: 'popularity',
  sortOrder: 'desc',
  limit: 20,
  offset: 0,
});
```

#### Sort by Different Criteria

```typescript
// Sort by relevance (default)
const byRelevance = await discovery.search({
  text: 'analytics',
  sortBy: 'relevance',
  sortOrder: 'desc',
});

// Sort by size
const bySize = await discovery.search({
  sortBy: 'size',
  sortOrder: 'desc',
});

// Sort by creation date
const byDate = await discovery.search({
  sortBy: 'created',
  sortOrder: 'asc',
});

// Sort by popularity
const byPopularity = await discovery.search({
  sortBy: 'popularity',
  sortOrder: 'desc',
});
```

### Dataset Retrieval

#### Get Single Dataset

```typescript
const dataset = discovery.getDataset('my-dataset', 'my-project');

if (dataset) {
  console.log('Dataset Info:');
  console.log(`  ID: ${dataset.id}`);
  console.log(`  Project: ${dataset.projectId}`);
  console.log(`  Location: ${dataset.location}`);
  console.log(`  Size: ${dataset.totalSizeBytes} bytes`);
  console.log(`  Tables: ${dataset.tableCount}`);
  console.log(`  Popularity: ${dataset.popularityScore}/100`);
  console.log(`  Monthly Cost: $${dataset.estimatedMonthlyCost.toFixed(2)}`);
}
```

#### Get All Datasets

```typescript
const allDatasets = discovery.getAllDatasets();

console.log(`Total datasets: ${allDatasets.length}`);
console.log(`Total size: ${allDatasets.reduce((sum, d) => sum + d.totalSizeBytes, 0)} bytes`);
```

### Relationship Graph

#### Get Graph Data

```typescript
const graph = discovery.getRelationshipGraph();

console.log('Graph Structure:');
console.log(`  Nodes: ${graph.nodes.length}`);
console.log(`  Edges: ${graph.edges.length}`);
console.log(`  Clusters: ${graph.clusters.length}`);

// Process nodes
graph.nodes.forEach((node) => {
  console.log(`Dataset: ${node.datasetId} (Popularity: ${node.popularity})`);
});

// Process edges
graph.edges.forEach((edge) => {
  console.log(`Relationship: ${edge.source} -> ${edge.target}`);
  console.log(`  Type: ${edge.type}`);
  console.log(`  Strength: ${edge.strength}`);
});

// Process clusters
graph.clusters.forEach((cluster) => {
  console.log(`Cluster: ${cluster.id}`);
  console.log(`  Datasets: ${cluster.datasets.length}`);
  console.log(`  Labels: ${JSON.stringify(cluster.commonLabels)}`);
  console.log(`  Total Size: ${cluster.totalSize} bytes`);
});
```

### Access Pattern Tracking

#### Track Access

```typescript
// Track dataset access
discovery.trackAccess(
  'my-dataset',
  'my-project',
  'user@example.com',
  1500 // Query duration in ms
);
```

#### Get Access Patterns

```typescript
const dataset = discovery.getDataset('my-dataset', 'my-project');

if (dataset) {
  console.log('Access Pattern:');
  console.log(`  Total Accesses: ${dataset.accessPattern.totalAccesses}`);
  console.log(`  Unique Users: ${dataset.accessPattern.uniqueUsers.size}`);
  console.log(`  Frequency: ${dataset.accessPattern.accessFrequency}`);
  console.log(`  Avg Duration: ${dataset.accessPattern.averageQueryDurationMs}ms`);
  console.log(`  Last Access: ${dataset.accessPattern.lastAccessedAt}`);
}
```

### Incremental Updates

```typescript
// Perform incremental update for specific projects
const updatedCount = await discovery.incrementalUpdate(['project-1', 'project-2']);

console.log(`Updated ${updatedCount} datasets`);
```

### Statistics

```typescript
const stats = discovery.getStats();

console.log('Discovery Statistics:');
console.log(`  Total Datasets: ${stats.totalDatasets}`);
console.log(`  Total Tables: ${stats.totalTables}`);
console.log(`  Total Size: ${stats.totalSizeBytes} bytes`);
console.log(`  Projects: ${stats.projectCount}`);
console.log(`  Last Scan: ${stats.lastFullScan}`);
console.log(`  Scan Duration: ${stats.scanDurationMs}ms`);
console.log(`  Indexed Keywords: ${stats.indexedKeywords}`);
console.log(`  Relationships: ${stats.relationshipCount}`);

console.log('\nRegion Distribution:');
Object.entries(stats.regionDistribution).forEach(([region, count]) => {
  console.log(`  ${region}: ${count} datasets`);
});

console.log('\nLabel Distribution:');
Object.entries(stats.labelDistribution).forEach(([label, count]) => {
  console.log(`  ${label}: ${count} datasets`);
});
```

### Event Handling

```typescript
// Listen to discovery events
discovery.on('discovery:started', ({ projectIds }) => {
  console.log('Starting discovery for:', projectIds);
});

discovery.on('discovery:completed', ({ datasetsDiscovered, durationMs }) => {
  console.log(`Discovered ${datasetsDiscovered} datasets in ${durationMs}ms`);
});

discovery.on('project:discovered', ({ projectId, datasetCount }) => {
  console.log(`Project ${projectId}: ${datasetCount} datasets`);
});

// Listen to search events
discovery.on('search:completed', ({ query, totalResults, returnedResults }) => {
  console.log(`Search returned ${returnedResults}/${totalResults} results`);
});

// Listen to access tracking events
discovery.on('access:tracked', ({ datasetId, projectId, userId }) => {
  console.log(`Access tracked: ${projectId}.${datasetId} by ${userId}`);
});

// Listen to index events
discovery.on('index:built', ({ keywordCount }) => {
  console.log(`Search index built with ${keywordCount} keywords`);
});

// Listen to relationship events
discovery.on('relationships:built', ({ relationshipCount }) => {
  console.log(`Built ${relationshipCount} dataset relationships`);
});
```

### Cache Management

```typescript
// Invalidate specific dataset
discovery.invalidate('my-dataset', 'my-project');

// The dataset will be re-discovered on next scan
```

## Integration with Existing Systems

### Integration with MultiProjectManager

```typescript
import { MultiProjectManager } from './multi-project-manager';

const multiProjectManager = new MultiProjectManager({
  projects: [
    { projectId: 'project-1', credentials: {...} },
    { projectId: 'project-2', credentials: {...} }
  ]
});

// Get all project IDs
const projectIds = multiProjectManager.getProjectIds();

// Discover datasets across all managed projects
const datasets = await discovery.discoverDatasets(projectIds);
```

### Integration with DatasetManager Cache

The DatasetDiscovery system automatically leverages the DatasetManager's caching:

```typescript
// DatasetManager caches metadata
const datasetManager = new DatasetManager({
  cacheSize: 100,
  cacheTTLMs: 3600000,
  autoDiscovery: true,
});

// Discovery uses cached data when available
const discovery = new DatasetDiscovery(connectionPool, datasetManager, { cacheMetadata: true });
```

### Integration with ConnectionPool

```typescript
// Discovery automatically acquires and releases connections
const connectionPool = new ConnectionPool({
  minConnections: 2,
  maxConnections: 10,
  acquireTimeoutMs: 30000,
});

// No need to manage connections manually
const discovery = new DatasetDiscovery(connectionPool, datasetManager);

// Discovery handles connection lifecycle internally
const datasets = await discovery.discoverDatasets(['project-1']);
```

## Performance Optimization

### Best Practices

1. **Use Incremental Updates**

   ```typescript
   // Full scan on startup
   await discovery.discoverDatasets(projectIds);

   // Use incremental updates for changes
   setInterval(async () => {
     await discovery.incrementalUpdate(projectIds);
   }, 300000); // Every 5 minutes
   ```

2. **Configure Concurrent Scans**

   ```typescript
   const config = {
     maxConcurrentScans: 5, // Scan 5 projects at once
     scanIntervalMs: 600000, // 10 minute intervals
   };
   ```

3. **Enable Caching**

   ```typescript
   const config = {
     cacheMetadata: true,
     metadataTTLMs: 1800000, // 30 minute cache
   };
   ```

4. **Filter Early**
   ```typescript
   const config = {
     includeRegions: ['EU'], // Only scan EU datasets
     includeLabels: { env: 'prod' }, // Only production
   };
   ```

### Scaling Recommendations

| Dataset Count | Config Recommendations                                  |
| ------------- | ------------------------------------------------------- |
| < 100         | maxConcurrentScans: 2, scanIntervalMs: 300000           |
| 100-1000      | maxConcurrentScans: 3, scanIntervalMs: 600000           |
| 1000-10000    | maxConcurrentScans: 5, scanIntervalMs: 900000           |
| > 10000       | maxConcurrentScans: 8, use filters, incremental updates |

## Error Handling

```typescript
try {
  const datasets = await discovery.discoverDatasets(projectIds);
} catch (error) {
  if (error.code === 'SCAN_IN_PROGRESS') {
    console.log('Discovery already running, please wait');
  } else if (error.code === 'DISCOVERY_ERROR') {
    console.error('Discovery failed:', error.message);
    console.error('Details:', error.details);
  }
}
```

## Shutdown

```typescript
// Clean shutdown
discovery.shutdown();
connectionPool.shutdown();
datasetManager.shutdown();
```

## API Reference

### Main Methods

- `discoverDatasets(projectIds: string[]): Promise<DiscoveredDataset[]>`
- `search(query: SearchQuery): Promise<SearchResult[]>`
- `getDataset(datasetId: string, projectId: string): DiscoveredDataset | null`
- `getAllDatasets(): DiscoveredDataset[]`
- `getStats(): DiscoveryStats`
- `getRelationshipGraph(): RelationshipGraph`
- `incrementalUpdate(projectIds: string[]): Promise<number>`
- `trackAccess(datasetId: string, projectId: string, userId: string, durationMs: number): void`
- `invalidate(datasetId: string, projectId: string): void`
- `shutdown(): void`

### Events

- `discovery:started` - Discovery scan started
- `discovery:completed` - Discovery scan completed
- `project:discovered` - Project scan completed
- `project:error` - Project scan error
- `search:completed` - Search completed
- `access:tracked` - Access tracked
- `index:built` - Search index built
- `relationships:built` - Relationship graph built
- `dataset:invalidated` - Dataset cache invalidated
- `auto-discovery:started` - Auto-discovery enabled
- `auto-discovery:trigger` - Auto-discovery triggered
- `incremental:completed` - Incremental update completed
- `shutdown` - System shutdown

## Examples

See `/examples/dataset-discovery-examples.ts` for complete working examples.

## Testing

```bash
npm test src/tests/bigquery/dataset-discovery.test.ts
```

## License

MIT
