/**
 * Multi-Project Manager Usage Examples
 *
 * This file demonstrates various usage patterns for the MultiProjectManager
 */

import {
  MultiProjectManager,
  MultiProjectManagerConfig,
  ProjectConfig,
  PermissionDeniedError,
  QuotaExceededError,
} from '../src/bigquery/index.js';

/**
 * Example 1: Basic Multi-Project Setup
 */
async function basicMultiProjectSetup() {
  console.log('\n=== Example 1: Basic Multi-Project Setup ===\n');

  const config: MultiProjectManagerConfig = {
    projects: [
      {
        projectId: 'analytics-prod',
        displayName: 'Production Analytics',
        priority: 'high',
        enabled: true,
        quotas: {
          maxQueriesPerDay: 10000,
          maxBytesProcessedPerDay: '1000000000000', // 1TB
          maxConcurrentQueries: 50,
        },
      },
      {
        projectId: 'analytics-dev',
        displayName: 'Development Analytics',
        priority: 'medium',
        enabled: true,
      },
      {
        projectId: 'analytics-staging',
        displayName: 'Staging Environment',
        priority: 'low',
        enabled: true,
      },
    ],
    defaultProjectId: 'analytics-prod',
    autoDiscovery: true,
    discoveryIntervalMs: 300000, // 5 minutes
  };

  const manager = new MultiProjectManager(config);

  // List all projects
  const projects = manager.listProjects();
  console.log(`Initialized ${projects.length} projects:`);
  projects.forEach((p) => {
    console.log(`  - ${p.displayName} (${p.projectId}) [${p.priority}]`);
  });

  // Get current project
  const current = manager.getCurrentProject();
  console.log(`\nCurrent project: ${current.displayName}`);

  return manager;
}

/**
 * Example 2: Project Discovery and Permissions
 */
async function projectDiscoveryExample(manager: MultiProjectManager) {
  console.log('\n=== Example 2: Project Discovery and Permissions ===\n');

  // Discover all projects
  console.log('Discovering projects...');
  const discoveries = await manager.discoverProjects();

  discoveries.forEach((result) => {
    console.log(`\nProject: ${result.projectId}`);
    console.log(`  Accessible: ${result.accessible}`);
    console.log(`  Datasets: ${result.datasets.length}`);
    console.log(`  Permissions: ${result.permissions.join(', ')}`);

    if (result.error) {
      console.log(`  Error: ${result.error.message}`);
    }
  });

  // Validate permissions
  try {
    const validation = await manager.validatePermission('analytics-prod', 'query_execution', [
      'bigquery.jobs.create',
      'bigquery.datasets.get',
    ]);

    console.log('\nPermission validation:');
    console.log(`  Has access: ${validation.hasAccess}`);
    console.log(`  Permissions: ${validation.permissions.join(', ')}`);
  } catch (error) {
    if (error instanceof PermissionDeniedError) {
      console.error('Permission denied:', error.details);
    }
  }
}

/**
 * Example 3: Cross-Project Queries
 */
async function crossProjectQueryExample(manager: MultiProjectManager) {
  console.log('\n=== Example 3: Cross-Project Queries ===\n');

  const query = `
    SELECT
      project_id,
      dataset_id,
      COUNT(*) as table_count
    FROM \`region-us.INFORMATION_SCHEMA.TABLES\`
    GROUP BY project_id, dataset_id
    ORDER BY table_count DESC
    LIMIT 10
  `;

  try {
    const results = await manager.executeCrossProjectQuery(query, {
      projectIds: ['analytics-prod', 'analytics-dev', 'analytics-staging'],
      allowPartialResults: true,
    });

    console.log('Cross-project query results:');
    results.forEach((result, projectId) => {
      console.log(`\n${projectId}:`);
      if (result.error) {
        console.log(`  Error: ${result.error.message}`);
      } else {
        console.log(`  Rows: ${result.result.totalRows}`);
        console.log(`  Execution time: ${result.result.executionTimeMs}ms`);
      }
    });
  } catch (error) {
    console.error('Cross-project query failed:', error);
  }
}

/**
 * Example 4: Project Filtering and Selection
 */
function projectFilteringExample(manager: MultiProjectManager) {
  console.log('\n=== Example 4: Project Filtering and Selection ===\n');

  // Filter by priority
  const highPriority = manager.listProjects({ priority: 'high' });
  console.log(`High priority projects: ${highPriority.map((p) => p.displayName).join(', ')}`);

  // Filter by enabled status
  const enabled = manager.listProjects({ enabled: true });
  console.log(`Enabled projects: ${enabled.length}`);

  // Switch projects
  manager.switchProject('analytics-dev');
  const current = manager.getCurrentProject();
  console.log(`\nSwitched to: ${current.displayName}`);

  // Get specific project context
  const prodContext = manager.getProjectContext('analytics-prod');
  console.log(`\nProduction project:`);
  console.log(`  Last accessed: ${prodContext.lastAccessedAt}`);
  console.log(`  Access count: ${prodContext.accessCount}`);
  console.log(`  Quota: ${JSON.stringify(prodContext.quotaUsage, null, 2)}`);
}

/**
 * Example 5: Quota Management
 */
function quotaManagementExample(manager: MultiProjectManager) {
  console.log('\n=== Example 5: Quota Management ===\n');

  // Subscribe to quota events
  manager.on('quota:exceeded', ({ projectId, quotaType, current, limit }) => {
    console.warn(`⚠️  Quota exceeded in ${projectId}:`);
    console.warn(`    Type: ${quotaType}`);
    console.warn(`    Current: ${current}`);
    console.warn(`    Limit: ${limit}`);
  });

  manager.on('quota:reset', ({ projectCount }) => {
    console.log(`✅ Quotas reset for ${projectCount} projects`);
  });

  // Get aggregated metrics
  const metrics = manager.getAggregatedMetrics();
  console.log('Aggregated metrics:');
  console.log(`  Total projects: ${metrics.totalProjects}`);
  console.log(`  Enabled projects: ${metrics.enabledProjects}`);
  console.log(`  Total queries: ${metrics.totalQueries}`);
  console.log(`  Bytes processed: ${metrics.totalBytesProcessed}`);

  // Per-project metrics
  console.log('\nPer-project metrics:');
  metrics.projectMetrics.forEach((pm, projectId) => {
    console.log(`\n  ${projectId}:`);
    console.log(`    Access count: ${pm.accessCount}`);
    console.log(`    Cache hit rate: ${pm.cacheStats.datasets.hitRate.toFixed(2)}`);
    console.log(
      `    Pool utilization: ${pm.poolMetrics.activeConnections}/${pm.poolMetrics.totalConnections}`
    );
  });
}

/**
 * Example 6: Dynamic Project Management
 */
async function dynamicProjectManagementExample(manager: MultiProjectManager) {
  console.log('\n=== Example 6: Dynamic Project Management ===\n');

  // Add new project
  const newProject: ProjectConfig = {
    projectId: 'analytics-test',
    displayName: 'Test Environment',
    priority: 'low',
    enabled: true,
    labels: {
      env: 'test',
      team: 'data-engineering',
    },
  };

  console.log(`Adding new project: ${newProject.displayName}`);
  await manager.addProject(newProject);

  const projects = manager.listProjects();
  console.log(`Total projects after addition: ${projects.length}`);

  // Filter by labels
  const dataEngProjects = manager.listProjects({
    hasLabel: { team: 'data-engineering' },
  });
  console.log(`Data engineering projects: ${dataEngProjects.map((p) => p.displayName).join(', ')}`);

  // Disable project
  console.log('\nDisabling test project...');
  manager.setProjectEnabled('analytics-test', false);

  // Remove project
  console.log('Removing test project...');
  await manager.removeProject('analytics-test');

  const finalCount = manager.listProjects().length;
  console.log(`Final project count: ${finalCount}`);
}

/**
 * Example 7: Event-Driven Monitoring
 */
function eventDrivenMonitoringExample(manager: MultiProjectManager) {
  console.log('\n=== Example 7: Event-Driven Monitoring ===\n');

  // Initialization events
  manager.on('initialization:completed', (data) => {
    console.log(`✅ Initialized ${data.successCount}/${data.totalProjects} projects`);
  });

  // Project switch events
  manager.on('project:switched', ({ from, to }) => {
    console.log(`🔄 Switched from ${from} to ${to}`);
  });

  // Query events
  manager.on('project:query:started', ({ projectId, jobId }) => {
    console.log(`▶️  Query started in ${projectId}: ${jobId}`);
  });

  manager.on('project:query:completed', ({ projectId, executionTimeMs, totalRows }) => {
    console.log(`✅ Query completed in ${projectId}: ${totalRows} rows in ${executionTimeMs}ms`);
  });

  // Cross-project events
  manager.on('cross-project:query:started', ({ projectIds }) => {
    console.log(`🌐 Cross-project query across: ${projectIds.join(', ')}`);
  });

  manager.on('cross-project:query:completed', ({ successCount, projectIds }) => {
    console.log(
      `✅ Cross-project query completed: ${successCount}/${projectIds.length} successful`
    );
  });

  // Discovery events
  manager.on('discovery:started', () => {
    console.log('🔍 Starting project discovery...');
  });

  manager.on('discovery:completed', ({ total, accessible }) => {
    console.log(`✅ Discovery complete: ${accessible}/${total} accessible`);
  });

  // Permission events
  manager.on('permission:cache:hit', ({ projectId }) => {
    console.log(`⚡ Permission cache hit for ${projectId}`);
  });

  manager.on('permission:check:failed', ({ projectId, error }) => {
    console.error(`❌ Permission check failed for ${projectId}:`, error);
  });

  // Error events
  manager.on('project:error', ({ projectId, error }) => {
    console.error(`❌ Error in ${projectId}:`, error);
  });

  console.log('Event listeners configured successfully');
}

/**
 * Example 8: Health Monitoring and Shutdown
 */
async function healthAndShutdownExample(manager: MultiProjectManager) {
  console.log('\n=== Example 8: Health Monitoring and Shutdown ===\n');

  // Check health
  console.log(`Manager health status: ${manager.isHealthy() ? 'Healthy ✅' : 'Unhealthy ❌'}`);

  // Get detailed metrics
  const metrics = manager.getAggregatedMetrics();
  console.log('\nHealth metrics:');
  console.log(`  Total projects: ${metrics.totalProjects}`);
  console.log(`  Enabled projects: ${metrics.enabledProjects}`);
  console.log(`  Total queries executed: ${metrics.totalQueries}`);

  // Graceful shutdown
  console.log('\nInitiating graceful shutdown...');

  manager.on('shutdown:started', () => {
    console.log('🔄 Shutdown started...');
  });

  manager.on('shutdown:completed', () => {
    console.log('✅ Shutdown completed successfully');
  });

  await manager.shutdown();

  console.log(`Post-shutdown health: ${manager.isHealthy() ? 'Healthy' : 'Offline'}`);
}

/**
 * Main execution
 */
async function main() {
  console.log('='.repeat(80));
  console.log('Multi-Project Manager Usage Examples');
  console.log('='.repeat(80));

  try {
    // Example 1: Basic setup
    const manager = await basicMultiProjectSetup();

    // Example 2: Discovery and permissions
    await projectDiscoveryExample(manager);

    // Example 3: Cross-project queries
    await crossProjectQueryExample(manager);

    // Example 4: Project filtering
    projectFilteringExample(manager);

    // Example 5: Quota management
    quotaManagementExample(manager);

    // Example 6: Dynamic management
    await dynamicProjectManagementExample(manager);

    // Example 7: Event monitoring
    eventDrivenMonitoringExample(manager);

    // Example 8: Health and shutdown
    await healthAndShutdownExample(manager);
  } catch (error) {
    console.error('Error in examples:', error);
    process.exit(1);
  }
}

// Run examples if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export {
  basicMultiProjectSetup,
  projectDiscoveryExample,
  crossProjectQueryExample,
  projectFilteringExample,
  quotaManagementExample,
  dynamicProjectManagementExample,
  eventDrivenMonitoringExample,
  healthAndShutdownExample,
};
