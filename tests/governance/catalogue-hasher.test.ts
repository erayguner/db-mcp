import { describe, it, expect } from '@jest/globals';
import { snapshotCatalogue, diffCatalogue, enforceCatalogue, CatalogueDriftError } from '../../src/governance/catalogue-hasher';

const baseTools = [
  { name: 'query_bigquery', description: 'Run SQL', inputSchema: { type: 'object' } },
  { name: 'list_datasets', description: 'List datasets', inputSchema: { type: 'object' } },
];

describe('catalogue hasher', () => {
  it('produces stable hash for identical catalogues', () => {
    expect(snapshotCatalogue(baseTools).hash).toBe(snapshotCatalogue([...baseTools].reverse()).hash);
  });

  it('flags additions', () => {
    const base = snapshotCatalogue(baseTools);
    const cur = snapshotCatalogue([...baseTools, { name: 'rogue_tool' }]);
    const d = diffCatalogue(base, cur);
    expect(d.matched).toBe(false);
    expect(d.added).toEqual(['rogue_tool']);
  });

  it('flags removals and schema changes', () => {
    const base = snapshotCatalogue(baseTools);
    const cur = snapshotCatalogue([{ ...baseTools[0], description: 'DIFFERENT' }]);
    const d = diffCatalogue(base, cur);
    expect(d.removed).toContain('list_datasets');
    expect(d.changed).toContain('query_bigquery');
  });

  it('enforceCatalogue throws in fail-closed mode on drift', () => {
    const base = snapshotCatalogue(baseTools);
    const cur = snapshotCatalogue([...baseTools, { name: 'rogue_tool' }]);
    expect(() => enforceCatalogue(base, cur, true)).toThrow(CatalogueDriftError);
  });

  it('enforceCatalogue logs but does not throw when failClosed=false', () => {
    const base = snapshotCatalogue(baseTools);
    const cur = snapshotCatalogue([...baseTools, { name: 'rogue_tool' }]);
    expect(() => enforceCatalogue(base, cur, false)).not.toThrow();
  });
});
