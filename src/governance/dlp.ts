import { logger } from '../utils/logger.js';
import type { DataClassification } from './policy.js';

/**
 * DLP + k-anonymity controls (§11.8).
 *
 * This module is the integration seam for Google Cloud Sensitive Data
 * Protection (SDP / formerly DLP API). Callers pass a `DlpProvider`; the
 * production wiring in src/bigquery/ or src/security/ supplies the real
 * GCP client. Framework requires inspect-and-deidentify on inputs/outputs
 * for regulated data classes, and a k-anonymity threshold check on cohort
 * queries.
 */

export interface DlpFinding {
  infoType: string;
  quote?: string;
  likelihood: 'VERY_UNLIKELY' | 'UNLIKELY' | 'POSSIBLE' | 'LIKELY' | 'VERY_LIKELY';
  offset?: number;
  length?: number;
}

export interface DlpInspectResult {
  findings: DlpFinding[];
  redacted: string;
}

export interface DlpProvider {
  inspectAndDeidentify(text: string, infoTypes: string[]): Promise<DlpInspectResult>;
}

/** Null provider used in dev/tests — does nothing, flagged in boundary contract. */
export class NoopDlpProvider implements DlpProvider {
  inspectAndDeidentify(text: string): Promise<DlpInspectResult> {
    return Promise.resolve({ findings: [], redacted: text });
  }
}

/**
 * Decide whether a dataset should have DLP applied based on classification.
 * Regulated → always; confidential → inspect only; internal/public → skip.
 */
export function requiresDlp(
  classification: DataClassification,
  dataset: string
): 'full' | 'inspect' | 'skip' {
  const entry = classification.classifications.find((c) => c.dataset === dataset);
  if (!entry) return 'skip';
  if (entry.class === 'regulated') return 'full';
  if (entry.class === 'confidential') return 'inspect';
  return 'skip';
}

/** k-anonymity cohort check (§11.8). */
export interface CohortRow {
  groupKey: string;
  count: number;
}

export class KAnonymityViolation extends Error {
  constructor(
    public readonly k: number,
    public readonly offendingGroups: string[]
  ) {
    super(`k-anonymity violation: ${offendingGroups.length} groups below k=${k}`);
    this.name = 'KAnonymityViolation';
  }
}

/**
 * Enforce a k threshold on a cohort result. Groups below `k` are dropped
 * and the caller decides whether to proceed with the filtered result or
 * fail closed. For audit, we always emit a finding.
 */
export function enforceKAnonymity(
  rows: CohortRow[],
  k: number,
  mode: 'suppress' | 'reject' = 'reject'
): CohortRow[] {
  if (k < 1) return rows;
  const offending = rows.filter((r) => r.count < k).map((r) => r.groupKey);
  if (offending.length === 0) return rows;
  logger.warn('k-anonymity threshold breached', { k, offendingCount: offending.length, mode });
  if (mode === 'reject') throw new KAnonymityViolation(k, offending);
  return rows.filter((r) => r.count >= k);
}

export function kForDataset(
  classification: DataClassification,
  dataset: string
): number | undefined {
  return classification.classifications.find((c) => c.dataset === dataset)?.kAnonymityK;
}
