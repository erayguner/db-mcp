/**
 * MCP tool annotations (2025-06-18 spec) plus cost-guardrail thresholds.
 *
 * `readOnlyHint` / `destructiveHint` / `idempotentHint` / `openWorldHint`
 * let MCP clients risk-classify a tool before invocation. The extension
 * fields (`title`, `costHintTier`) are non-normative metadata that Gemini
 * Enterprise and other UIs surface in confirmation prompts.
 */

export interface ToolAnnotations {
  /** Human-readable display title. */
  title?: string;
  readOnlyHint: boolean;
  destructiveHint: boolean;
  idempotentHint: boolean;
  /** True when the tool reaches out to systems beyond its declared scope. */
  openWorldHint: boolean;
  /** Non-normative hint: cost tier ('low' | 'medium' | 'high'). */
  costHintTier?: 'low' | 'medium' | 'high';
}

export function readOnlyAnnotations(): ToolAnnotations {
  return {
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    costHintTier: 'low',
  };
}

const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  query_bigquery: {
    title: 'Run a BigQuery SQL query',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
    costHintTier: 'high',
  },
  execute_query: {
    title: 'Execute a parameterized BigQuery query',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: false,
    openWorldHint: true,
    costHintTier: 'high',
  },
  list_datasets: {
    title: 'List BigQuery datasets',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    costHintTier: 'low',
  },
  list_tables: {
    title: 'List tables in a BigQuery dataset',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    costHintTier: 'low',
  },
  get_table_schema: {
    title: 'Get a BigQuery table schema',
    readOnlyHint: true,
    destructiveHint: false,
    idempotentHint: true,
    openWorldHint: false,
    costHintTier: 'low',
  },
};

export function getToolAnnotations(toolName: string): ToolAnnotations {
  return TOOL_ANNOTATIONS[toolName] || readOnlyAnnotations();
}

/**
 * Cost-elicitation thresholds. A query whose dry-run estimate exceeds the
 * configured byte threshold triggers a `requires_confirmation` response so
 * the client (Gemini Enterprise, Claude, etc.) can prompt the user.
 *
 * Tuned via env:
 * - `MCP_COST_ELICITATION_BYTES` (default: 10 GiB)
 * - `MCP_COST_ELICITATION_ENABLED` (default: true)
 * - `MCP_BQ_USD_PER_TIB` (default: 6.25 — on-demand BigQuery US pricing as of 2026)
 */
export interface CostElicitationConfig {
  enabled: boolean;
  thresholdBytes: number;
  usdPerTiB: number;
}

export function loadCostElicitationConfig(): CostElicitationConfig {
  const TEN_GIB = 10 * 1024 * 1024 * 1024;
  const enabled = (process.env.MCP_COST_ELICITATION_ENABLED ?? 'true').toLowerCase() !== 'false';
  const thresholdBytes = Number(process.env.MCP_COST_ELICITATION_BYTES) || TEN_GIB;
  const usdPerTiB = Number(process.env.MCP_BQ_USD_PER_TIB) || 6.25;
  return { enabled, thresholdBytes, usdPerTiB };
}

/** Compute approximate cost in USD for a given bytesProcessed value. */
export function estimateQueryCostUsd(bytesProcessed: number, usdPerTiB: number): number {
  const tib = bytesProcessed / 1024 ** 4;
  return Math.round(tib * usdPerTiB * 10000) / 10000;
}
