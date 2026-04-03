import { z } from 'zod';
import { parse as parseYaml } from 'yaml';
import { logger } from '../utils/logger.js';

export enum WriteMode {
  BLOCKED = 'blocked',
  PROTECTED = 'protected',
  ALLOWED = 'allowed',
}

export const TenantConfigSchema = z
  .object({
    id: z
      .string()
      .min(1)
      .regex(/^[a-z0-9-]+$/, 'Tenant ID must be lowercase alphanumeric with hyphens'),
    name: z.string().min(1),
    projectId: z.string().min(1),
    allowedDatasets: z
      .array(z.string())
      .min(1, 'At least one dataset must be allowed (use "*" for all)'),
    deniedDatasets: z.array(z.string()).default([]),
    writeMode: z.nativeEnum(WriteMode).default(WriteMode.BLOCKED),
    maxBytesPerQuery: z.string().regex(/^\d+$/, 'maxBytesPerQuery must be a numeric string').optional(),
    rateLimits: z
      .object({
        requestsPerMinute: z.number().min(1).default(100),
        queriesPerHour: z.number().min(1).default(1000),
      })
      .default({}),
    oidcSubjectPattern: z
      .string()
      .refine(
        (s) => { try { new RegExp(s); return true; } catch { return false; } },
        { message: 'oidcSubjectPattern must be a valid regular expression' }
      )
      .optional(),
    allowedTools: z.array(z.string()).optional(),
  });

export type TenantConfig = z.infer<typeof TenantConfigSchema>;

export const TenantsFileSchema = z.object({
  tenants: z.array(TenantConfigSchema).min(1),
});

export type TenantsFile = z.infer<typeof TenantsFileSchema>;

export function parseTenantConfig(yamlContent: string): TenantsFile {
  const raw = parseYaml(yamlContent) as unknown;
  const result = TenantsFileSchema.parse(raw);

  const ids = result.tenants.map((t) => t.id);
  const duplicates = ids.filter((id, i) => ids.indexOf(id) !== i);
  if (duplicates.length > 0) {
    throw new Error(`Duplicate tenant IDs: ${duplicates.join(', ')}`);
  }

  logger.info('Parsed tenant config', { tenantCount: result.tenants.length });
  return result;
}
