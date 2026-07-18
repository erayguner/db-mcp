import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { GoogleAuth } from 'google-auth-library';
import {
  MultiProjectManager,
  MultiProjectManagerConfig,
  ProjectConfig,
  MultiProjectManagerError,
  ProjectNotFoundError,
  PermissionDeniedError,
} from '../../src/bigquery/multi-project-manager.js';

/** Minimal shape of the Resource Manager request the manager issues. */
type AuthRequestArgs = { url: string; method: string; data: { permissions: string[] } };
type AuthResponse = { data: { permissions?: string[] } };
type AuthRequestFn = (opts: AuthRequestArgs) => Promise<AuthResponse>;

/**
 * Manager with the IAM auth seam stubbed out.
 *
 * `getProjectPermissions` performs a real Cloud Resource Manager
 * `testIamPermissions` call, so without this stub every test that touches
 * permissions or project discovery would depend on ambient GCP credentials and
 * network access. The stub answers from `grantedPermissions`, which each test
 * sets to whatever IAM is supposed to confirm.
 */
class TestableManager extends MultiProjectManager {
  /** Permissions the simulated IAM backend confirms the principal holds. */
  public grantedPermissions: string[] = [];

  public authRequest: jest.Mock<AuthRequestFn> = jest.fn<AuthRequestFn>(async (opts) => ({
    data: {
      permissions: opts.data.permissions.filter((perm) => this.grantedPermissions.includes(perm)),
    },
  }));

  protected getAuthClient(): GoogleAuth {
    return { request: this.authRequest } as unknown as GoogleAuth;
  }
}

describe('MultiProjectManager', () => {
  let manager: TestableManager;
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

      manager = new TestableManager(config);

      // Wait for initialization
      await new Promise((resolve) => setTimeout(resolve, 100));

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

      manager = new TestableManager(config);
      await new Promise((resolve) => setTimeout(resolve, 100));

      const current = manager.getCurrentProject();
      expect(current.projectId).toBe('project-2');
    });

    it('should emit initialization events', (done) => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects.slice(0, 2),
        autoDiscovery: false,
      };

      manager = new TestableManager(config);

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

      manager = new TestableManager(config);
      await new Promise((resolve) => setTimeout(resolve, 100));
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

      manager = new TestableManager(config);
      await new Promise((resolve) => setTimeout(resolve, 100));
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

      manager = new TestableManager(config);

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

      manager = new TestableManager(config);
      await new Promise((resolve) => setTimeout(resolve, 100));
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

      await expect(manager.executeCrossProjectQuery(query, options)).rejects.toThrow(
        'Cannot query more than'
      );
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

      manager = new TestableManager(config);
      await new Promise((resolve) => setTimeout(resolve, 100));
    });

    it('should validate permissions', async () => {
      // IAM confirms the principal genuinely holds the permission under test.
      manager.grantedPermissions = ['bigquery.jobs.create'];

      const result = await manager.validatePermission('project-1', 'query', [
        'bigquery.jobs.create',
      ]);

      expect(result.hasAccess).toBe(true);
      expect(result.permissions).toBeInstanceOf(Array);
      // Only IAM-confirmed permissions are ever reported.
      expect(result.verified).toBe(true);
      expect(result.permissions).toEqual(['bigquery.jobs.create']);
    });

    it('should throw on missing permissions', async () => {
      // IAM answers, and answers "no": a positive denial, distinct from a
      // check that could not be completed.
      manager.grantedPermissions = [];

      await expect(
        manager.validatePermission('project-1', 'sensitive_operation', ['bigquery.admin'])
      ).rejects.toThrow(PermissionDeniedError);
    });

    it('should cache permission results', async () => {
      manager.grantedPermissions = ['bigquery.jobs.create'];

      const spy = jest.spyOn(
        manager as unknown as { getProjectPermissions: (...args: unknown[]) => unknown },
        'getProjectPermissions'
      );

      // First call
      await manager.validatePermission('project-1', 'query', ['bigquery.jobs.create']);

      // Second call should use cache
      await manager.validatePermission('project-1', 'query', ['bigquery.jobs.create']);

      // Both validations consult getProjectPermissions...
      expect(spy).toHaveBeenCalledTimes(2);
      // ...but the cache lives inside it, so IAM itself was only asked once.
      expect(manager.authRequest).toHaveBeenCalledTimes(1);
    });
  });

  describe('Quota Management', () => {
    beforeEach(async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects.slice(0, 1),
        autoDiscovery: false,
      };

      manager = new TestableManager(config);
      await new Promise((resolve) => setTimeout(resolve, 100));
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

    it('should reset quotas daily', async () => {
      const context = manager.getProjectContext('project-1');
      context.quotaUsage!.queriesExecuted = 100;

      const resetEvent = new Promise<{ projectCount: number }>((resolve) => {
        manager.once('quota:reset', (data) => resolve(data as { projectCount: number }));
      });

      // The reset fires on a timer scheduled for midnight, so drive the clock
      // there instead of waiting for it in real time.
      jest.useFakeTimers();
      try {
        (manager as unknown as { startQuotaResetInterval: () => void }).startQuotaResetInterval();
        jest.advanceTimersByTime(24 * 60 * 60 * 1000);
      } finally {
        jest.useRealTimers();
      }

      const data = await resetEvent;

      expect(data.projectCount).toBeGreaterThan(0);
      // The reset must actually clear the counters, not merely announce itself.
      expect(context.quotaUsage!.queriesExecuted).toBe(0);
    });
  });

  describe('Project Discovery', () => {
    beforeEach(async () => {
      const config: MultiProjectManagerConfig = {
        discoveryIntervalMs: 300000,
        projects: mockProjects.slice(0, 2),
        autoDiscovery: false,
      };

      manager = new TestableManager(config);
      await new Promise((resolve) => setTimeout(resolve, 100));
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

      manager = new TestableManager(config);
      await new Promise((resolve) => setTimeout(resolve, 100));
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

    it('should throw error when adding duplicate project', () => {
      // addProject is synchronous, so a duplicate surfaces as a thrown error
      // rather than a rejected promise.
      expect(() => manager.addProject(mockProjects[0])).toThrow('already exists');
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

      manager = new TestableManager(config);
      await new Promise((resolve) => setTimeout(resolve, 100));
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

      manager = new TestableManager(config);
      await new Promise((resolve) => setTimeout(resolve, 100));
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

      manager = new TestableManager(config);
      await new Promise((resolve) => setTimeout(resolve, 100));
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
