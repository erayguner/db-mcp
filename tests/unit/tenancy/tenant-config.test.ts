import { describe, it, expect } from '@jest/globals';
import {
  TenantConfigSchema,
  TenantsFileSchema,
  WriteMode,
  parseTenantConfig,
} from '../../../src/tenancy/tenant-config.js';

describe('TenantConfig', () => {
  describe('TenantConfigSchema', () => {
    it('validates a complete tenant config', () => {
      const config = {
        id: 'acme-corp',
        name: 'Acme Corporation',
        projectId: 'acme-bq-prod',
        allowedDatasets: ['analytics', 'reporting'],
        deniedDatasets: [],
        writeMode: 'blocked' as const,
        maxBytesPerQuery: '10737418240',
        rateLimits: {
          requestsPerMinute: 60,
          queriesPerHour: 500,
        },
        oidcSubjectPattern: '.*@acme\\.com$',
      };
      const result = TenantConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });

    it('defaults writeMode to blocked', () => {
      const config = {
        id: 'test-tenant',
        name: 'Test',
        projectId: 'test-project',
        allowedDatasets: ['public'],
      };
      const result = TenantConfigSchema.parse(config);
      expect(result.writeMode).toBe('blocked');
    });

    it('rejects empty allowedDatasets when no deniedDatasets set', () => {
      const config = {
        id: 'test',
        name: 'Test',
        projectId: 'proj',
        allowedDatasets: [],
        deniedDatasets: [],
      };
      const result = TenantConfigSchema.safeParse(config);
      expect(result.success).toBe(false);
    });

    it('accepts wildcard dataset access', () => {
      const config = {
        id: 'admin-tenant',
        name: 'Admin',
        projectId: 'proj',
        allowedDatasets: ['*'],
      };
      const result = TenantConfigSchema.safeParse(config);
      expect(result.success).toBe(true);
    });
  });

  describe('parseTenantConfig', () => {
    it('parses a YAML config string', () => {
      const yaml = `
tenants:
  - id: acme
    name: Acme Corp
    projectId: acme-prod
    allowedDatasets:
      - analytics
    writeMode: blocked
    rateLimits:
      requestsPerMinute: 100
      queriesPerHour: 1000
    oidcSubjectPattern: ".*@acme\\\\.com$"
`;
      const result = parseTenantConfig(yaml);
      expect(result.tenants).toHaveLength(1);
      expect(result.tenants[0].id).toBe('acme');
      expect(result.tenants[0].writeMode).toBe('blocked');
    });
  });
});
