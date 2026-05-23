import { z } from 'zod';
import dotenv from 'dotenv';
import { logger } from '../utils/logger.js';

// Load environment variables
dotenv.config();

/**
 * Environment configuration with validation
 */

export const EnvironmentSchema = z.object({
  // Server
  NODE_ENV: z
    .enum(['development', 'staging', 'production', 'test'])
    .default(process.env.JEST_WORKER_ID ? 'test' : 'development'),
  PORT: z.string().transform(Number).default('8080'),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'debug']).default('info'),

  // GCP
  GCP_PROJECT_ID: z.string(),
  GCP_REGION: z.string().default('europe-west2'),

  // Workload Identity Federation (optional — required only for WIF auth)
  WORKLOAD_IDENTITY_POOL_ID: z.string().default(''),
  WORKLOAD_IDENTITY_PROVIDER_ID: z.string().default(''),
  MCP_SERVICE_ACCOUNT_EMAIL: z
    .string()
    .refine((v) => v === '' || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v), {
      message: 'Must be empty or a valid email address',
    })
    .default(''),

  // Google Workspace (optional — required only for Workspace auth)
  GOOGLE_WORKSPACE_CLIENT_ID: z.string().default(''),
  GOOGLE_WORKSPACE_DOMAIN: z.string().default(''),
  GOOGLE_WORKSPACE_ALLOWED_GROUPS: z
    .string()
    .optional()
    .transform((val) => (val ? val.split(',').map((g) => g.trim()) : undefined)),

  // BigQuery
  BIGQUERY_LOCATION: z.string().default('europe-west2'),
  BIGQUERY_MAX_RETRIES: z.string().transform(Number).default('3'),
  BIGQUERY_TIMEOUT: z.string().transform(Number).default('60000'),

  // Transport
  MCP_TRANSPORT: z.enum(['stdio', 'http']).default('stdio'),
  MCP_HTTP_PORT: z.string().transform(Number).default('8080'),

  // Tenancy
  TENANT_CONFIG_PATH: z.string().default('./src/config/tenants.yaml'),
  TENANT_HOT_RELOAD: z
    .string()
    .transform((v) => v === 'true')
    .default('true'),

  // Model Armor
  /**
   * Set to 'true' to enable Google Cloud Model Armor pre-flight screening.
   * Defaults to false so dev/test environments require no GCP wiring.
   */
  MODEL_ARMOR_ENABLED: z
    .string()
    .transform((v) => v === 'true')
    .default('false'),
  /**
   * Full resource name of the Model Armor template to use.
   * Format: projects/{project}/locations/{location}/templates/{template}
   * Required when MODEL_ARMOR_ENABLED=true.
   */
  MODEL_ARMOR_TEMPLATE: z.string().default(''),
  /**
   * GCP region for the Model Armor API endpoint.
   * Defaults to europe-west2 (same as compute region default).
   */
  MODEL_ARMOR_LOCATION: z.string().default('europe-west2'),
  /**
   * When 'fail-closed', a Model Armor API error blocks the request.
   * When 'fail-open' (default), API errors log a warning and allow the request.
   */
  MODEL_ARMOR_ON_ERROR: z.enum(['fail-open', 'fail-closed']).default('fail-open'),
});

export type Environment = z.infer<typeof EnvironmentSchema>;

/**
 * Parse and validate environment variables
 */
export function loadEnvironment(): Environment {
  try {
    return EnvironmentSchema.parse(process.env);
  } catch (error) {
    logger.error('Environment validation failed', { error });
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
