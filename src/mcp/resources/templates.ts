/**
 * BigQuery MCP Resource Templates (RFC 6570 URI templates)
 *
 * Resource templates let MCP clients (e.g. Gemini Enterprise) parameterize
 * resource URIs without the server enumerating every dataset/table. This is a
 * native MCP feature distinct from `resources/list` static resources.
 *
 * Spec: https://spec.modelcontextprotocol.io/specification/2025-06-18/server/resources/
 */

export interface BigQueryResourceTemplate {
  uriTemplate: string;
  name: string;
  description: string;
  mimeType: string;
}

export const BIGQUERY_RESOURCE_TEMPLATES: BigQueryResourceTemplate[] = [
  {
    uriTemplate: 'bigquery://datasets/{datasetId}',
    name: 'Dataset detail',
    description:
      'Dataset metadata plus a listing of contained tables. Use for catalog browsing.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'bigquery://datasets/{datasetId}/tables/{tableId}',
    name: 'Table detail',
    description: 'Full table metadata including schema, row count, and bytes.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'bigquery://datasets/{datasetId}/tables/{tableId}/schema',
    name: 'Table schema',
    description:
      'Schema-only view of a table (columns, types, modes, descriptions). Cheap to fetch and ideal for grounding LLM context.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'bigquery://datasets/{datasetId}/tables/{tableId}/sample',
    name: 'Table sample rows',
    description:
      'Up to 10 representative rows from a table, useful for grounding without scanning the full table. Honors tenant column-masking policies.',
    mimeType: 'application/json',
  },
  {
    uriTemplate: 'bigquery://jobs/{jobId}',
    name: 'Query job result',
    description:
      'Result handle for a previously submitted query job, including statistics and result rows.',
    mimeType: 'application/json',
  },
  {
    uriTemplate:
      'bigquery://datasets/{datasetId}/information_schema/{view}',
    name: 'INFORMATION_SCHEMA view',
    description:
      'Native BigQuery INFORMATION_SCHEMA view for a dataset (e.g. TABLES, COLUMNS, VIEWS). Read-only catalog browse.',
    mimeType: 'application/json',
  },
];

/** URI matchers for the read_resource handler. */
export const URI_MATCHERS = {
  schema: /^bigquery:\/\/datasets\/([^/]+)\/tables\/([^/]+)\/schema$/,
  sample: /^bigquery:\/\/datasets\/([^/]+)\/tables\/([^/]+)\/sample$/,
  job: /^bigquery:\/\/jobs\/([^/]+)$/,
  informationSchema: /^bigquery:\/\/datasets\/([^/]+)\/information_schema\/([^/]+)$/,
} as const;

/** Allowed INFORMATION_SCHEMA views (whitelist to prevent injection). */
export const ALLOWED_INFORMATION_SCHEMA_VIEWS = new Set([
  'TABLES',
  'TABLE_OPTIONS',
  'COLUMNS',
  'COLUMN_FIELD_PATHS',
  'VIEWS',
  'ROUTINES',
  'PARAMETERS',
  'PARTITIONS',
]);
