import { z } from 'zod';
import { zodToJsonSchema } from 'zod-to-json-schema';

/**
 * Validation schemas for all MCP tools
 */

/**
 * Query Tool Schemas
 */
export const QueryBigQueryArgsSchema = z.object({
  query: z
    .string()
    .min(1, 'Query cannot be empty')
    .max(1000000, 'Query exceeds maximum length of 1MB')
    .refine((q) => q.trim().length > 0, 'Query cannot be only whitespace'),
  dryRun: z
    .boolean()
    .optional()
    .default(false)
    .describe('Estimate cost without executing the query'),
  maxResults: z
    .number()
    .int()
    .positive()
    .max(100000)
    .optional()
    .describe('Maximum number of results to return'),
  timeoutMs: z
    .number()
    .int()
    .positive()
    .max(600000)
    .optional()
    .describe('Query timeout in milliseconds'),
  useLegacySql: z
    .boolean()
    .optional()
    .default(false)
    .describe('Use legacy SQL syntax instead of standard SQL'),
  location: z.string().optional().describe('Geographic location where the query should run'),
  confirmCost: z
    .boolean()
    .optional()
    .default(false)
    .describe(
      'Acknowledge the estimated cost shown by a prior requires_confirmation response. When false, queries above the elicitation threshold return a confirmation prompt instead of executing.'
    ),
});

export type QueryBigQueryArgs = z.infer<typeof QueryBigQueryArgsSchema>;

/**
 * List Datasets Tool Schema
 */
export const ListDatasetsArgsSchema = z.object({
  projectId: z
    .string()
    .optional()
    .describe('Project ID to list datasets from (uses default if not specified)'),
  maxResults: z
    .number()
    .int()
    .positive()
    .max(10000)
    .optional()
    .describe('Maximum number of datasets to return'),
  includeAll: z
    .boolean()
    .optional()
    .default(false)
    .describe('Include all datasets including hidden ones'),
});

export type ListDatasetsArgs = z.infer<typeof ListDatasetsArgsSchema>;

/**
 * List Tables Tool Schema
 */
export const ListTablesArgsSchema = z.object({
  datasetId: z
    .string()
    .min(1, 'Dataset ID cannot be empty')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Dataset ID must contain only alphanumeric characters and underscores'
    ),
  projectId: z.string().optional().describe('Project ID (uses default if not specified)'),
  maxResults: z
    .number()
    .int()
    .positive()
    .max(10000)
    .optional()
    .describe('Maximum number of tables to return'),
});

export type ListTablesArgs = z.infer<typeof ListTablesArgsSchema>;

/**
 * Get Table Schema Tool Schema
 */
export const GetTableSchemaArgsSchema = z.object({
  datasetId: z
    .string()
    .min(1, 'Dataset ID cannot be empty')
    .regex(
      /^[a-zA-Z0-9_]+$/,
      'Dataset ID must contain only alphanumeric characters and underscores'
    ),
  tableId: z
    .string()
    .min(1, 'Table ID cannot be empty')
    .regex(/^[a-zA-Z0-9_]+$/, 'Table ID must contain only alphanumeric characters and underscores'),
  projectId: z.string().optional().describe('Project ID (uses default if not specified)'),
  includeMetadata: z
    .boolean()
    .optional()
    .default(true)
    .describe('Include table metadata like row count and size'),
});

export type GetTableSchemaArgs = z.infer<typeof GetTableSchemaArgsSchema>;

/**
 * Unified schema map for all tools
 */
export const TOOL_SCHEMAS = {
  query_bigquery: QueryBigQueryArgsSchema,
  execute_query: QueryBigQueryArgsSchema, // alias for backward compatibility
  list_datasets: ListDatasetsArgsSchema,
  list_tables: ListTablesArgsSchema,
  get_table_schema: GetTableSchemaArgsSchema,
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

/**
 * JSON Schema Definition (compatible with JSON Schema 7)
 */
export interface JsonSchema {
  type: string;
  properties?: Record<string, unknown>;
  required?: string[];
  description?: string;
  [key: string]: unknown;
}

/**
 * Validate tool arguments with proper error handling
 */
export function validateToolArgs<T extends ToolName>(
  toolName: T,
  args: unknown
): z.infer<(typeof TOOL_SCHEMAS)[T]> {
  const schema = TOOL_SCHEMAS[toolName];

  if (!schema) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  try {
    return schema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));

      throw new Error(`Validation failed for ${toolName}: ${JSON.stringify(issues, null, 2)}`);
    }
    throw error;
  }
}

/**
 * Get tool schema as JSON Schema for MCP tool definition.
 * Uses zod-to-json-schema for accurate conversion.
 */
export function getToolInputSchema(toolName: ToolName): JsonSchema {
  const schema = TOOL_SCHEMAS[toolName];

  if (!schema) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  return zodToJsonSchema(schema, { target: 'jsonSchema7' }) as JsonSchema;
}
