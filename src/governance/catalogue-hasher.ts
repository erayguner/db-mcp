import { createHash } from 'node:crypto';
import { logger } from '../utils/logger.js';

/**
 * MCP tool catalogue drift detection (§4.5).
 *
 * Hash the tool catalogue at the start of every session. Unexpected
 * additions/removals are audited as a finding; a mismatch against a pinned
 * baseline fails-closed in production.
 */

export interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface CatalogueSnapshot {
  hash: string;
  tools: { name: string; schemaHash: string }[];
  takenAt: string;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.keys(value as Record<string, unknown>).sort();
    return `{${entries.map(k => `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(s: string): string {
  return createHash('sha256').update(s).digest('hex');
}

export function snapshotCatalogue(tools: ToolDescriptor[]): CatalogueSnapshot {
  const sorted = [...tools].sort((a, b) => a.name.localeCompare(b.name));
  const entries = sorted.map(t => ({ name: t.name, schemaHash: sha256(canonicalJson({ d: t.description, s: t.inputSchema })) }));
  return {
    hash: sha256(canonicalJson(entries)),
    tools: entries,
    takenAt: new Date().toISOString(),
  };
}

export interface DriftReport {
  matched: boolean;
  baselineHash?: string;
  currentHash: string;
  added: string[];
  removed: string[];
  changed: string[];
}

export function diffCatalogue(baseline: CatalogueSnapshot | null, current: CatalogueSnapshot): DriftReport {
  if (!baseline) return { matched: false, currentHash: current.hash, added: current.tools.map(t => t.name), removed: [], changed: [] };
  const baseMap = new Map(baseline.tools.map(t => [t.name, t.schemaHash]));
  const curMap = new Map(current.tools.map(t => [t.name, t.schemaHash]));
  const added = [...curMap.keys()].filter(n => !baseMap.has(n));
  const removed = [...baseMap.keys()].filter(n => !curMap.has(n));
  const changed = [...curMap.keys()].filter(n => baseMap.has(n) && baseMap.get(n) !== curMap.get(n));
  const matched = baseline.hash === current.hash;
  return { matched, baselineHash: baseline.hash, currentHash: current.hash, added, removed, changed };
}

/**
 * Fail-closed in production (failClosed=true). Dev mode logs a warning.
 * Returns the report for callers that want to also audit the finding.
 */
export function enforceCatalogue(
  baseline: CatalogueSnapshot | null,
  current: CatalogueSnapshot,
  failClosed: boolean,
): DriftReport {
  const report = diffCatalogue(baseline, current);
  if (!report.matched) {
    logger.warn('MCP catalogue drift detected', { report, failClosed });
    if (failClosed) throw new CatalogueDriftError(report);
  }
  return report;
}

export class CatalogueDriftError extends Error {
  constructor(public readonly report: DriftReport) {
    super(`MCP catalogue drift: +${report.added.length}/-${report.removed.length}/~${report.changed.length}`);
    this.name = 'CatalogueDriftError';
  }
}
