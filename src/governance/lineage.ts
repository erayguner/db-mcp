import { createHash } from 'node:crypto';

/**
 * Data lineage helpers (§11.7).
 *
 * Consumers (tool handlers) call `makeSourceRef` at retrieval time so the
 * resulting version string lands on the audit event that produced the
 * answer. Any knowledge-base ingestion pipeline must produce versions the
 * same way so lineage is comparable across reads.
 */

export type LineageSourceType =
  | 'bigquery_table'
  | 'bigquery_dataset'
  | 'document_store'
  | 'vector_index'
  | 'prompt_template';

export interface LineageSourceRef {
  type: LineageSourceType;
  identifier: string;
  version: string;
}

/**
 * Derive a deterministic version for a BigQuery table from
 * last_modified_time + num_rows. Caller passes BQ metadata; this avoids
 * coupling the governance layer to @google-cloud/bigquery.
 */
export function bigQueryTableVersion(meta: { lastModifiedTime?: string | number | Date; numRows?: string | number }): string {
  const t = meta.lastModifiedTime ? new Date(meta.lastModifiedTime).toISOString() : 'unknown';
  const n = String(meta.numRows ?? 'unknown');
  return sha1(`${t}|${n}`).slice(0, 16);
}

export function promptTemplateVersion(contents: string): string {
  return sha1(contents).slice(0, 16);
}

export function makeSourceRef(type: LineageSourceType, identifier: string, version: string): LineageSourceRef {
  return { type, identifier, version };
}

function sha1(s: string): string {
  return createHash('sha1').update(s).digest('hex');
}
