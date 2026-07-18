/**
 * Unit Tests for Configuration
 */

import { getEnvironment, loadEnvironment } from '../../src/config/environment';

describe('Environment Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Give every test its own copy of process.env. `loadEnvironment()` reads
    // process.env on each call (it does not memoise), so a test that mutates
    // an env var would otherwise leak into every test that follows it.
    process.env = {
      ...originalEnv,
      GCP_PROJECT_ID: 'test-project',
      WORKLOAD_IDENTITY_POOL_ID: 'test-pool',
      WORKLOAD_IDENTITY_PROVIDER_ID: 'test-provider',
      MCP_SERVICE_ACCOUNT_EMAIL: 'test@example.com',
      GOOGLE_WORKSPACE_CLIENT_ID: 'test-client-id',
      GOOGLE_WORKSPACE_DOMAIN: 'example.com',
      NODE_ENV: 'test',
    };
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  it('should load valid environment configuration', () => {
    const env = loadEnvironment();

    expect(env.GCP_PROJECT_ID).toBeDefined();
    expect(env.NODE_ENV).toBeDefined();
    expect(env.BIGQUERY_LOCATION).toBe('europe-west2');
  });

  it('should use default values', () => {
    const env = loadEnvironment();

    expect(env.NODE_ENV).toBe('test');
    expect(env.BIGQUERY_MAX_RETRIES).toBe(3);
    expect(env.PORT).toBe(8080);
  });

  it('should transform boolean strings', () => {
    // Covers both transform polarities in the schema: `v === 'true'`
    // (TENANT_HOT_RELOAD, MODEL_ARMOR_ENABLED) and `v !== 'false'`
    // (MCP_AUTH_REQUIRED).
    process.env.TENANT_HOT_RELOAD = 'true';
    process.env.MODEL_ARMOR_ENABLED = 'false';
    process.env.MCP_AUTH_REQUIRED = 'false';

    const env = loadEnvironment();

    expect(env.TENANT_HOT_RELOAD).toBe(true);
    expect(env.MODEL_ARMOR_ENABLED).toBe(false);
    expect(env.MCP_AUTH_REQUIRED).toBe(false);
  });

  it('should apply boolean defaults when unset', () => {
    delete process.env.TENANT_HOT_RELOAD;
    delete process.env.MODEL_ARMOR_ENABLED;
    delete process.env.MCP_AUTH_REQUIRED;

    const env = loadEnvironment();

    expect(env.TENANT_HOT_RELOAD).toBe(true);
    expect(env.MODEL_ARMOR_ENABLED).toBe(false);
    expect(env.MCP_AUTH_REQUIRED).toBe(true);
  });

  it('should parse comma-separated lists', () => {
    // Whitespace around entries must be trimmed by the schema transform.
    process.env.GOOGLE_WORKSPACE_ALLOWED_GROUPS = 'engineers, admins';

    const env = loadEnvironment();

    expect(Array.isArray(env.GOOGLE_WORKSPACE_ALLOWED_GROUPS)).toBe(true);
    expect(env.GOOGLE_WORKSPACE_ALLOWED_GROUPS).toHaveLength(2);
    expect(env.GOOGLE_WORKSPACE_ALLOWED_GROUPS).toEqual(['engineers', 'admins']);
  });

  it('should leave comma-separated lists undefined when unset', () => {
    delete process.env.GOOGLE_WORKSPACE_ALLOWED_GROUPS;

    const env = loadEnvironment();

    expect(env.GOOGLE_WORKSPACE_ALLOWED_GROUPS).toBeUndefined();
  });

  it('should validate required fields', () => {
    delete process.env.GCP_PROJECT_ID;

    expect(() => loadEnvironment()).toThrow('Invalid environment configuration');
  });

  it('should validate email format', () => {
    process.env.MCP_SERVICE_ACCOUNT_EMAIL = 'invalid-email';

    expect(() => loadEnvironment()).toThrow('Invalid environment configuration');
  });

  it('should accept an empty service account email', () => {
    process.env.MCP_SERVICE_ACCOUNT_EMAIL = '';

    const env = loadEnvironment();

    expect(env.MCP_SERVICE_ACCOUNT_EMAIL).toBe('');
  });

  it('should cache environment instance', async () => {
    // Reset the module registry so the singleton starts unset, then load the
    // module through a dynamic import (ESM has no `require`).
    jest.resetModules();

    const { getEnvironment: getEnv } = await import('../../src/config/environment');

    const env1 = getEnv();
    const env2 = getEnv();

    expect(env1).toBe(env2); // Same instance
  });

  it('should return the same instance from the module-level singleton', () => {
    expect(getEnvironment()).toBe(getEnvironment());
  });
});
