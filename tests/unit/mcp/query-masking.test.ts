import {
  QueryBigQueryHandler,
  ToolHandlerContext,
} from '../../../src/mcp/handlers/tool-handlers.js';
import { BigQueryClient } from '../../../src/bigquery/client.js';
import { TenantContextFactory } from '../../../src/tenancy/tenant-context.js';
import { TenantRegistry } from '../../../src/tenancy/tenant-registry.js';
import { TenantConfigSchema } from '../../../src/tenancy/tenant-config.js';
import type { AuthenticatedPrincipal } from '../../../src/auth/oidc-authenticator.js';

jest.mock('../../../src/bigquery/client');
jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/**
 * End-to-end guard for tenant column masking.
 *
 * The ColumnMaskingEngine was previously complete and correct but wired to
 * nothing, so masked columns reached the model in full while provenance claimed
 * masking was honoured. These tests assert the wiring, not the engine.
 */
describe('query_bigquery — tenant column masking', () => {
  const PRINCIPAL = {
    email: 'analyst@acme.com',
    subject: 'analyst@acme.com',
  } as AuthenticatedPrincipal;

  const ROWS = [
    { id: 1, email: 'jane@acme.com', amount: 100 },
    { id: 2, email: 'bob@acme.com', amount: 200 },
  ];

  const buildContext = (
    columnMasking: unknown,
    rows: Record<string, unknown>[] = ROWS
  ): ToolHandlerContext => {
    const tenant = TenantConfigSchema.parse({
      id: 'acme',
      name: 'Acme',
      projectId: 'acme-proj',
      allowedDatasets: ['*'],
      ...(columnMasking ? { columnMasking } : {}),
    });

    const registry = {
      resolveBySubject: () => tenant,
      get: () => tenant,
    } as unknown as TenantRegistry;
    const tenantContext = new TenantContextFactory(registry, 'acme').createContext(PRINCIPAL);

    const client = {
      query: jest.fn().mockResolvedValue({
        rows,
        schema: [
          { name: 'id', type: 'INTEGER' },
          { name: 'email', type: 'STRING' },
          { name: 'amount', type: 'INTEGER' },
        ],
        jobId: 'job-1',
        cacheHit: false,
        executionTimeMs: 5,
        totalBytesProcessed: '1024',
        totalRows: rows.length,
      }),
      dryRun: jest.fn(),
      getProjectId: jest.fn().mockReturnValue('acme-proj'),
      isHealthy: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<BigQueryClient>;

    return { bigQueryClient: client, userId: 'u1', requestId: 'r1', tenantContext };
  };

  const run = async (
    ctx: ToolHandlerContext,
    query = 'SELECT * FROM `acme-proj.analytics.users`'
  ) => {
    const response = await new QueryBigQueryHandler(ctx).execute({ query });
    return response;
  };

  it('masks a configured PII column before it leaves the server', async () => {
    const ctx = buildContext({
      enabled: true,
      rules: [
        {
          datasetPattern: 'analytics',
          tablePattern: 'users',
          columnPattern: 'email',
          maskType: 'redact',
        },
      ],
    });

    const response = await run(ctx);
    const payload = response.structuredContent as { rows: Array<Record<string, unknown>> };

    expect(payload.rows.map((r) => r.email)).toEqual(['[REDACTED]', '[REDACTED]']);
    // Non-matching columns must survive untouched.
    expect(payload.rows.map((r) => r.amount)).toEqual([100, 200]);
    expect(JSON.stringify(response)).not.toContain('jane@acme.com');
  });

  it('reports the masked columns in provenance', async () => {
    const ctx = buildContext({
      enabled: true,
      rules: [
        {
          datasetPattern: '*',
          tablePattern: '*',
          columnPattern: 'email',
          maskType: 'hash',
        },
      ],
    });

    const response = await run(ctx);
    const provenance = (response._meta as { provenance: { maskedColumns?: string[] } }).provenance;
    expect(provenance.maskedColumns).toEqual(['email']);
  });

  it('omits maskedColumns from provenance when nothing was masked', async () => {
    const ctx = buildContext({ enabled: false, rules: [] });

    const response = await run(ctx);
    const provenance = (response._meta as { provenance: { maskedColumns?: string[] } }).provenance;
    expect(provenance.maskedColumns).toBeUndefined();
    const payload = response.structuredContent as { rows: Array<Record<string, unknown>> };
    expect(payload.rows[0].email).toBe('jane@acme.com');
  });

  it('applies masking on the large-result streaming path too', async () => {
    const many = Array.from({ length: 1001 }, (_, i) => ({
      id: i,
      email: `user${i}@acme.com`,
      amount: i,
    }));
    const ctx = buildContext(
      {
        enabled: true,
        rules: [
          {
            datasetPattern: '*',
            tablePattern: '*',
            columnPattern: 'email',
            maskType: 'redact',
          },
        ],
      },
      many
    );

    const response = await run(ctx);
    const payload = response.structuredContent as {
      rows: Array<Record<string, unknown>>;
      rowCount: number;
    };

    expect(payload.rowCount).toBe(1001);
    expect(payload.rows.every((r) => r.email === '[REDACTED]')).toBe(true);
    expect(JSON.stringify(response)).not.toContain('user500@acme.com');
    // Chunking detail moved to _meta so the payload conforms to the declared schema.
    expect((response._meta as { chunks: number }).chunks).toBe(11);
  });

  it('does not mask when the rule targets a different table', async () => {
    const ctx = buildContext({
      enabled: true,
      rules: [
        {
          datasetPattern: 'analytics',
          tablePattern: 'orders',
          columnPattern: 'email',
          maskType: 'redact',
        },
      ],
    });

    const response = await run(ctx, 'SELECT * FROM `acme-proj.analytics.users`');
    const payload = response.structuredContent as { rows: Array<Record<string, unknown>> };
    expect(payload.rows[0].email).toBe('jane@acme.com');
  });
});
