import { z } from 'zod';

/**
 * Validation schemas for all MCP tools
 */

/**
 * Query Tool Schemas
 */
export const QueryBigQueryArgsSchema = z.object({
  query: z.string()
    .min(1, 'Query cannot be empty')
    .max(1000000, 'Query exceeds maximum length of 1MB')
    .refine(
      (q) => q.trim().length > 0,
      'Query cannot be only whitespace'
    ),
  dryRun: z.boolean()
    .optional()
    .default(false)
    .describe('Estimate cost without executing the query'),
  maxResults: z.number()
    .int()
    .positive()
    .max(100000)
    .optional()
    .describe('Maximum number of results to return'),
  timeoutMs: z.number()
    .int()
    .positive()
    .max(600000)
    .optional()
    .describe('Query timeout in milliseconds'),
  useLegacySql: z.boolean()
    .optional()
    .default(false)
    .describe('Use legacy SQL syntax instead of standard SQL'),
  location: z.string()
    .optional()
    .describe('Geographic location where the query should run'),
});

export type QueryBigQueryArgs = z.infer<typeof QueryBigQueryArgsSchema>;

/**
 * List Datasets Tool Schema
 */
export const ListDatasetsArgsSchema = z.object({
  projectId: z.string()
    .optional()
    .describe('Project ID to list datasets from (uses default if not specified)'),
  maxResults: z.number()
    .int()
    .positive()
    .max(10000)
    .optional()
    .describe('Maximum number of datasets to return'),
  includeAll: z.boolean()
    .optional()
    .default(false)
    .describe('Include all datasets including hidden ones'),
});

export type ListDatasetsArgs = z.infer<typeof ListDatasetsArgsSchema>;

/**
 * List Tables Tool Schema
 */
export const ListTablesArgsSchema = z.object({
  datasetId: z.string()
    .min(1, 'Dataset ID cannot be empty')
    .regex(/^[a-zA-Z0-9_]+$/, 'Dataset ID must contain only alphanumeric characters and underscores'),
  projectId: z.string()
    .optional()
    .describe('Project ID (uses default if not specified)'),
  maxResults: z.number()
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
  datasetId: z.string()
    .min(1, 'Dataset ID cannot be empty')
    .regex(/^[a-zA-Z0-9_]+$/, 'Dataset ID must contain only alphanumeric characters and underscores'),
  tableId: z.string()
    .min(1, 'Table ID cannot be empty')
    .regex(/^[a-zA-Z0-9_]+$/, 'Table ID must contain only alphanumeric characters and underscores'),
  projectId: z.string()
    .optional()
    .describe('Project ID (uses default if not specified)'),
  includeMetadata: z.boolean()
    .optional()
    .default(true)
    .describe('Include table metadata like row count and size'),
});

export type GetTableSchemaArgs = z.infer<typeof GetTableSchemaArgsSchema>;

/**
 * Create Dataset Tool Schema
 */
export const CreateDatasetArgsSchema = z.object({
  datasetId: z.string()
    .min(1, 'Dataset ID cannot be empty')
    .regex(/^[a-zA-Z0-9_]+$/, 'Dataset ID must contain only alphanumeric characters and underscores'),
  projectId: z.string()
    .optional()
    .describe('Project ID (uses default if not specified)'),
  location: z.string()
    .optional()
    .default('US')
    .describe('Geographic location for the dataset'),
  description: z.string()
    .optional()
    .describe('Dataset description'),
  defaultTableExpirationMs: z.number()
    .int()
    .positive()
    .optional()
    .describe('Default expiration time for tables in milliseconds'),
});

export type CreateDatasetArgs = z.infer<typeof CreateDatasetArgsSchema>;

/**
 * Delete Dataset Tool Schema
 */
export const DeleteDatasetArgsSchema = z.object({
  datasetId: z.string()
    .min(1, 'Dataset ID cannot be empty'),
  projectId: z.string()
    .optional()
    .describe('Project ID (uses default if not specified)'),
  deleteContents: z.boolean()
    .optional()
    .default(false)
    .describe('Delete all tables in the dataset before deleting the dataset'),
});

export type DeleteDatasetArgs = z.infer<typeof DeleteDatasetArgsSchema>;

/**
 * Get Query Job Status Schema
 */
export const GetJobStatusArgsSchema = z.object({
  jobId: z.string()
    .min(1, 'Job ID cannot be empty'),
  projectId: z.string()
    .optional()
    .describe('Project ID (uses default if not specified)'),
  location: z.string()
    .optional()
    .describe('Job location'),
});

export type GetJobStatusArgs = z.infer<typeof GetJobStatusArgsSchema>;

/**
 * Cancel Query Job Schema
 */
export const CancelJobArgsSchema = z.object({
  jobId: z.string()
    .min(1, 'Job ID cannot be empty'),
  projectId: z.string()
    .optional()
    .describe('Project ID (uses default if not specified)'),
  location: z.string()
    .optional()
    .describe('Job location'),
});

export type CancelJobArgs = z.infer<typeof CancelJobArgsSchema>;

/**
 * Export Query Results Schema
 */
export const ExportQueryResultsArgsSchema = z.object({
  query: z.string()
    .min(1, 'Query cannot be empty'),
  destinationUri: z.string()
    .url('Must be a valid GCS URI (gs://bucket/path)')
    .regex(/^gs:\/\//, 'URI must start with gs://'),
  format: z.enum(['CSV', 'JSON', 'AVRO', 'PARQUET'])
    .optional()
    .default('CSV')
    .describe('Export format'),
  compression: z.enum(['GZIP', 'NONE'])
    .optional()
    .default('NONE')
    .describe('Compression type'),
  printHeader: z.boolean()
    .optional()
    .default(true)
    .describe('Include header row in CSV export'),
});

export type ExportQueryResultsArgs = z.infer<typeof ExportQueryResultsArgsSchema>;

/**
 * Unified schema map for all tools
 */
export const TOOL_SCHEMAS = {
  query_bigquery: QueryBigQueryArgsSchema,
  execute_query: QueryBigQueryArgsSchema, // alias for backward compatibility
  list_datasets: ListDatasetsArgsSchema,
  list_tables: ListTablesArgsSchema,
  get_table_schema: GetTableSchemaArgsSchema,
  create_dataset: CreateDatasetArgsSchema,
  delete_dataset: DeleteDatasetArgsSchema,
  get_job_status: GetJobStatusArgsSchema,
  cancel_job: CancelJobArgsSchema,
  export_query_results: ExportQueryResultsArgsSchema,
} as const;

export type ToolName = keyof typeof TOOL_SCHEMAS;

/**
 * Validate tool arguments with proper error handling
 */
export function validateToolArgs<T extends ToolName>(
  toolName: T,
  args: unknown
): z.infer<typeof TOOL_SCHEMAS[T]> {
  const schema = TOOL_SCHEMAS[toolName];

  if (!schema) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  try {
    return schema.parse(args);
  } catch (error) {
    if (error instanceof z.ZodError) {
      const issues = error.issues.map(issue => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));

      throw new Error(
        `Validation failed for ${toolName}: ${JSON.stringify(issues, null, 2)}`
      );
    }
    throw error;
  }
}

/**
 * Get tool schema as JSON Schema for MCP tool definition
 */
export function getToolInputSchema(toolName: ToolName): Record<string, any> {
  const schema = TOOL_SCHEMAS[toolName];

  if (!schema) {
    throw new Error(`Unknown tool: ${toolName}`);
  }

  // Convert Zod schema to JSON Schema
  // This is a simplified conversion - you may want to use zod-to-json-schema for production
  return {
    type: 'object',
    properties: Object.fromEntries(
      Object.entries(schema.shape).map(([key]) => [
        key,
        { type: 'string' } // Simplified - should properly convert each field type
      ])
    ),
    required: Object.keys(schema.shape).filter(
      key => !(schema.shape as any)[key].isOptional()
    ),
  };
}
