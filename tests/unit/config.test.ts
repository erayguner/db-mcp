/**
 * Unit Tests for Configuration
 */

import { getEnvironment, loadEnvironment } from '../../src/config/environment';

describe.skip('Environment Configuration', () => {
  const originalEnv = process.env;

  beforeAll(() => {
    // Set required environment variables for all tests
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

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should load valid environment configuration', () => {
    const env = loadEnvironment();

    expect(env.GCP_PROJECT_ID).toBeDefined();
    expect(env.NODE_ENV).toBeDefined();
    expect(env.BIGQUERY_LOCATION).toBe('US');
  });

  it('should use default values', () => {
    const env = loadEnvironment();

    expect(env.NODE_ENV).toBe('test');
    expect(env.BIGQUERY_MAX_RETRIES).toBe(3);
    expect(env.PORT).toBe(8080);
  });

  it('should transform boolean strings', () => {
    process.env.ENABLE_CORS = 'true';
    process.env.ENABLE_METRICS = 'false';

    const env = loadEnvironment();

    expect(env.ENABLE_CORS).toBe(true);
    expect(env.ENABLE_METRICS).toBe(false);
  });

  it('should parse comma-separated lists', () => {
    process.env.ALLOWED_ORIGINS = 'http://localhost:3000,https://app.example.com';
    process.env.GOOGLE_WORKSPACE_ALLOWED_GROUPS = 'engineers,admins';

    const env = loadEnvironment();

    expect(Array.isArray(env.ALLOWED_ORIGINS)).toBe(true);
    expect(env.ALLOWED_ORIGINS).toHaveLength(2);
    expect(env.GOOGLE_WORKSPACE_ALLOWED_GROUPS).toHaveLength(2);
  });

  it('should validate required fields', () => {
    const envWithoutProject = { ...process.env };
    delete envWithoutProject.GCP_PROJECT_ID;

    // Temporarily replace process.env
    const tempEnv = process.env;
    process.env = envWithoutProject;

    expect(() => loadEnvironment()).toThrow('Invalid environment configuration');

    // Restore process.env
    process.env = tempEnv;
  });

  it('should validate email format', () => {
    process.env.MCP_SERVICE_ACCOUNT_EMAIL = 'invalid-email';

    expect(() => loadEnvironment()).toThrow();
  });

  it('should cache environment instance', () => {
    // Clear the module cache first to start fresh
    jest.resetModules();

    // Re-import to get fresh instance
    const { getEnvironment: getEnv } = require('../../src/config/environment');

    const env1 = getEnv();
    const env2 = getEnv();

    expect(env1).toBe(env2); // Same instance
  });
});
