#!/usr/bin/env tsx
import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { BoundaryContractSchema } from '../../src/governance/boundary-contract.js';
import { loadPolicies } from '../../src/governance/policy.js';

/**
 * CI pre-flight gate (§16.3) — fail build on any invalid policy or
 * boundary contract. Invoked from .github/workflows/governance.yml.
 */

async function validatePolicies(root: string): Promise<void> {
  const dir = join(root, 'config', 'policies');
  const loaded = await loadPolicies(dir);
  console.log(
    `[policies] loaded tool-governance v${loaded.toolGovernance.version}, content-safety v${loaded.contentSafety.version}, data-classification v${loaded.dataClassification.version}`
  );
}

async function validateContracts(root: string): Promise<void> {
  const dir = join(root, 'docs', 'governance', 'boundary-contracts');
  const files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  if (files.length === 0) throw new Error(`no boundary contracts found in ${dir}`);
  for (const file of files) {
    const raw = JSON.parse(await readFile(join(dir, file), 'utf8'));
    const parsed = BoundaryContractSchema.parse(raw);
    console.log(`[contract] ${parsed.name} v${parsed.version} role=${parsed.role}`);
  }
}

async function main(): Promise<void> {
  const root = process.cwd();
  await validatePolicies(root);
  await validateContracts(root);
  console.log('governance validation passed');
}

main().catch((err) => {
  console.error('governance validation FAILED:', err);
  process.exit(1);
});
