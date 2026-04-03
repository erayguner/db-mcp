import { describe, it, expect, beforeEach } from '@jest/globals';
import { TenantContextFactory, TenantResolutionError } from '../../../src/tenancy/tenant-context.js';
import { TenantRegistry } from '../../../src/tenancy/tenant-registry.js';
import { WriteMode } from '../../../src/tenancy/tenant-config.js';
import { AuthenticatedPrincipal } from '../../../src/auth/oidc-authenticator.js';

describe('TenantContextFactory', () => {
  let registry: TenantRegistry;
  let factory: TenantContextFactory;

  beforeEach(() => {
    registry = new TenantRegistry();
    registry.register({
      id: 'acme',
      name: 'Acme',
      projectId: 'acme-prod',
      allowedDatasets: ['analytics'],
      deniedDatasets: [],
      writeMode: WriteMode.BLOCKED,
      rateLimits: { requestsPerMinute: 60, queriesPerHour: 500 },
      oidcSubjectPattern: '.*@acme\\.com$',
    });
    factory = new TenantContextFactory(registry, 'default');
  });

  it('creates tenant context from authenticated principal', () => {
    const principal: AuthenticatedPrincipal = {
      subject: 'user-1',
      email: 'alice@acme.com',
      issuer: 'https://accounts.google.com',
      audience: 'mcp-server',
      scopes: [],
      claims: {},
      authenticatedAt: new Date(),
    };

    const ctx = factory.createContext(principal);
    expect(ctx.tenantId).toBe('acme');
    expect(ctx.projectId).toBe('acme-prod');
    expect(ctx.policy.canAccessDataset('analytics')).toBe(true);
    expect(ctx.policy.canAccessDataset('secrets')).toBe(false);
  });

  it('falls back to default tenant when no pattern matches', () => {
    registry.register({
      id: 'default',
      name: 'Default',
      projectId: 'default-proj',
      allowedDatasets: ['public'],
      deniedDatasets: [],
      writeMode: WriteMode.BLOCKED,
      rateLimits: { requestsPerMinute: 10, queriesPerHour: 100 },
    });

    const principal: AuthenticatedPrincipal = {
      subject: 'user-2',
      email: 'bob@unknown.com',
      issuer: 'https://accounts.google.com',
      audience: 'mcp-server',
      scopes: [],
      claims: {},
      authenticatedAt: new Date(),
    };

    const ctx = factory.createContext(principal);
    expect(ctx.tenantId).toBe('default');
  });

  it('throws when no tenant matches and no default exists', () => {
    const noDefaultFactory = new TenantContextFactory(new TenantRegistry(), 'default');
    const principal: AuthenticatedPrincipal = {
      subject: 'user-3',
      email: 'charlie@nowhere.com',
      issuer: 'https://accounts.google.com',
      audience: 'mcp-server',
      scopes: [],
      claims: {},
      authenticatedAt: new Date(),
    };

    expect(() => noDefaultFactory.createContext(principal)).toThrow(TenantResolutionError);
  });
});
