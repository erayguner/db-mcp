import { ColumnMaskingEngine, MaskingConfig } from '../../src/security/column-masking';
import { DatasetPolicy } from '../../src/tenancy/dataset-policy';
import { TenantConfigSchema } from '../../src/tenancy/tenant-config';

const buildEngine = (rules: MaskingConfig['rules'], enabled = true): ColumnMaskingEngine =>
  new ColumnMaskingEngine({ enabled, rules, defaultMaskType: 'redact' });

const PII_RULE = {
  datasetPattern: 'analytics',
  tablePattern: 'users',
  columnPattern: 'email',
  maskType: 'redact' as const,
};

describe('ColumnMaskingEngine', () => {
  describe('mask types', () => {
    const row = { email: 'jane@example.com', card: '4111 1111 1111 1234', name: 'Jane' };

    it('redacts', () => {
      const out = buildEngine([{ ...PII_RULE, maskType: 'redact' }]).maskRow(
        row,
        'analytics',
        'users'
      );
      expect(out.email).toBe('[REDACTED]');
      expect(out.name).toBe('Jane');
    });

    it('hashes deterministically, preserving referential integrity', () => {
      const engine = buildEngine([{ ...PII_RULE, maskType: 'hash' }]);
      const a = engine.maskRow(row, 'analytics', 'users');
      const b = engine.maskRow({ ...row }, 'analytics', 'users');
      expect(a.email).toBe(b.email);
      expect(a.email).toMatch(/^[a-f0-9]{64}$/);
      expect(a.email).not.toContain('jane');
    });

    it('partially masks an email', () => {
      const out = buildEngine([{ ...PII_RULE, maskType: 'partial' }]).maskRow(
        row,
        'analytics',
        'users'
      );
      expect(out.email).toBe('j***@example.com');
    });

    it('nullifies', () => {
      const out = buildEngine([{ ...PII_RULE, maskType: 'nullify' }]).maskRow(
        row,
        'analytics',
        'users'
      );
      expect(out.email).toBeNull();
    });

    it('leaves null/undefined values untouched', () => {
      const out = buildEngine([PII_RULE]).maskRow(
        { email: null, other: undefined },
        'analytics',
        'users'
      );
      expect(out.email).toBeNull();
      expect(out.other).toBeUndefined();
    });
  });

  describe('rule scoping', () => {
    it('does not mask a table the rule does not cover', () => {
      const out = buildEngine([PII_RULE]).maskRow(
        { email: 'jane@example.com' },
        'analytics',
        'orders'
      );
      expect(out.email).toBe('jane@example.com');
    });

    it('supports glob patterns across datasets and columns', () => {
      const out = buildEngine([
        { datasetPattern: '*', tablePattern: '*', columnPattern: '*_pii', maskType: 'redact' },
      ]).maskRow({ ssn_pii: '123-45-6789', label: 'ok' }, 'anything', 'whatever');
      expect(out.ssn_pii).toBe('[REDACTED]');
      expect(out.label).toBe('ok');
    });

    it('is a passthrough when disabled', () => {
      const out = buildEngine([PII_RULE], false).maskRow(
        { email: 'jane@example.com' },
        'analytics',
        'users'
      );
      expect(out.email).toBe('jane@example.com');
    });
  });

  describe('maskQueryRows — arbitrary SQL result sets', () => {
    const rows = [
      { email: 'a@x.com', amount: 10 },
      { email: 'b@x.com', amount: 20 },
    ];

    it('masks rows for a matching table reference and reports the columns', () => {
      const result = buildEngine([PII_RULE]).maskQueryRows(rows, [
        { datasetId: 'analytics', tableId: 'users' },
      ]);
      expect(result.rows.map((r) => r.email)).toEqual(['[REDACTED]', '[REDACTED]']);
      expect(result.rows.map((r) => r.amount)).toEqual([10, 20]);
      expect(result.maskedColumns).toEqual(['email']);
    });

    it('reports no masked columns when no rule matches', () => {
      const result = buildEngine([PII_RULE]).maskQueryRows(rows, [
        { datasetId: 'analytics', tableId: 'orders' },
      ]);
      expect(result.maskedColumns).toEqual([]);
      expect(result.rows[0].email).toBe('a@x.com');
    });

    it('over-masks across a join rather than leaking the protected column', () => {
      // `users.email` is protected; `orders` is not. A join returns both, and we
      // cannot attribute an output column to a source table without a SQL parser,
      // so the safe direction is to mask.
      const result = buildEngine([PII_RULE]).maskQueryRows(rows, [
        { datasetId: 'analytics', tableId: 'orders' },
        { datasetId: 'analytics', tableId: 'users' },
      ]);
      expect(result.rows.map((r) => r.email)).toEqual(['[REDACTED]', '[REDACTED]']);
    });

    it('fails safe when no table reference could be extracted', () => {
      const result = buildEngine([PII_RULE]).maskQueryRows(rows, []);
      expect(result.rows.map((r) => r.email)).toEqual(['[REDACTED]', '[REDACTED]']);
    });

    it('does not mutate the caller’s rows', () => {
      const original = [{ email: 'a@x.com' }];
      buildEngine([PII_RULE]).maskQueryRows(original, [
        { datasetId: 'analytics', tableId: 'users' },
      ]);
      expect(original[0].email).toBe('a@x.com');
    });

    it('is a passthrough when disabled or ruleless', () => {
      expect(
        buildEngine([PII_RULE], false).maskQueryRows(rows, [
          { datasetId: 'analytics', tableId: 'users' },
        ]).maskedColumns
      ).toEqual([]);
      expect(
        buildEngine([]).maskQueryRows(rows, [{ datasetId: 'analytics', tableId: 'users' }])
          .maskedColumns
      ).toEqual([]);
    });
  });
});

describe('DatasetPolicy.extractTableReferences', () => {
  const policy = new DatasetPolicy(
    TenantConfigSchema.parse({
      id: 't1',
      name: 'T1',
      projectId: 'p1',
      allowedDatasets: ['*'],
    })
  );

  it('extracts backtick-qualified references', () => {
    expect(policy.extractTableReferences('SELECT * FROM `proj.analytics.users`')).toEqual([
      { datasetId: 'analytics', tableId: 'users' },
    ]);
  });

  it('extracts unquoted references', () => {
    expect(policy.extractTableReferences('SELECT * FROM analytics.users')).toEqual([
      { datasetId: 'analytics', tableId: 'users' },
    ]);
  });

  it('extracts every table in a join and de-duplicates', () => {
    const refs = policy.extractTableReferences(
      'SELECT * FROM `p.analytics.users` u JOIN `p.analytics.orders` o ON u.id = o.uid JOIN analytics.users x ON x.id = u.id'
    );
    expect(refs).toHaveLength(2);
    expect(refs).toContainEqual({ datasetId: 'analytics', tableId: 'users' });
    expect(refs).toContainEqual({ datasetId: 'analytics', tableId: 'orders' });
  });

  it('returns an empty list when nothing is parseable', () => {
    expect(policy.extractTableReferences('SELECT 1')).toEqual([]);
  });

  it('still reports datasets for authorization', () => {
    expect(policy.extractDatasetReferences('SELECT * FROM `p.a.t1` JOIN `p.b.t2` ON 1=1')).toEqual([
      'a',
      'b',
    ]);
  });
});
