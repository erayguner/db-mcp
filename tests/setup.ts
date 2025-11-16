/**
 * Jest Test Setup
 * Configures global test environment for BigQuery MCP Server
 */

// Set test environment
process.env.NODE_ENV = 'test';
process.env.GCP_PROJECT_ID = 'test-project';
process.env.GCP_REGION = 'us-central1';
process.env.WORKLOAD_IDENTITY_POOL_ID = 'test-pool';
process.env.WORKLOAD_IDENTITY_PROVIDER_ID = 'test-provider';
process.env.MCP_SERVICE_ACCOUNT_EMAIL = 'test@test-project.iam.gserviceaccount.com';
process.env.GOOGLE_WORKSPACE_CLIENT_ID = 'test-client-id';
process.env.GOOGLE_WORKSPACE_DOMAIN = 'test.com';
process.env.BIGQUERY_LOCATION = 'US';
process.env.BIGQUERY_MAX_RETRIES = '3';
process.env.BIGQUERY_TIMEOUT = '60000';
process.env.ENABLE_CORS = 'false';
process.env.ENABLE_METRICS = 'false';
process.env.ENABLE_TRACING = 'false';
process.env.LOG_LEVEL = 'error';

// Global test timeout
jest.setTimeout(30000);

// Suppress console output during tests
global.console = {
  ...console,
  log: jest.fn(),
  debug: jest.fn(),
  info: jest.fn(),
  warn: jest.fn(),
  // Keep error for debugging
  error: console.error,
};
