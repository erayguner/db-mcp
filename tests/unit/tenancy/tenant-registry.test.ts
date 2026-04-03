import { describe, it, expect, beforeEach } from '@jest/globals';
import { TenantRegistry } from '../../../src/tenancy/tenant-registry.js';
import { TenantConfig, WriteMode } from '../../../src/tenancy/tenant-config.js';

const testTenant: TenantConfig = {
  id: 'acme',
  name: 'Acme Corp',
  projectId: 'acme-prod',
  allowedDatasets: ['analytics'],
  deniedDatasets: [],
  writeMode: WriteMode.BLOCKED,
  rateLimits: { requestsPerMinute: 60, queriesPerHour: 500 },
  oidcSubjectPattern: '.*@acme\\.com$',
};

describe('TenantRegistry', () => {
  let registry: TenantRegistry;

  beforeEach(() => {
    registry = new TenantRegistry();
  });

  it('registers and retrieves a tenant by ID', () => {
    registry.register(testTenant);
    const tenant = registry.get('acme');
    expect(tenant).toBeDefined();
    expect(tenant!.projectId).toBe('acme-prod');
  });

  it('returns undefined for unknown tenant', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('resolves tenant from email using oidcSubjectPattern', () => {
    registry.register(testTenant);
    const tenant = registry.resolveBySubject('alice@acme.com');
    expect(tenant).toBeDefined();
    expect(tenant!.id).toBe('acme');
  });

  it('returns undefined when no tenant matches subject', () => {
    registry.register(testTenant);
    expect(registry.resolveBySubject('bob@other.com')).toBeUndefined();
  });

  it('lists all registered tenants', () => {
    registry.register(testTenant);
    registry.register({ ...testTenant, id: 'beta', oidcSubjectPattern: '.*@beta\\.com$' });
    expect(registry.list()).toHaveLength(2);
  });

  it('replaces tenant on re-register (hot-reload)', () => {
    registry.register(testTenant);
    registry.register({ ...testTenant, allowedDatasets: ['analytics', 'billing'] });
    const tenant = registry.get('acme');
    expect(tenant!.allowedDatasets).toEqual(['analytics', 'billing']);
  });

  it('returns correct size', () => {
    expect(registry.size()).toBe(0);
    registry.register(testTenant);
    expect(registry.size()).toBe(1);
  });
});
