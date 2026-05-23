import { z } from 'zod';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Policy-as-code loader + schemas (§6.1, §16.1).
 *
 * Policies are JSON files in config/policies/; loaded at startup and
 * validated against Zod schemas. Unparseable policies raise (§6.3), unknown
 * tools deny (§4.2, default_allow = false).
 */

export const BudgetLimitsSchema = z.object({
  maxTotalCalls: z.number().int().positive(),
  maxCallsPerTool: z.record(z.number().int().positive()).default({}),
  maxRuntimeMs: z.number().int().positive(),
  maxParallelism: z.number().int().positive().default(4),
  separationOfDuties: z.array(z.tuple([z.string(), z.string()])).default([]),
});

export const ArgumentGateSchema = z.object({
  tool: z.string(),
  maxArgBytes: z
    .number()
    .int()
    .positive()
    .default(64 * 1024),
  denyRegex: z.array(z.string()).default([]),
  requiredFields: z.array(z.string()).default([]),
});

export const ToolGovernanceSchema = z.object({
  $schema: z.literal('db-mcp/tool-governance.v1'),
  version: z.string(),
  defaultAllow: z.literal(false),
  allowList: z.array(z.string()).min(1),
  denyList: z.array(z.string()).default([]),
  requireApproval: z.array(z.string()).default([]),
  categories: z.record(z.enum(['discovery', 'connection', 'execution', 'other'])),
  budgets: BudgetLimitsSchema,
  argumentGates: z.array(ArgumentGateSchema).default([]),
});
export type ToolGovernance = z.infer<typeof ToolGovernanceSchema>;

export const ContentSafetySchema = z.object({
  $schema: z.literal('db-mcp/content-safety.v1'),
  version: z.string(),
  piiRedactionEnabled: z.boolean(),
  secretScannerEnabled: z.boolean(),
  promptInjectionPatterns: z.array(z.string()).min(1),
  sensitivePatterns: z.array(z.string()).min(1),
  deniedTopics: z.array(z.string()).default([]),
  modelArmorMode: z.enum(['inspect_only', 'inspect_and_block']).default('inspect_and_block'),
});
export type ContentSafety = z.infer<typeof ContentSafetySchema>;

export const DataClassificationSchema = z.object({
  $schema: z.literal('db-mcp/data-classification.v1'),
  version: z.string(),
  classifications: z.array(
    z.object({
      dataset: z.string(),
      class: z.enum(['public', 'internal', 'confidential', 'regulated']),
      piiFields: z.array(z.string()).default([]),
      kAnonymityK: z.number().int().min(1).optional(),
      retentionDays: z.number().int().positive(),
    })
  ),
});
export type DataClassification = z.infer<typeof DataClassificationSchema>;

export interface LoadedPolicies {
  toolGovernance: ToolGovernance;
  contentSafety: ContentSafety;
  dataClassification: DataClassification;
}

const KNOWN_POLICY_FILES = new Set([
  'tool-governance.json',
  'content-safety.json',
  'data-classification.json',
]);

export async function loadPolicies(dir: string): Promise<LoadedPolicies> {
  const files = await readdir(dir);
  const out: Partial<LoadedPolicies> = {};
  for (const file of files) {
    if (!KNOWN_POLICY_FILES.has(file)) continue;
    const raw: unknown = JSON.parse(await readFile(join(dir, file), 'utf8'));
    if (file === 'tool-governance.json') out.toolGovernance = ToolGovernanceSchema.parse(raw);
    else if (file === 'content-safety.json') out.contentSafety = ContentSafetySchema.parse(raw);
    else if (file === 'data-classification.json')
      out.dataClassification = DataClassificationSchema.parse(raw);
  }
  if (!out.toolGovernance || !out.contentSafety || !out.dataClassification) {
    throw new Error(`policy directory ${dir} missing required policy files`);
  }
  return out as LoadedPolicies;
}

/** Fail-closed dispatch check (§6.3, §4.2). */
export function isToolAllowed(
  policy: ToolGovernance,
  tool: string
): { allowed: boolean; reason?: string } {
  if (policy.denyList.includes(tool)) return { allowed: false, reason: 'deny-list' };
  if (!policy.allowList.includes(tool)) return { allowed: false, reason: 'not-in-allow-list' };
  return { allowed: true };
}

export function requiresApproval(policy: ToolGovernance, tool: string): boolean {
  return policy.requireApproval.includes(tool);
}
