import { describe, it, expect } from '@jest/globals';
import { join } from 'node:path';
import { loadPolicies, isToolAllowed, requiresApproval } from '../../src/governance/policy';

describe('policy loader', () => {
  it('loads and schema-validates all three policy files', async () => {
    const p = await loadPolicies(join(process.cwd(), 'config', 'policies'));
    expect(p.toolGovernance.defaultAllow).toBe(false);
    expect(p.toolGovernance.allowList.length).toBeGreaterThan(0);
    expect(p.contentSafety.piiRedactionEnabled).toBe(true);
    expect(p.dataClassification.classifications.length).toBeGreaterThan(0);
  });

  it('isToolAllowed is fail-closed on unknown tools', async () => {
    const p = await loadPolicies(join(process.cwd(), 'config', 'policies'));
    expect(isToolAllowed(p.toolGovernance, 'query_bigquery').allowed).toBe(true);
    expect(isToolAllowed(p.toolGovernance, 'drop_table').allowed).toBe(false);
    expect(isToolAllowed(p.toolGovernance, 'never_heard_of_it').allowed).toBe(false);
  });

  it('requiresApproval matches policy', async () => {
    const p = await loadPolicies(join(process.cwd(), 'config', 'policies'));
    expect(requiresApproval(p.toolGovernance, 'query_bigquery')).toBe(false);
  });
});
