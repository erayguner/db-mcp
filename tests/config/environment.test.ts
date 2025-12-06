import { EnvironmentSchema } from '../../src/config/environment';

describe('Environment Configuration', () => {
  const validEnv = {
    NODE_ENV: 'development',
    PORT: '8080',
    LOG_LEVEL: 'info',
    GCP_PROJECT_ID: 'test-project',
    GCP_REGION: 'us-central1',
    WORKLOAD_IDENTITY_POOL_ID: 'test-pool',
    WORKLOAD_IDENTITY_PROVIDER_ID: 'test-provider',
    MCP_SERVICE_ACCOUNT_EMAIL: 'test@test-project.iam.gserviceaccount.com',
    GOOGLE_WORKSPACE_CLIENT_ID: 'test-client-id',
    GOOGLE_WORKSPACE_DOMAIN: 'example.com',
    BIGQUERY_LOCATION: 'US',
    BIGQUERY_MAX_RETRIES: '3',
    BIGQUERY_TIMEOUT: '60000',
  };

  it('should validate correct environment configuration', () => {
    const result = EnvironmentSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
  });

  it('should require GCP_PROJECT_ID', () => {
    const { GCP_PROJECT_ID, ...invalidEnv } = validEnv;
    const result = EnvironmentSchema.safeParse(invalidEnv);
    expect(result.success).toBe(false);
  });

  it('should validate email format for service account', () => {
    const invalidEmail = {
      ...validEnv,
      MCP_SERVICE_ACCOUNT_EMAIL: 'invalid-email',
    };
    const result = EnvironmentSchema.safeParse(invalidEmail);
    expect(result.success).toBe(false);
  });

  it('should transform numeric string values correctly', () => {
    const result = EnvironmentSchema.safeParse(validEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(8080);
      expect(result.data.BIGQUERY_MAX_RETRIES).toBe(3);
      expect(result.data.BIGQUERY_TIMEOUT).toBe(60000);
    }
  });

  it('should apply default values when optional fields are missing', () => {
    const minimalEnv = {
      GCP_PROJECT_ID: 'test-project',
      WORKLOAD_IDENTITY_POOL_ID: 'test-pool',
      WORKLOAD_IDENTITY_PROVIDER_ID: 'test-provider',
      MCP_SERVICE_ACCOUNT_EMAIL: 'test@test-project.iam.gserviceaccount.com',
      GOOGLE_WORKSPACE_CLIENT_ID: 'test-client-id',
      GOOGLE_WORKSPACE_DOMAIN: 'example.com',
    };
    const result = EnvironmentSchema.safeParse(minimalEnv);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.PORT).toBe(8080);
      expect(result.data.LOG_LEVEL).toBe('info');
      expect(result.data.GCP_REGION).toBe('us-central1');
      expect(result.data.BIGQUERY_LOCATION).toBe('US');
      expect(result.data.BIGQUERY_MAX_RETRIES).toBe(3);
      expect(result.data.BIGQUERY_TIMEOUT).toBe(60000);
    }
  });

  it('should validate NODE_ENV enum values', () => {
    const invalidNodeEnv = {
      ...validEnv,
      NODE_ENV: 'invalid',
    };
    const result = EnvironmentSchema.safeParse(invalidNodeEnv);
    expect(result.success).toBe(false);
  });

  it('should validate LOG_LEVEL enum values', () => {
    const invalidLogLevel = {
      ...validEnv,
      LOG_LEVEL: 'invalid',
    };
    const result = EnvironmentSchema.safeParse(invalidLogLevel);
    expect(result.success).toBe(false);
  });
});
