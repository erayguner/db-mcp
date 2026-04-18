import { z } from 'zod';

/**
 * Boundary contract schema (§3.2).
 *
 * Every governed tool or agent ships with a boundary contract co-located with
 * its definition and validated in CI (see scripts/governance/validate-boundary-contracts.ts).
 */

export const AgentRoleSchema = z.enum(['observer', 'advisor', 'operator', 'autonomous-operator']);
export const DataClassSchema = z.enum(['public', 'internal', 'confidential', 'regulated']);
export const ApprovalClassSchema = z.enum(['none', 'per-call', 'batch']);

export const BoundaryContractSchema = z.object({
  name: z.string().min(1),
  version: z.string().regex(/^\d+\.\d+\.\d+$/, 'semver'),
  purpose: z.string().min(10).max(500),
  role: AgentRoleSchema,

  inScopeTools: z.array(z.string()).min(1),
  outOfScopeSystems: z.array(z.string()),
  delegatableAgents: z.array(z.string()).default([]),
  dataClasses: z.array(DataClassSchema).min(1),
  approvalClass: ApprovalClassSchema,

  owner: z.object({
    team: z.string(),
    contact: z.string().email().or(z.string().url()),
  }),
  onCallRotation: z.string(),

  foundationModel: z.object({
    cardUrl: z.string().url().optional(),
    id: z.string().optional(),
    adapterVersion: z.string().optional(),
  }).optional(),

  allocative: z.object({
    isAllocative: z.boolean(),
    protectedAttributes: z.array(z.string()).default([]),
  }).default({ isAllocative: false, protectedAttributes: [] }),

  compensatingRisks: z.array(z.string()).default([]),
  reviewedAt: z.string().datetime(),
});

export type BoundaryContract = z.infer<typeof BoundaryContractSchema>;

export function validateContract(raw: unknown): BoundaryContract {
  return BoundaryContractSchema.parse(raw);
}
