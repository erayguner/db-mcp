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
    ENABLE_CORS: 'true',
    MAX_QUERY_SIZE_BYTES: '10485760',
    ENABLE_METRICS: 'true',
    ENABLE_TRACING: 'false',
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

  it('should parse boolean strings correctly', () => {
    const result = EnvironmentSchema.safeParse(validEnv);
    if (result.success) {
      expect(result.data.ENABLE_CORS).toBe(true);
      expect(result.data.ENABLE_TRACING).toBe(false);
    }
  });
});
