import { z } from 'zod';

export const ProvenanceSchema = z.object({
  source: z.literal('bigquery'),
  projectId: z.string(),
  datasetId: z.string().optional(),
  tableId: z.string().optional(),
  retrievedAt: z.string().datetime(),
  consoleUrl: z.string().url().optional(),
  freshness: z.enum(['real-time', 'cached']),
  cacheAgeMs: z.number().nonnegative().optional(),
  jobId: z.string().optional(),
  bytesProcessed: z.string().optional(),
  query: z.string().optional(),
  /**
   * Columns whose values were rewritten by the tenant's column-masking policy.
   * Present only when masking actually altered the result, so its absence is a
   * truthful signal that no masking was applied.
   */
  maskedColumns: z.array(z.string()).optional(),
});

export type Provenance = z.infer<typeof ProvenanceSchema>;

export const SchemaContextSchema = z.object({
  columns: z.array(
    z.object({
      name: z.string(),
      type: z.string(),
      description: z.string().optional(),
      mode: z.string(),
    })
  ),
  tableDescription: z.string().optional(),
  datasetDescription: z.string().optional(),
});

export type SchemaContext = z.infer<typeof SchemaContextSchema>;

/**
 * A query that actually ran and returned rows.
 */
export const QueryExecutedOutputSchema = z.object({
  rowCount: z.number().int().nonnegative(),
  rows: z.array(z.record(z.unknown())), // replaced any with unknown
  schema: z.array(z.object({}).passthrough()).optional(), // generic schema fields passthrough
  jobId: z.string(),
  cacheHit: z.boolean().optional(),
  executionTimeMs: z.number().int().nonnegative(),
  totalBytesProcessed: z.string().optional(),
  provenance: ProvenanceSchema.optional(),
  schemaContext: SchemaContextSchema.optional(),
  /** Present on the chunked path for very large result sets. */
  truncated: z.boolean().optional(),
});

/**
 * A `dryRun: true` request: nothing executed, cost estimate only.
 */
export const QueryDryRunOutputSchema = z.object({
  dryRun: z.literal(true),
  totalBytesProcessed: z.string().optional(),
  estimatedCostUSD: z.number().nonnegative().optional(),
  provenance: ProvenanceSchema.optional(),
});

/**
 * The cost-elicitation gate tripped: the query was NOT executed and the caller
 * must re-invoke with `confirmCost: true`.
 */
export const QueryConfirmationRequiredOutputSchema = z.object({
  status: z.literal('requires_confirmation'),
  reason: z.literal('cost_threshold_exceeded'),
  message: z.string(),
  estimate: z.object({
    totalBytesProcessed: z.number().nonnegative(),
    estimatedCostUSD: z.number().nonnegative(),
    thresholdBytes: z.number().nonnegative(),
    usdPerTiB: z.number().nonnegative(),
  }),
});

/**
 * The query tools have three legitimate success shapes. Declaring only the
 * executed shape made the dry-run and confirmation paths violate the tool's own
 * advertised outputSchema, which strict MCP clients reject.
 */
export const QueryBigQueryOutputSchema = z.union([
  QueryExecutedOutputSchema,
  QueryDryRunOutputSchema,
  QueryConfirmationRequiredOutputSchema,
]);

export const ListDatasetsOutputSchema = z.object({
  count: z.number().int().nonnegative(),
  datasets: z.array(
    z.object({
      id: z.string(),
      projectId: z.string(),
      location: z.string(),
      creationTime: z.string(),
      lastModifiedTime: z.string(),
      description: z.string().optional(),
    })
  ),
  provenance: ProvenanceSchema.optional(),
});

export const ListTablesOutputSchema = z.object({
  datasetId: z.string(),
  count: z.number().int().nonnegative(),
  tables: z.array(
    z.object({
      id: z.string(),
      tableId: z.string(),
      type: z.string(),
      creationTime: z.string(),
      numRows: z.number().int().nonnegative().optional(),
      numBytes: z.number().int().nonnegative().optional(),
      description: z.string().optional(),
    })
  ),
  provenance: ProvenanceSchema.optional(),
});

export const GetTableSchemaOutputSchema = z.object({
  datasetId: z.string(),
  tableId: z.string(),
  schema: z.array(z.object({}).passthrough()),
  metadata: z
    .object({
      type: z.string(),
      creationTime: z.string(),
      lastModifiedTime: z.string(),
      numRows: z.number().int().nonnegative().optional(),
      numBytes: z.number().int().nonnegative().optional(),
      description: z.string().optional(),
    })
    .optional(),
  provenance: ProvenanceSchema.optional(),
});

export const OUTPUT_SCHEMAS = {
  query_bigquery: QueryBigQueryOutputSchema,
  execute_query: QueryBigQueryOutputSchema,
  list_datasets: ListDatasetsOutputSchema,
  list_tables: ListTablesOutputSchema,
  get_table_schema: GetTableSchemaOutputSchema,
} as const;

export type OutputSchemaName = keyof typeof OUTPUT_SCHEMAS;
