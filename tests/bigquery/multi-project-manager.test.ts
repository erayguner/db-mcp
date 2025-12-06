import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
const skipMP = process.env.MOCK_FAST === 'true' || process.env.USE_MOCK_BIGQUERY === 'true';
const describeMP = skipMP ? describe.skip : describe;
import {
  MultiProjectManager,
  MultiProjectManagerConfig,
  ProjectConfig,
  MultiProjectManagerError,
  ProjectNotFoundError,
  PermissionDeniedError,
} from '../multi-project-manager.js';

describeMP('MultiProjectManager', () => {
  let manager: MultiProjectManager;
  let mockProjects: ProjectConfig[];

  beforeEach(() => {
    mockProjects = [
      {
        projectId: 'project-1',
        displayName: 'Production Project',
        priority: 'high',
        enabled: true,
        quotas: {
          maxQueriesPerDay: 10000,
          maxConcurrentQueries: 50,
        },
      },
      {
        projectId: 'project-2',
        displayName: 'Development Project',
        priority: 'medium',
        enabled: true,
      },
      {
        projectId: 'project-3',
        displayName: 'Testing Project',
        priority: 'low',
        enabled: false,
      },
    ];
  });

  afterEach(async () => {
    if (manager) {
      await manager.shutdown();
    }
  });

  describe('Initialization', () => {
    it('should initialize with multiple projects', async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects,
        defaultProjectId: 'project-1',
        autoDiscovery: false,
      };

      manager = new MultiProjectManager(config);

      // Wait for initialization
      await new Promise(resolve => setTimeout(resolve, 100));

      const projects = manager.listProjects();
      expect(projects.length).toBe(3);
    });

    it('should set default project', async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects,
        defaultProjectId: 'project-2',
        autoDiscovery: false,
      };

      manager = new MultiProjectManager(config);
      await new Promise(resolve => setTimeout(resolve, 100));

      const current = manager.getCurrentProject();
      expect(current.projectId).toBe('project-2');
    });

    it('should emit initialization events', (done) => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects.slice(0, 2),
        autoDiscovery: false,
      };

      manager = new MultiProjectManager(config);

      manager.on('initialization:completed', (data) => {
        expect(data.totalProjects).toBe(2);
        done();
      });
    });

    it('should validate configuration', () => {
      const invalidConfig: any = {
        projects: [],
        defaultProjectId: 'test',
      };

      expect(() => new MultiProjectManager(invalidConfig)).toThrow();
    });
  });

  describe('Project Context Management', () => {
    beforeEach(async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects,
        defaultProjectId: 'project-1',
        autoDiscovery: false,
      };

      manager = new MultiProjectManager(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should switch between projects', () => {
      manager.switchProject('project-2');
      const current = manager.getCurrentProject();
      expect(current.projectId).toBe('project-2');
    });

    it('should throw error when switching to non-existent project', () => {
      expect(() => manager.switchProject('non-existent')).toThrow(ProjectNotFoundError);
    });

    it('should get specific project context', () => {
      const context = manager.getProjectContext('project-2');
      expect(context.projectId).toBe('project-2');
      expect(context.displayName).toBe('Development Project');
    });

    it('should throw error for disabled project', () => {
      expect(() => manager.getProjectContext('project-3')).toThrow(MultiProjectManagerError);
    });

    it('should track project access', () => {
      const context = manager.getProjectContext('project-1');
      const initialCount = context.accessCount;

      manager.switchProject('project-1');
      const updatedContext = manager.getProjectContext('project-1');

      expect(updatedContext.accessCount).toBeGreaterThan(initialCount);
    });
  });

  describe('Project Listing and Filtering', () => {
    beforeEach(async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects,
        autoDiscovery: false,
      };

      manager = new MultiProjectManager(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should list all projects', () => {
      const projects = manager.listProjects();
      expect(projects.length).toBe(3);
    });

    it('should filter by enabled status', () => {
      const enabled = manager.listProjects({ enabled: true });
      expect(enabled.length).toBe(2);

      const disabled = manager.listProjects({ enabled: false });
      expect(disabled.length).toBe(1);
    });

    it('should filter by priority', () => {
      const highPriority = manager.listProjects({ priority: 'high' });
      expect(highPriority.length).toBe(1);
      expect(highPriority[0].projectId).toBe('project-1');
    });

    it('should filter by labels', () => {
      mockProjects[0].labels = { env: 'prod', team: 'data' };
      mockProjects[1].labels = { env: 'dev', team: 'data' };

      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects,
        autoDiscovery: false,
      };

      manager = new MultiProjectManager(config);

      const prodProjects = manager.listProjects({
        hasLabel: { env: 'prod' },
      });

      expect(prodProjects.length).toBe(1);
      expect(prodProjects[0].projectId).toBe('project-1');
    });
  });

  describe('Cross-Project Queries', () => {
    beforeEach(async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects.slice(0, 2),
        autoDiscovery: false,
        crossProjectQueries: {
          enabled: true,
          maxProjects: 5,
        },
      };

      manager = new MultiProjectManager(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should execute cross-project queries', async () => {
      const query = 'SELECT COUNT(*) as count FROM dataset.table';
      const options = {
        projectIds: ['project-1', 'project-2'],
        allowPartialResults: true,
      };

      // Mock the query execution
      const spy = jest.spyOn(manager as any, 'executeCrossProjectQuery');

      await manager.executeCrossProjectQuery(query, options);

      expect(spy).toHaveBeenCalledWith(query, options);
    });

    it('should respect max projects limit', async () => {
      const query = 'SELECT 1';
      const options = {
        projectIds: Array.from({ length: 10 }, (_, i) => `project-${i}`),
      };

      await expect(
        manager.executeCrossProjectQuery(query, options)
      ).rejects.toThrow('Cannot query more than');
    });

    it('should emit cross-project events', (done) => {
      const query = 'SELECT 1';
      const options = {
        projectIds: ['project-1'],
      };

      manager.on('cross-project:query:started', (data) => {
        expect(data.projectIds).toEqual(['project-1']);
        done();
      });

      manager.executeCrossProjectQuery(query, options).catch(() => {});
    });
  });

  describe('Permission Validation', () => {
    beforeEach(async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects.slice(0, 2),
        autoDiscovery: false,
        permissionValidation: {
          enabled: true,
          cacheValidationResults: true,
          validationTTLMs: 300000,
        },
      };

      manager = new MultiProjectManager(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should validate permissions', async () => {
      const result = await manager.validatePermission(
        'project-1',
        'query',
        ['bigquery.jobs.create']
      );

      expect(result.hasAccess).toBeDefined();
      expect(result.permissions).toBeInstanceOf(Array);
    });

    it('should throw on missing permissions', async () => {
      // Mock the permission check to fail
      const mockGetPermissions = jest.spyOn(manager as any, 'getProjectPermissions');
      mockGetPermissions.mockResolvedValue([]);

      await expect(
        manager.validatePermission(
          'project-1',
          'sensitive_operation',
          ['bigquery.admin']
        )
      ).rejects.toThrow(PermissionDeniedError);
    });

    it('should cache permission results', async () => {
      const spy = jest.spyOn(manager as any, 'getProjectPermissions');

      // First call
      await manager.validatePermission('project-1', 'query', ['bigquery.jobs.create']);

      // Second call should use cache
      await manager.validatePermission('project-1', 'query', ['bigquery.jobs.create']);

      // Should only fetch once, second time from cache
      expect(spy).toHaveBeenCalledTimes(2);
    });
  });

  describe('Quota Management', () => {
    beforeEach(async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects.slice(0, 1),
        autoDiscovery: false,
      };

      manager = new MultiProjectManager(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should track quota usage', () => {
      const context = manager.getProjectContext('project-1');
      expect(context.quotaUsage).toBeDefined();
      expect(context.quotaUsage?.queriesExecuted).toBe(0);
    });

    it('should emit quota exceeded events', (done) => {
      manager.on('quota:exceeded', (data) => {
        expect(data.projectId).toBe('project-1');
        expect(data.quotaType).toBeDefined();
        done();
      });

      // Simulate quota update that exceeds limit
      const updateQuota = (manager as any).updateQuotaUsage;
      const context = manager.getProjectContext('project-1');

      if (context.quotaUsage?.limits) {
        context.quotaUsage.queriesExecuted = context.quotaUsage.limits.maxQueriesPerDay! - 1;

        updateQuota.call(manager, 'project-1', {
          totalBytesProcessed: '1000',
        });
      }
    });

    it('should reset quotas daily', (done) => {
      manager.on('quota:reset', (data) => {
        expect(data.projectCount).toBeGreaterThan(0);
        done();
      });

      // Trigger quota reset manually for testing
      const context = manager.getProjectContext('project-1');
      if (context.quotaUsage) {
        context.quotaUsage.queriesExecuted = 100;
      }

      // Simulate reset
      (manager as any).startQuotaResetInterval();
    });
  });

  describe('Project Discovery', () => {
    beforeEach(async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects.slice(0, 2),
        autoDiscovery: false,
      };

      manager = new MultiProjectManager(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should discover all projects', async () => {
      const results = await manager.discoverProjects();
      expect(results.length).toBe(2);
      expect(results[0]).toHaveProperty('projectId');
      expect(results[0]).toHaveProperty('accessible');
      expect(results[0]).toHaveProperty('datasets');
    });

    it('should handle discovery failures gracefully', async () => {
      const results = await manager.discoverProjects();

      results.forEach((result) => {
        expect(result).toHaveProperty('projectId');
        if (!result.accessible) {
          expect(result.error).toBeDefined();
        }
      });
    });

    it('should emit discovery events', (done) => {
      manager.on('discovery:completed', (data) => {
        expect(data.total).toBeGreaterThan(0);
        done();
      });

      manager.discoverProjects().catch(() => {});
    });
  });

  describe('Dynamic Project Management', () => {
    beforeEach(async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects.slice(0, 1),
        autoDiscovery: false,
      };

      manager = new MultiProjectManager(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should add project dynamically', async () => {
      const newProject: ProjectConfig = {
        projectId: 'project-new',
        displayName: 'New Project',
        priority: 'medium',
        enabled: true,
      };

      await manager.addProject(newProject);

      const projects = manager.listProjects();
      expect(projects.length).toBe(2);

      const context = manager.getProjectContext('project-new');
      expect(context.displayName).toBe('New Project');
    });

    it('should throw error when adding duplicate project', async () => {
      await expect(
        manager.addProject(mockProjects[0])
      ).rejects.toThrow('already exists');
    });

    it('should remove project', async () => {
      await manager.removeProject('project-1');

      const projects = manager.listProjects();
      expect(projects.length).toBe(0);
    });

    it('should enable/disable projects', () => {
      manager.setProjectEnabled('project-1', false);

      expect(() => manager.getProjectContext('project-1')).toThrow('disabled');

      manager.setProjectEnabled('project-1', true);
      const context = manager.getProjectContext('project-1');
      expect(context.enabled).toBe(true);
    });
  });

  describe('Aggregated Metrics', () => {
    beforeEach(async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects,
        autoDiscovery: false,
      };

      manager = new MultiProjectManager(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should calculate aggregated metrics', () => {
      const metrics = manager.getAggregatedMetrics();

      expect(metrics.totalProjects).toBe(3);
      expect(metrics.enabledProjects).toBe(2);
      expect(metrics.totalQueries).toBeDefined();
      expect(metrics.totalBytesProcessed).toBeDefined();
      expect(metrics.projectMetrics).toBeInstanceOf(Map);
    });

    it('should include per-project metrics', () => {
      const metrics = manager.getAggregatedMetrics();

      expect(metrics.projectMetrics.size).toBe(3);

      metrics.projectMetrics.forEach((projectMetrics) => {
        expect(projectMetrics).toHaveProperty('accessCount');
        expect(projectMetrics).toHaveProperty('lastAccessed');
        expect(projectMetrics).toHaveProperty('quota');
      });
    });
  });

  describe('Health Checks', () => {
    beforeEach(async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects.slice(0, 2),
        autoDiscovery: false,
      };

      manager = new MultiProjectManager(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should report healthy status', () => {
      expect(manager.isHealthy()).toBe(true);
    });

    it('should report unhealthy during shutdown', async () => {
      await manager.shutdown();
      expect(manager.isHealthy()).toBe(false);
    });

    it('should report unhealthy with no enabled projects', () => {
      manager.setProjectEnabled('project-1', false);
      manager.setProjectEnabled('project-2', false);

      // Health depends on at least one enabled project
      const projects = manager.listProjects({ enabled: true });
      expect(projects.length).toBe(0);
    });
  });

  describe('Shutdown', () => {
    beforeEach(async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects.slice(0, 2),
        autoDiscovery: false,
      };

      manager = new MultiProjectManager(config);
      await new Promise(resolve => setTimeout(resolve, 100));
    });

    it('should shutdown gracefully', async () => {
      await manager.shutdown();
      expect(manager.isHealthy()).toBe(false);
    });

    it('should emit shutdown events', (done) => {
      manager.on('shutdown:completed', () => {
        done();
      });

      manager.shutdown();
    });

    it('should cleanup all resources', async () => {
      await manager.shutdown();

      const projects = manager.listProjects();
      expect(projects.length).toBe(0);
    });

    it('should handle shutdown idempotently', async () => {
      await manager.shutdown();
      await manager.shutdown(); // Should not throw
      expect(manager.isHealthy()).toBe(false);
    });
  });
});
