import { z } from 'zod';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

/**
 * Environment configuration with validation
 */

export const EnvironmentSchema = z.object({
  // Server
  NODE_ENV: z.enum(['development', 'staging', 'production']).default('development'),
  PORT: z.string().transform(Number).default('8080'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // GCP
  GCP_PROJECT_ID: z.string(),
  GCP_REGION: z.string().default('us-central1'),
  
  // Workload Identity Federation
  WORKLOAD_IDENTITY_POOL_ID: z.string(),
  WORKLOAD_IDENTITY_PROVIDER_ID: z.string(),
  MCP_SERVICE_ACCOUNT_EMAIL: z.string().email(),
  
  // Google Workspace
  GOOGLE_WORKSPACE_CLIENT_ID: z.string(),
  GOOGLE_WORKSPACE_DOMAIN: z.string(),
  GOOGLE_WORKSPACE_ALLOWED_GROUPS: z.string().optional().transform(val => 
    val ? val.split(',').map(g => g.trim()) : undefined
  ),

  // BigQuery
  BIGQUERY_LOCATION: z.string().default('US'),
  BIGQUERY_MAX_RETRIES: z.string().transform(Number).default('3'),
  BIGQUERY_TIMEOUT: z.string().transform(Number).default('60000'),

  // Security
  ENABLE_CORS: z.string().transform(val => val === 'true').default('true'),
  ALLOWED_ORIGINS: z.string().optional().transform(val =>
    val ? val.split(',').map(o => o.trim()) : ['*']
  ),
  MAX_QUERY_SIZE_BYTES: z.string().transform(Number).default('10485760'), // 10MB

  // Monitoring
  ENABLE_METRICS: z.string().transform(val => val === 'true').default('true'),
  ENABLE_TRACING: z.string().transform(val => val === 'true').default('false'),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * Parse and validate environment variables
 */
export function loadEnvironment(): Environment {
  try {
    return EnvironmentSchema.parse(process.env);
  } catch (error) {
    console.error('Environment validation failed:', error);
    throw new Error('Invalid environment configuration');
  }
}

/**
 * Get environment singleton
 */
let envInstance: Environment | null = null;

export function getEnvironment(): Environment {
  if (!envInstance) {
    envInstance = loadEnvironment();
  }
  return envInstance;
}
