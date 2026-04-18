import { describe, it, expect } from '@jest/globals';
import { NoopDlpProvider, requiresDlp, enforceKAnonymity, kForDataset, KAnonymityViolation } from '../../src/governance/dlp';
import type { DataClassification } from '../../src/governance/policy';

const sampleClassification: DataClassification = {
  $schema: 'db-mcp/data-classification.v1',
  version: '1.0.0',
  classifications: [
    { dataset: 'analytics_public', class: 'public', piiFields: [], retentionDays: 365 },
    { dataset: 'customer_pii', class: 'regulated', piiFields: ['email'], kAnonymityK: 10, retentionDays: 2555 },
    { dataset: 'internal_logs', class: 'confidential', piiFields: [], retentionDays: 90 },
  ],
};

describe('DLP gate', () => {
  it('noop provider returns text unchanged', async () => {
    const p = new NoopDlpProvider();
    const r = await p.inspectAndDeidentify('hello email@x', ['EMAIL_ADDRESS']);
    expect(r.redacted).toBe('hello email@x');
  });

  it('requiresDlp maps classes to action', () => {
    expect(requiresDlp(sampleClassification, 'customer_pii')).toBe('full');
    expect(requiresDlp(sampleClassification, 'internal_logs')).toBe('inspect');
    expect(requiresDlp(sampleClassification, 'analytics_public')).toBe('skip');
    expect(requiresDlp(sampleClassification, 'unknown_dataset')).toBe('skip');
  });
});

describe('k-anonymity', () => {
  it('rejects groups below k when mode=reject', () => {
    expect(() => enforceKAnonymity([{ groupKey: 'g1', count: 5 }], 10, 'reject')).toThrow(KAnonymityViolation);
  });

  it('suppresses offending groups when mode=suppress', () => {
    const result = enforceKAnonymity(
      [{ groupKey: 'g1', count: 5 }, { groupKey: 'g2', count: 50 }],
      10,
      'suppress',
    );
    expect(result).toEqual([{ groupKey: 'g2', count: 50 }]);
  });

  it('kForDataset returns configured k or undefined', () => {
    expect(kForDataset(sampleClassification, 'customer_pii')).toBe(10);
    expect(kForDataset(sampleClassification, 'analytics_public')).toBeUndefined();
  });
});
