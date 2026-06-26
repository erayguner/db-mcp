import { loadFeature, defineFeature } from 'jest-cucumber';
import { TenantRegistry } from '../../src/tenancy/tenant-registry.js';
import { TenantContextFactory, type TenantContext } from '../../src/tenancy/tenant-context.js';
import { DatasetPolicy, type QueryValidationResult } from '../../src/tenancy/dataset-policy.js';
import { WriteMode, type TenantConfig } from '../../src/tenancy/tenant-config.js';
import type { AuthenticatedPrincipal } from '../../src/auth/oidc-authenticator.js';

const feature = loadFeature('./tenant-isolation.feature', { loadRelativePath: true });

const WRITE_MODES: Record<string, WriteMode> = {
  blocked: WriteMode.BLOCKED,
  protected: WriteMode.PROTECTED,
  allowed: WriteMode.ALLOWED,
};

function makeTenant(
  id: string,
  projectId: string,
  allowedDataset: string,
  writeMode: string
): TenantConfig {
  return {
    id,
    name: `${id} Corp`,
    projectId,
    allowedDatasets: [allowedDataset],
    deniedDatasets: [],
    writeMode: WRITE_MODES[writeMode] ?? WriteMode.BLOCKED,
    rateLimits: { requestsPerMinute: 100, queriesPerHour: 1000 },
  };
}

function makePrincipal(email: string): AuthenticatedPrincipal {
  return {
    subject: `sub-${email}`,
    email,
    issuer: 'https://accounts.google.com',
    audience: 'mcp-server',
    scopes: [],
    claims: {},
    authenticatedAt: new Date(),
  };
}

defineFeature(feature, (test) => {
  let tenant: TenantConfig;
  let policy: DatasetPolicy;
  let validation: QueryValidationResult;
  let context: TenantContext;

  const givenATenant = (given: (s: RegExp, fn: (...args: string[]) => void) => void) =>
    given(
      /^a tenant "(.*)" in project "(.*)" that allows dataset "(.*)" with write mode "(.*)"$/,
      (id: string, projectId: string, dataset: string, mode: string) => {
        tenant = makeTenant(id, projectId, dataset, mode);
        policy = new DatasetPolicy(tenant);
      }
    );

  test('A tenant can access a dataset on its allow-list', ({ given, then }) => {
    givenATenant(given);
    then(/^tenant "(.*)" is allowed to access dataset "(.*)"$/, (_id, dataset) => {
      expect(policy.canAccessDataset(dataset)).toBe(true);
    });
  });

  test('A tenant cannot access a dataset that is not on its allow-list', ({ given, then }) => {
    givenATenant(given);
    then(/^tenant "(.*)" is denied access to dataset "(.*)"$/, (_id, dataset) => {
      expect(policy.canAccessDataset(dataset)).toBe(false);
    });
  });

  test('A cross-tenant query is rejected with a reason', ({ given, when, then, and }) => {
    givenATenant(given);
    when(/^tenant "(.*)" runs the query "(.*)"$/, (_id, query) => {
      validation = policy.validateQuery(query);
    });
    then('the query is denied', () => {
      expect(validation.allowed).toBe(false);
    });
    and(/^the denial reason mentions "(.*)"$/, (text) => {
      expect(validation.reason ?? '').toContain(text);
    });
  });

  test('A tenant can query its own allowed dataset', ({ given, when, then }) => {
    givenATenant(given);
    when(/^tenant "(.*)" runs the query "(.*)"$/, (_id, query) => {
      validation = policy.validateQuery(query);
    });
    then('the query is allowed', () => {
      expect(validation.allowed).toBe(true);
    });
  });

  test('A write-blocked tenant cannot run DML', ({ given, when, then, and }) => {
    givenATenant(given);
    when(/^tenant "(.*)" runs the query "(.*)"$/, (_id, query) => {
      validation = policy.validateQuery(query);
    });
    then('the query is denied', () => {
      expect(validation.allowed).toBe(false);
    });
    and(/^the denial reason mentions "(.*)"$/, (text) => {
      expect(validation.reason ?? '').toContain(text);
    });
  });

  test('A write-enabled tenant can run DML on its own dataset', ({ given, when, then }) => {
    givenATenant(given);
    when(/^tenant "(.*)" runs the query "(.*)"$/, (_id, query) => {
      validation = policy.validateQuery(query);
    });
    then('the query is allowed', () => {
      expect(validation.allowed).toBe(true);
    });
  });

  test('An authenticated principal resolves to its own tenant context', ({
    given,
    and,
    when,
    then,
  }) => {
    givenATenant(given);
    and(/^the tenant "(.*)" recognises subjects matching "(.*)"$/, (_id, pattern) => {
      tenant = { ...tenant, oidcSubjectPattern: pattern };
    });
    when(/^a principal with email "(.*)" requests a tenant context$/, (email) => {
      const registry = new TenantRegistry();
      registry.register(tenant);
      const factory = new TenantContextFactory(registry, tenant.id);
      context = factory.createContext(makePrincipal(email));
    });
    then(/^the resolved tenant context is for tenant "(.*)"$/, (id) => {
      expect(context.tenantId).toBe(id);
    });
  });
});
