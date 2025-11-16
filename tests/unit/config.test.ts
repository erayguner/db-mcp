/**
 * Unit Tests for Configuration
 */

import { getEnvironment, loadEnvironment } from '../../src/config/environment';

describe('Environment Configuration', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Reset environment
    jest.resetModules();
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should load valid environment configuration', () => {
    const env = getEnvironment();

    expect(env.GCP_PROJECT_ID).toBeDefined();
    expect(env.NODE_ENV).toBeDefined();
    expect(env.BIGQUERY_LOCATION).toBe('US');
  });

  it('should use default values', () => {
    const env = getEnvironment();

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
    delete process.env.GCP_PROJECT_ID;

    expect(() => loadEnvironment()).toThrow('Invalid environment configuration');
  });

  it('should validate email format', () => {
    process.env.MCP_SERVICE_ACCOUNT_EMAIL = 'invalid-email';

    expect(() => loadEnvironment()).toThrow();
  });

  it('should cache environment instance', () => {
    const env1 = getEnvironment();
    const env2 = getEnvironment();

    expect(env1).toBe(env2); // Same instance
  });
});
