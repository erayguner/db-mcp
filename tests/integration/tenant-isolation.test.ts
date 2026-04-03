import { describe, it, expect, beforeEach } from '@jest/globals';
import { DatasetPolicy } from '../../src/tenancy/dataset-policy.js';
import { TenantRegistry } from '../../src/tenancy/tenant-registry.js';
import { TenantContextFactory } from '../../src/tenancy/tenant-context.js';
import { WriteMode } from '../../src/tenancy/tenant-config.js';

describe('Tenant Isolation Integration', () => {
  let registry: TenantRegistry;
  let factory: TenantContextFactory;

  beforeEach(() => {
    registry = new TenantRegistry();
    registry.register({
      id: 'tenant-a',
      name: 'Tenant A',
      projectId: 'proj-a',
      allowedDatasets: ['analytics'],
      deniedDatasets: [],
      writeMode: WriteMode.BLOCKED,
      rateLimits: { requestsPerMinute: 60, queriesPerHour: 500 },
      oidcSubjectPattern: '.*@tenant-a\\.com$',
      maxBytesPerQuery: '1073741824',
    });
    registry.register({
      id: 'tenant-b',
      name: 'Tenant B',
      projectId: 'proj-b',
      allowedDatasets: ['sales', 'inventory'],
      deniedDatasets: [],
      writeMode: WriteMode.ALLOWED,
      rateLimits: { requestsPerMinute: 120, queriesPerHour: 2000 },
      oidcSubjectPattern: '.*@tenant-b\\.com$',
    });
    factory = new TenantContextFactory(registry, 'default');
  });

  it('isolates tenant A to analytics dataset only', () => {
    const ctx = factory.createContext({
      subject: 'u1', email: 'user@tenant-a.com',
      issuer: 'https://idp.com', audience: 'mcp', scopes: [],
      claims: {}, authenticatedAt: new Date(),
    });
    expect(ctx.policy.canAccessDataset('analytics')).toBe(true);
    expect(ctx.policy.canAccessDataset('sales')).toBe(false);
    expect(ctx.policy.canWrite()).toBe(false);
  });

  it('allows tenant B to access sales and inventory with writes', () => {
    const ctx = factory.createContext({
      subject: 'u2', email: 'user@tenant-b.com',
      issuer: 'https://idp.com', audience: 'mcp', scopes: [],
      claims: {}, authenticatedAt: new Date(),
    });
    expect(ctx.policy.canAccessDataset('sales')).toBe(true);
    expect(ctx.policy.canAccessDataset('inventory')).toBe(true);
    expect(ctx.policy.canAccessDataset('analytics')).toBe(false);
    expect(ctx.policy.canWrite()).toBe(true);
  });

  it('tenant A cannot query tenant B datasets', () => {
    const ctx = factory.createContext({
      subject: 'u1', email: 'user@tenant-a.com',
      issuer: 'https://idp.com', audience: 'mcp', scopes: [],
      claims: {}, authenticatedAt: new Date(),
    });
    const result = ctx.policy.validateQuery('SELECT * FROM `proj-b.sales.orders`');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('sales');
  });

  it('tenant A query within allowed dataset passes', () => {
    const ctx = factory.createContext({
      subject: 'u1', email: 'user@tenant-a.com',
      issuer: 'https://idp.com', audience: 'mcp', scopes: [],
      claims: {}, authenticatedAt: new Date(),
    });
    const result = ctx.policy.validateQuery('SELECT * FROM `proj-a.analytics.events`');
    expect(result.allowed).toBe(true);
  });
});
