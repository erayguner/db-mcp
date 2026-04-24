# Multi-Project Manager for BigQuery

Enterprise-grade multi-project dataset connection manager for the BigQuery MCP server, supporting concurrent connections
to multiple GCP projects with advanced features.

## Features

### 🚀 Core Capabilities

- **Multi-Project Support**: Manage multiple GCP projects simultaneously
- **Automatic Discovery**: Auto-discover projects, datasets, and tables
- **Permission Validation**: Project-specific permission checking with caching
- **Quota Management**: Track and enforce resource quotas per project
- **Cross-Project Queries**: Execute queries across multiple projects
- **Project Context Switching**: Seamless switching between project contexts
- **Connection Pooling**: Dedicated connection pools per project
- **Comprehensive Error Handling**: Detailed error types and recovery

### 🔐 Security & Permissions

- IAM permission validation before operations
- Cached permission results with TTL
- Per-project permission isolation
- Support for Workload Identity Federation (WIF)

### 📊 Resource Management

- Per-project quota tracking
- Concurrent query limits
- Bytes processed monitoring
- Daily quota resets
- Resource usage metrics

## Installation

```bash
npm install @your-org/bigquery-mcp-server
```

## Configuration

### Basic Configuration

```typescript
import { MultiProjectManager } from './bigquery/multi-project-manager';

const config = {
  projects: [
    {
      projectId: 'my-production-project',
      displayName: 'Production',
      priority: 'high',
      enabled: true,
      quotas: {
        maxQueriesPerDay: 10000,
        maxBytesProcessedPerDay: '1000000000000', // 1TB
        maxConcurrentQueries: 50,
      },
    },
    {
      projectId: 'my-dev-project',
      displayName: 'Development',
      priority: 'medium',
      enabled: true,
    },
  ],
  defaultProjectId: 'my-production-project',
  autoDiscovery: true,
  discoveryIntervalMs: 300000, // 5 minutes
};

const manager = new MultiProjectManager(config);
```

### Advanced Configuration

```typescript
const advancedConfig = {
  projects: [
    {
      projectId: 'project-1',
      keyFilename: '/path/to/credentials.json',
      location: 'EU',
      labels: { env: 'prod', team: 'data' },
      priority: 'high',
      enabled: true,
    },
  ],
  connectionPool: {
    minConnectionsPerProject: 2,
    maxConnectionsPerProject: 10,
    acquireTimeoutMs: 30000,
    idleTimeoutMs: 300000,
  },
  datasetManager: {
    cacheSize: 100,
    cacheTTLMs: 3600000, // 1 hour
  },
  crossProjectQueries: {
    enabled: true,
    maxProjects: 5,
  },
  permissionValidation: {
    enabled: true,
    cacheValidationResults: true,
    validationTTLMs: 300000, // 5 minutes
  },
};

const manager = new MultiProjectManager(advancedConfig);
```

## Usage Examples

### Project Management

#### List Projects

```typescript
// List all projects
const allProjects = manager.listProjects();

// Filter by enabled status
const enabledProjects = manager.listProjects({ enabled: true });

// Filter by priority
const highPriorityProjects = manager.listProjects({ priority: 'high' });

// Filter by labels
const prodProjects = manager.listProjects({
  hasLabel: { env: 'prod' },
});
```

#### Switch Projects

```typescript
// Switch to a different project
manager.switchProject('my-dev-project');

// Get current project
const currentProject = manager.getCurrentProject();
console.log(currentProject.projectId); // 'my-dev-project'

// Get specific project context
const prodContext = manager.getProjectContext('my-production-project');
```

### Discovery

#### Discover All Projects

```typescript
const discoveries = await manager.discoverProjects();

discoveries.forEach((result) => {
  console.log(`Project: ${result.projectId}`);
  console.log(`Accessible: ${result.accessible}`);
  console.log(`Datasets: ${result.datasets.length}`);
  console.log(`Permissions: ${result.permissions.join(', ')}`);
});
```

### Permission Validation

```typescript
// Validate permissions before operations
try {
  const validation = await manager.validatePermission('my-project', 'query_execution', [
    'bigquery.jobs.create',
    'bigquery.datasets.get',
  ]);

  if (validation.hasAccess) {
    // Proceed with operation
  }
} catch (error) {
  if (error instanceof PermissionDeniedError) {
    console.error('Missing permissions:', error.details.missingPermissions);
  }
}
```

### Cross-Project Queries

```typescript
// Execute query across multiple projects
const query = `
  SELECT
    project_id,
    COUNT(*) as record_count
  FROM dataset.table
  GROUP BY project_id
`;

const results = await manager.executeCrossProjectQuery(query, {
  projectIds: ['project-1', 'project-2', 'project-3'],
  allowPartialResults: true,
});

// Process results per project
results.forEach((result, projectId) => {
  if (result.error) {
    console.error(`Error in ${projectId}:`, result.error);
  } else {
    console.log(`Results from ${projectId}:`, result.rows);
  }
});
```

### Dynamic Project Management

```typescript
// Add project dynamically
await manager.addProject({
  projectId: 'new-project',
  displayName: 'New Analytics Project',
  priority: 'medium',
  enabled: true,
});

// Remove project
await manager.removeProject('old-project');

// Enable/disable project
manager.setProjectEnabled('project-id', false);
```

### Metrics and Monitoring

```typescript
// Get aggregated metrics
const metrics = manager.getAggregatedMetrics();

console.log('Total Projects:', metrics.totalProjects);
console.log('Enabled Projects:', metrics.enabledProjects);
console.log('Total Queries:', metrics.totalQueries);
console.log('Bytes Processed:', metrics.totalBytesProcessed);

// Per-project metrics
metrics.projectMetrics.forEach((projectMetrics, projectId) => {
  console.log(`\nProject: ${projectId}`);
  console.log('Access Count:', projectMetrics.accessCount);
  console.log('Last Accessed:', projectMetrics.lastAccessed);
  console.log('Quota:', projectMetrics.quota);
  console.log('Pool Metrics:', projectMetrics.poolMetrics);
  console.log('Cache Stats:', projectMetrics.cacheStats);
});
```

### Event Handling

```typescript
// Initialization events
manager.on('initialization:completed', (data) => {
  console.log(`Initialized ${data.successCount}/${data.totalProjects} projects`);
});

// Project events
manager.on('project:switched', ({ from, to }) => {
  console.log(`Switched from ${from} to ${to}`);
});

manager.on('project:added', ({ projectId }) => {
  console.log(`Added project: ${projectId}`);
});

// Query events
manager.on('project:query:started', ({ projectId, jobId }) => {
  console.log(`Query started in ${projectId}: ${jobId}`);
});

manager.on('project:query:completed', ({ projectId, executionTimeMs }) => {
  console.log(`Query completed in ${projectId} (${executionTimeMs}ms)`);
});

// Cross-project events
manager.on('cross-project:query:started', ({ projectIds, query }) => {
  console.log(`Cross-project query started across: ${projectIds.join(', ')}`);
});

manager.on('cross-project:query:completed', ({ successCount }) => {
  console.log(`Cross-project query completed: ${successCount} successful`);
});

// Quota events
manager.on('quota:exceeded', ({ projectId, quotaType, current, limit }) => {
  console.warn(`Quota exceeded in ${projectId}: ${quotaType} ${current}/${limit}`);
});

manager.on('quota:reset', ({ projectCount }) => {
  console.log(`Quotas reset for ${projectCount} projects`);
});

// Discovery events
manager.on('discovery:started', () => {
  console.log('Starting project discovery...');
});

manager.on('discovery:completed', ({ total, accessible }) => {
  console.log(`Discovery complete: ${accessible}/${total} accessible`);
});

// Permission events
manager.on('permission:cache:hit', ({ projectId }) => {
  console.log(`Permission cache hit for ${projectId}`);
});

manager.on('permission:check:failed', ({ projectId, error }) => {
  console.error(`Permission check failed for ${projectId}:`, error);
});

// Error events
manager.on('project:error', ({ projectId, error }) => {
  console.error(`Error in project ${projectId}:`, error);
});
```

## Error Handling

### Error Types

```typescript
import {
  MultiProjectManagerError,
  ProjectNotFoundError,
  PermissionDeniedError,
  QuotaExceededError,
} from './bigquery/multi-project-manager';

try {
  const context = manager.getProjectContext('unknown-project');
} catch (error) {
  if (error instanceof ProjectNotFoundError) {
    console.error('Project not found:', error.projectId);
  } else if (error instanceof PermissionDeniedError) {
    console.error('Permission denied:', error.details);
  } else if (error instanceof QuotaExceededError) {
    console.error('Quota exceeded:', error.details);
  } else if (error instanceof MultiProjectManagerError) {
    console.error('Manager error:', error.code, error.message);
  }
}
```

### Best Practices

1. **Always validate permissions** before sensitive operations
2. **Monitor quota usage** to avoid hitting limits
3. **Use project priorities** to guide resource allocation
4. **Enable auto-discovery** for dynamic environments
5. **Cache validation results** to reduce overhead
6. **Handle partial results** in cross-project queries
7. **Subscribe to events** for monitoring and alerting

## TypeScript Types

### Core Types

```typescript
interface ProjectConfig {
  projectId: string;
  displayName?: string;
  keyFilename?: string;
  credentials?: any;
  location?: string;
  labels?: Record<string, string>;
  priority: 'high' | 'medium' | 'low';
  enabled: boolean;
  quotas?: {
    maxQueriesPerDay?: number;
    maxBytesProcessedPerDay?: string;
    maxConcurrentQueries?: number;
  };
}

interface ProjectContext {
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

interface QuotaUsage {
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

interface PermissionValidationResult {
  hasAccess: boolean;
  permissions: string[];
  missingPermissions?: string[];
  validatedAt: Date;
  expiresAt: Date;
}

interface ProjectDiscoveryResult {
  projectId: string;
  accessible: boolean;
  datasets: DatasetMetadata[];
  permissions: string[];
  quotas?: QuotaUsage;
  error?: Error;
}

interface CrossProjectQueryOptions {
  projectIds: string[];
  datasetMappings?: Map<string, string>;
  allowPartialResults?: boolean;
}
```

## Performance Considerations

### Connection Pooling

Each project maintains its own connection pool with configurable limits:

- `minConnectionsPerProject`: Minimum active connections (default: 2)
- `maxConnectionsPerProject`: Maximum active connections (default: 10)

### Caching

Multiple levels of caching:

- **Dataset metadata**: 1 hour TTL by default
- **Permission validation**: 5 minutes TTL by default
- **LRU eviction** when cache limits reached

### Auto-Discovery

Auto-discovery runs at configurable intervals (default: 5 minutes) to:

- Update dataset listings
- Refresh permissions
- Monitor quota usage

## Shutdown

Always shutdown gracefully to cleanup resources:

```typescript
// Graceful shutdown
await manager.shutdown();

// Check health status
if (!manager.isHealthy()) {
  console.log('Manager is offline');
}
```

## License

MIT

## Contributing

See [CONTRIBUTING.md](../CONTRIBUTING.md) for guidelines.
