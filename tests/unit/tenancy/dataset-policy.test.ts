import { describe, it, expect } from '@jest/globals';
import { DatasetPolicy } from '../../../src/tenancy/dataset-policy.js';
import { TenantConfig, WriteMode } from '../../../src/tenancy/tenant-config.js';

const makeTenant = (overrides: Partial<TenantConfig> = {}): TenantConfig => ({
  id: 'test',
  name: 'Test',
  projectId: 'proj',
  allowedDatasets: ['analytics', 'reporting'],
  deniedDatasets: [],
  writeMode: WriteMode.BLOCKED,
  rateLimits: { requestsPerMinute: 100, queriesPerHour: 1000 },
  ...overrides,
});

describe('DatasetPolicy', () => {
  it('allows access to an allowed dataset', () => {
    const policy = new DatasetPolicy(makeTenant());
    expect(policy.canAccessDataset('analytics')).toBe(true);
  });

  it('denies access to a non-allowed dataset', () => {
    const policy = new DatasetPolicy(makeTenant());
    expect(policy.canAccessDataset('secrets')).toBe(false);
  });

  it('allows all datasets with wildcard', () => {
    const policy = new DatasetPolicy(makeTenant({ allowedDatasets: ['*'] }));
    expect(policy.canAccessDataset('anything')).toBe(true);
  });

  it('denies explicitly denied datasets even with wildcard', () => {
    const policy = new DatasetPolicy(makeTenant({
      allowedDatasets: ['*'],
      deniedDatasets: ['pii_data'],
    }));
    expect(policy.canAccessDataset('pii_data')).toBe(false);
    expect(policy.canAccessDataset('analytics')).toBe(true);
  });

  it('blocks write queries when writeMode is blocked', () => {
    const policy = new DatasetPolicy(makeTenant({ writeMode: WriteMode.BLOCKED }));
    expect(policy.canWrite()).toBe(false);
  });

  it('allows write queries when writeMode is allowed', () => {
    const policy = new DatasetPolicy(makeTenant({ writeMode: WriteMode.ALLOWED }));
    expect(policy.canWrite()).toBe(true);
  });

  it('detects DML statements', () => {
    const policy = new DatasetPolicy(makeTenant());
    expect(policy.isDMLQuery('INSERT INTO t VALUES (1)')).toBe(true);
    expect(policy.isDMLQuery('UPDATE t SET x = 1')).toBe(true);
    expect(policy.isDMLQuery('DELETE FROM t WHERE id = 1')).toBe(true);
    expect(policy.isDMLQuery('MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET x = 1')).toBe(true);
    expect(policy.isDMLQuery('SELECT * FROM t')).toBe(false);
  });

  it('detects DDL statements', () => {
    const policy = new DatasetPolicy(makeTenant());
    expect(policy.isDDLQuery('CREATE TABLE t (id INT64)')).toBe(true);
    expect(policy.isDDLQuery('DROP TABLE t')).toBe(true);
    expect(policy.isDDLQuery('ALTER TABLE t ADD COLUMN x STRING')).toBe(true);
    expect(policy.isDDLQuery('SELECT 1')).toBe(false);
  });

  it('validates query against tenant policy (read allowed)', () => {
    const policy = new DatasetPolicy(makeTenant());
    const result = policy.validateQuery('SELECT * FROM `proj.analytics.events`');
    expect(result.allowed).toBe(true);
  });

  it('blocks write query when writeMode is blocked', () => {
    const policy = new DatasetPolicy(makeTenant());
    const result = policy.validateQuery('INSERT INTO `proj.analytics.events` VALUES (1)');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('write');
  });

  it('extracts dataset references from query', () => {
    const policy = new DatasetPolicy(makeTenant());
    const datasets = policy.extractDatasetReferences(
      'SELECT a.*, b.* FROM `proj.analytics.events` a JOIN `proj.reporting.summary` b ON a.id = b.id'
    );
    expect(datasets).toContain('analytics');
    expect(datasets).toContain('reporting');
  });

  it('rejects query referencing unauthorized dataset', () => {
    const policy = new DatasetPolicy(makeTenant({ allowedDatasets: ['analytics'] }));
    const result = policy.validateQuery('SELECT * FROM `proj.secrets.passwords`');
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('secrets');
  });

  it('enforces maxBytesPerQuery', () => {
    const policy = new DatasetPolicy(makeTenant({ maxBytesPerQuery: '1073741824' }));
    expect(policy.getMaxBytesBilled()).toBe('1073741824');
  });
});
