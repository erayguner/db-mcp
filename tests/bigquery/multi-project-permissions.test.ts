/**
 * Permission validation tests for MultiProjectManager.
 *
 * These tests pin down the security contract of the IAM permission check:
 *   - permissions are only ever reported when IAM actually confirms them
 *   - "denied", "check failed" and "validation disabled" are distinct outcomes
 *   - every non-verified path fails closed
 *   - only genuinely verified answers reach the cache
 */
import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import type { GoogleAuth } from 'google-auth-library';
import {
  MultiProjectManager,
  MultiProjectManagerConfig,
  ProjectConfig,
  PermissionDeniedError,
  PermissionCheckFailedError,
  DEFAULT_BIGQUERY_PROBE_PERMISSIONS,
} from '../../src/bigquery/multi-project-manager.js';

/** Minimal shape of the auth request we stub out. */
type AuthRequestArgs = { url: string; method: string; data: { permissions: string[] } };
type AuthResponse = { data: { permissions?: string[] } };
type AuthRequestFn = (opts: AuthRequestArgs) => Promise<AuthResponse>;

/**
 * Subclass that replaces the auth seam so tests never touch the network,
 * while still exercising the real request construction and response parsing
 * inside `testIamPermissions`.
 */
class TestableManager extends MultiProjectManager {
  public authRequest: jest.Mock<AuthRequestFn> = jest.fn<AuthRequestFn>();

  protected getAuthClient(): GoogleAuth {
    return { request: this.authRequest } as unknown as GoogleAuth;
  }

  /** Convenience: run the private permission check. */
  public checkPermissions(projectId: string, permissions?: string[]) {
    return (
      this as unknown as {
        getProjectPermissions: (p: string, perms?: readonly string[]) => Promise<unknown>;
      }
    ).getProjectPermissions(projectId, permissions) as Promise<{
      status: string;
      granted: string[];
      denied: string[];
      verified: boolean;
      fromCache: boolean;
      reason?: string;
      error?: Error;
    }>;
  }
}

const PROJECTS: ProjectConfig[] = [
  { projectId: 'project-alpha', priority: 'high', enabled: true },
  { projectId: 'project-beta', priority: 'medium', enabled: true },
];

function makeConfig(overrides: Partial<MultiProjectManagerConfig> = {}): MultiProjectManagerConfig {
  return {
    projects: PROJECTS,
    defaultProjectId: 'project-alpha',
    autoDiscovery: false,
    discoveryIntervalMs: 300000,
    permissionValidation: {
      enabled: true,
      cacheValidationResults: true,
      validationTTLMs: 300000,
    },
    ...overrides,
  };
}

/** Build a manager whose IAM stub grants exactly `granted`. */
function managerGranting(
  granted: string[],
  overrides: Partial<MultiProjectManagerConfig> = {}
): TestableManager {
  const manager = new TestableManager(makeConfig(overrides));
  manager.authRequest.mockImplementation((opts: AuthRequestArgs) =>
    Promise.resolve({
      data: { permissions: opts.data.permissions.filter((p) => granted.includes(p)) },
    })
  );
  return manager;
}

describe('MultiProjectManager permission validation', () => {
  let manager: TestableManager;

  afterEach(async () => {
    if (manager) {
      await manager.shutdown();
    }
  });

  // ---------------------------------------------------------------------
  // The original defect: fabricated grants
  // ---------------------------------------------------------------------
  describe('no fabricated permissions', () => {
    it('reports ONLY the permissions IAM confirms, not a hardcoded set', async () => {
      // Principal genuinely holds just bigquery.jobs.create.
      manager = managerGranting(['bigquery.jobs.create']);

      const outcome = await manager.checkPermissions('project-alpha');

      expect(outcome.status).toBe('verified');
      expect(outcome.granted).toEqual(['bigquery.jobs.create']);

      // These were fabricated by the old implementation. They must NOT appear.
      expect(outcome.granted).not.toContain('bigquery.datasets.get');
      expect(outcome.granted).not.toContain('bigquery.tables.list');
      expect(outcome.denied).toEqual(
        expect.arrayContaining(['bigquery.datasets.get', 'bigquery.tables.list'])
      );
    });

    it('denies a permission the principal does not hold, even when others succeed', async () => {
      manager = managerGranting(['bigquery.jobs.create']);

      // jobs.create is genuinely held -> allowed.
      await expect(
        manager.validatePermission('project-alpha', 'query', ['bigquery.jobs.create'])
      ).resolves.toMatchObject({ hasAccess: true, verified: true });

      // tables.list was previously fabricated -> must now be denied.
      await expect(
        manager.validatePermission('project-alpha', 'list_tables', ['bigquery.tables.list'])
      ).rejects.toThrow(PermissionDeniedError);
    });

    it('ignores permissions the API returns that were never requested', async () => {
      manager = new TestableManager(makeConfig());
      manager.authRequest.mockResolvedValue({
        data: { permissions: ['bigquery.jobs.create', 'bigquery.admin'] },
      });

      const outcome = await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);

      expect(outcome.granted).toEqual(['bigquery.jobs.create']);
      expect(outcome.granted).not.toContain('bigquery.admin');
    });
  });

  // ---------------------------------------------------------------------
  // Real IAM request construction
  // ---------------------------------------------------------------------
  describe('Resource Manager testIamPermissions request', () => {
    it('POSTs to the v3 projects:testIamPermissions endpoint with the requested permissions', async () => {
      manager = managerGranting([]);

      await manager.checkPermissions('project-alpha', ['bigquery.tables.get']);

      expect(manager.authRequest).toHaveBeenCalledTimes(1);
      const call = manager.authRequest.mock.calls[0][0];
      expect(call.url).toBe(
        'https://cloudresourcemanager.googleapis.com/v3/projects/project-alpha:testIamPermissions'
      );
      expect(call.method).toBe('POST');
      expect(call.data).toEqual({ permissions: ['bigquery.tables.get'] });
    });

    it('treats an omitted permissions field as "none granted" (a real answer)', async () => {
      manager = new TestableManager(makeConfig());
      manager.authRequest.mockResolvedValue({ data: {} });

      const outcome = await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);

      expect(outcome.status).toBe('verified');
      expect(outcome.verified).toBe(true);
      expect(outcome.granted).toEqual([]);
      expect(outcome.denied).toEqual(['bigquery.jobs.create']);
    });

    it('batches requests above the 100-permission API limit', async () => {
      manager = managerGranting([]);
      const many = Array.from({ length: 150 }, (_, i) => `bigquery.fake.perm${i}`);

      await manager.checkPermissions('project-alpha', many);

      expect(manager.authRequest).toHaveBeenCalledTimes(2);
      expect(manager.authRequest.mock.calls[0][0].data.permissions).toHaveLength(100);
      expect(manager.authRequest.mock.calls[1][0].data.permissions).toHaveLength(50);
    });

    it('refuses to build a request for a malformed project ID', async () => {
      manager = managerGranting(['bigquery.jobs.create']);

      const outcome = await manager.checkPermissions('../../evil', ['bigquery.jobs.create']);

      expect(outcome.status).toBe('unverified');
      expect(manager.authRequest).not.toHaveBeenCalled();
    });

    it('probes the documented BigQuery baseline permissions by default', async () => {
      manager = managerGranting([]);

      await manager.checkPermissions('project-alpha');

      expect(manager.authRequest.mock.calls[0][0].data.permissions).toEqual(
        Array.from(DEFAULT_BIGQUERY_PROBE_PERMISSIONS)
      );
    });
  });

  // ---------------------------------------------------------------------
  // Three distinct outcomes
  // ---------------------------------------------------------------------
  describe('distinguishes denied / check-failed / disabled', () => {
    it('verified + denied: IAM answered "no"', async () => {
      manager = managerGranting([]);

      const outcome = await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);

      expect(outcome.status).toBe('verified');
      expect(outcome.verified).toBe(true);
      expect(outcome.denied).toEqual(['bigquery.jobs.create']);
      expect(outcome.error).toBeUndefined();
    });

    it('unverified: the IAM call failed, so nothing is known', async () => {
      manager = new TestableManager(makeConfig());
      manager.authRequest.mockRejectedValue(new Error('ECONNRESET'));

      const outcome = await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);

      expect(outcome.status).toBe('unverified');
      expect(outcome.verified).toBe(false);
      expect(outcome.granted).toEqual([]);
      // Crucially NOT reported as denied - IAM never said no.
      expect(outcome.denied).toEqual([]);
      expect(outcome.error).toBeInstanceOf(Error);
      expect(outcome.reason).toContain('ECONNRESET');
    });

    it('disabled: no check was performed', async () => {
      manager = managerGranting([], {
        permissionValidation: {
          enabled: false,
          cacheValidationResults: true,
          validationTTLMs: 300000,
        },
      });

      const outcome = await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);

      expect(outcome.status).toBe('disabled');
      expect(outcome.verified).toBe(false);
      expect(outcome.granted).toEqual([]);
      expect(outcome.denied).toEqual([]);
      expect(manager.authRequest).not.toHaveBeenCalled();
    });

    it('the three outcomes are never represented by the same empty array', async () => {
      const denied = await managerGranting([]).checkPermissions('project-alpha', ['p.q.r']);

      const failing = new TestableManager(makeConfig());
      failing.authRequest.mockRejectedValue(new Error('boom'));
      const failed = await failing.checkPermissions('project-alpha', ['p.q.r']);

      const off = managerGranting([], {
        permissionValidation: {
          enabled: false,
          cacheValidationResults: true,
          validationTTLMs: 300000,
        },
      });
      const disabled = await off.checkPermissions('project-alpha', ['p.q.r']);

      expect(new Set([denied.status, failed.status, disabled.status]).size).toBe(3);

      await failing.shutdown();
      await off.shutdown();
      manager = managerGranting([]); // for afterEach
    });
  });

  // ---------------------------------------------------------------------
  // Fail-closed behaviour of validatePermission
  // ---------------------------------------------------------------------
  describe('validatePermission fails closed', () => {
    it('throws PermissionCheckFailedError (not PermissionDenied) when IAM is unreachable', async () => {
      manager = new TestableManager(makeConfig());
      manager.authRequest.mockRejectedValue(new Error('IAM API disabled'));

      const promise = manager.validatePermission('project-alpha', 'query', [
        'bigquery.jobs.create',
      ]);

      await expect(promise).rejects.toThrow(PermissionCheckFailedError);
      await expect(promise).rejects.not.toThrow(PermissionDeniedError);
      await expect(promise).rejects.toMatchObject({ code: 'PERMISSION_CHECK_FAILED' });
    });

    it('throws PermissionDeniedError when IAM positively denies', async () => {
      manager = managerGranting(['bigquery.jobs.create']);

      await expect(
        manager.validatePermission('project-alpha', 'admin_op', ['bigquery.datasets.create'])
      ).rejects.toThrow(PermissionDeniedError);
    });

    it('reports exactly which permissions were missing', async () => {
      manager = managerGranting(['bigquery.jobs.create']);

      await expect(
        manager
          .validatePermission('project-alpha', 'op', [
            'bigquery.jobs.create',
            'bigquery.tables.list',
          ])
          .catch((e: unknown) => Promise.reject((e as PermissionDeniedError).details))
      ).rejects.toMatchObject({ missingPermissions: ['bigquery.tables.list'] });
    });

    it('does not vacuously grant access for an empty requirement list', async () => {
      manager = managerGranting([]);

      await expect(manager.validatePermission('project-alpha', 'op', [])).rejects.toThrow(
        PermissionCheckFailedError
      );
    });

    it('never claims unverified permissions when validation is disabled', async () => {
      manager = managerGranting([], {
        permissionValidation: {
          enabled: false,
          cacheValidationResults: true,
          validationTTLMs: 300000,
        },
      });

      const result = await manager.validatePermission('project-alpha', 'op', [
        'bigquery.admin',
        'bigquery.jobs.create',
      ]);

      // Explicit operator opt-out allows the call through...
      expect(result.hasAccess).toBe(true);
      // ...but nothing is asserted as verified.
      expect(result.status).toBe('disabled');
      expect(result.verified).toBe(false);
      expect(result.permissions).toEqual([]);
      expect(result.permissions).not.toContain('bigquery.admin');
      expect(result.reason).toContain('NOT verified');
    });

    it('marks a successful validation as verified', async () => {
      manager = managerGranting(['bigquery.jobs.create']);

      const result = await manager.validatePermission('project-alpha', 'query', [
        'bigquery.jobs.create',
      ]);

      expect(result).toMatchObject({
        hasAccess: true,
        status: 'verified',
        verified: true,
        permissions: ['bigquery.jobs.create'],
        missingPermissions: [],
      });
    });
  });

  // ---------------------------------------------------------------------
  // Cache correctness
  // ---------------------------------------------------------------------
  describe('permission cache holds only verified answers', () => {
    it('serves a repeat check from cache without a second IAM call', async () => {
      manager = managerGranting(['bigquery.jobs.create']);

      const first = await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);
      const second = await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);

      expect(first.fromCache).toBe(false);
      expect(second.fromCache).toBe(true);
      expect(second.granted).toEqual(['bigquery.jobs.create']);
      expect(manager.authRequest).toHaveBeenCalledTimes(1);
    });

    it('caches verified denials too', async () => {
      manager = managerGranting([]);

      await manager.checkPermissions('project-alpha', ['bigquery.tables.list']);
      const second = await manager.checkPermissions('project-alpha', ['bigquery.tables.list']);

      expect(second.fromCache).toBe(true);
      expect(second.denied).toEqual(['bigquery.tables.list']);
      expect(manager.authRequest).toHaveBeenCalledTimes(1);
    });

    it('NEVER caches a failed check - the next call retries IAM', async () => {
      manager = new TestableManager(makeConfig());
      manager.authRequest.mockRejectedValue(new Error('transient'));

      const first = await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);
      expect(first.status).toBe('unverified');

      // Recover: the failure must not have poisoned the cache in either direction.
      manager.authRequest.mockResolvedValue({ data: { permissions: ['bigquery.jobs.create'] } });
      const second = await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);

      expect(second.status).toBe('verified');
      expect(second.fromCache).toBe(false);
      expect(second.granted).toEqual(['bigquery.jobs.create']);
      expect(manager.authRequest).toHaveBeenCalledTimes(2);
    });

    it('does not serve a cached answer for a permission that was never checked', async () => {
      manager = managerGranting(['bigquery.jobs.create']);

      await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);
      const other = await manager.checkPermissions('project-alpha', ['bigquery.tables.list']);

      expect(other.fromCache).toBe(false);
      expect(manager.authRequest).toHaveBeenCalledTimes(2);
    });

    it('keeps caches separate per project', async () => {
      manager = managerGranting(['bigquery.jobs.create']);

      await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);
      const beta = await manager.checkPermissions('project-beta', ['bigquery.jobs.create']);

      expect(beta.fromCache).toBe(false);
      expect(manager.authRequest).toHaveBeenCalledTimes(2);
    });

    it('honours cacheValidationResults: false by always re-checking', async () => {
      manager = managerGranting(['bigquery.jobs.create'], {
        permissionValidation: {
          enabled: true,
          cacheValidationResults: false,
          validationTTLMs: 300000,
        },
      });

      await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);
      const second = await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);

      expect(second.fromCache).toBe(false);
      expect(manager.authRequest).toHaveBeenCalledTimes(2);
    });

    it('re-checks IAM after the cache is invalidated', async () => {
      manager = managerGranting(['bigquery.jobs.create']);

      await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);
      manager.invalidatePermissionCache('project-alpha');
      const after = await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);

      expect(after.fromCache).toBe(false);
      expect(manager.authRequest).toHaveBeenCalledTimes(2);
    });

    it('expires cached answers once the TTL elapses', async () => {
      manager = managerGranting(['bigquery.jobs.create'], {
        permissionValidation: {
          enabled: true,
          cacheValidationResults: true,
          validationTTLMs: 60000,
        },
      });

      await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);

      // Age the cached entry past its TTL.
      const cache = (manager as unknown as { permissionCache: Map<string, { expiresAt: Date }> })
        .permissionCache;
      const entry = cache.get('project-alpha');
      expect(entry).toBeDefined();
      entry!.expiresAt = new Date(Date.now() - 1000);

      const after = await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);

      expect(after.fromCache).toBe(false);
      expect(manager.authRequest).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------
  // Discovery reporting
  // ---------------------------------------------------------------------
  describe('project discovery surfaces permission status', () => {
    it('reports only verified permissions and marks the status', async () => {
      manager = managerGranting(['bigquery.jobs.create']);

      const results = await manager.discoverProjects();
      const alpha = results.find((r) => r.projectId === 'project-alpha');

      expect(alpha?.permissionStatus).toBe('verified');
      expect(alpha?.permissions).toEqual(['bigquery.jobs.create']);
      expect(alpha?.permissions).not.toContain('bigquery.tables.list');
    });

    it('marks the status unverified (not empty-means-denied) when IAM fails', async () => {
      manager = new TestableManager(makeConfig());
      manager.authRequest.mockRejectedValue(new Error('no credentials'));

      const results = await manager.discoverProjects();
      const alpha = results.find((r) => r.projectId === 'project-alpha');

      expect(alpha?.permissions).toEqual([]);
      expect(alpha?.permissionStatus).toBe('unverified');
      expect(alpha?.permissionError).toBeInstanceOf(Error);
    });

    it('marks the status disabled when validation is switched off', async () => {
      manager = managerGranting([], {
        permissionValidation: {
          enabled: false,
          cacheValidationResults: true,
          validationTTLMs: 300000,
        },
      });

      const results = await manager.discoverProjects();
      const alpha = results.find((r) => r.projectId === 'project-alpha');

      expect(alpha?.permissions).toEqual([]);
      expect(alpha?.permissionStatus).toBe('disabled');
      expect(alpha?.permissionError).toBeUndefined();
    });
  });

  // ---------------------------------------------------------------------
  // Observability
  // ---------------------------------------------------------------------
  describe('events', () => {
    it('emits permission:check:failed with the underlying error', async () => {
      manager = new TestableManager(makeConfig());
      manager.authRequest.mockRejectedValue(new Error('kaboom'));

      const events: Array<{ projectId: string; error: Error }> = [];
      manager.on('permission:check:failed', (e) =>
        events.push(e as { projectId: string; error: Error })
      );

      await manager.checkPermissions('project-alpha', ['bigquery.jobs.create']);

      expect(events).toHaveLength(1);
      expect(events[0].projectId).toBe('project-alpha');
      expect(events[0].error.message).toBe('kaboom');
    });

    it('emits permission:check:completed with granted and denied split out', async () => {
      manager = managerGranting(['bigquery.jobs.create']);

      const events: Array<{ granted: string[]; denied: string[] }> = [];
      manager.on('permission:check:completed', (e) =>
        events.push(e as { granted: string[]; denied: string[] })
      );

      await manager.checkPermissions('project-alpha', [
        'bigquery.jobs.create',
        'bigquery.tables.list',
      ]);

      expect(events[0].granted).toEqual(['bigquery.jobs.create']);
      expect(events[0].denied).toEqual(['bigquery.tables.list']);
    });
  });
});
