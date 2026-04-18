import { describe, it, expect } from '@jest/globals';
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BoundaryContractSchema } from '../../src/governance/boundary-contract';

describe('boundary contracts', () => {
  it('every tool in the allow-list has a boundary contract on disk', async () => {
    const dir = join(process.cwd(), 'docs', 'governance', 'boundary-contracts');
    const files = (await readdir(dir)).filter(f => f.endsWith('.json'));
    expect(files.length).toBeGreaterThanOrEqual(4);
    for (const file of files) {
      const raw = JSON.parse(await readFile(join(dir, file), 'utf8'));
      const parsed = BoundaryContractSchema.parse(raw);
      expect(parsed.role).toMatch(/observer|advisor|operator|autonomous-operator/);
      expect(parsed.dataClasses.length).toBeGreaterThan(0);
      expect(parsed.owner.contact).toBeTruthy();
    }
  });

  it('schema rejects contracts missing required fields', () => {
    expect(() => BoundaryContractSchema.parse({ name: 'x' })).toThrow();
  });
});
