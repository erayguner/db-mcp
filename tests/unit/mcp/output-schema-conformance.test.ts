import {
  QueryBigQueryHandler,
  ToolHandlerContext,
  ToolResponse,
} from '../../../src/mcp/handlers/tool-handlers.js';
import { BigQueryClient } from '../../../src/bigquery/client.js';
import { OUTPUT_SCHEMAS } from '../../../src/mcp/schemas/output-schemas.js';

jest.mock('../../../src/bigquery/client');
jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

/**
 * Every tool advertises an `outputSchema`. The MCP spec requires that any
 * `structuredContent` a tool returns conforms to it — but nothing in this
 * codebase validated that, so three paths (errors, the >1000-row chunked path,
 * and dry-run) silently emitted payloads matching no declared schema.
 *
 * These tests validate real handler output against the advertised schema.
 */
describe('structuredContent conforms to the advertised outputSchema', () => {
  const schema = OUTPUT_SCHEMAS.query_bigquery;

  const makeContext = (
    queryImpl: () => Promise<unknown>,
    dryRunImpl?: () => Promise<unknown>
  ): ToolHandlerContext => ({
    bigQueryClient: {
      query: jest.fn().mockImplementation(queryImpl),
      dryRun: jest.fn().mockImplementation(dryRunImpl ?? (() => Promise.resolve({}))),
      getProjectId: jest.fn().mockReturnValue('p1'),
      isHealthy: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<BigQueryClient>,
    userId: 'u1',
    requestId: 'r1',
  });

  const okResult = (rowCount: number) => ({
    rows: Array.from({ length: rowCount }, (_, i) => ({ id: i })),
    schema: [{ name: 'id', type: 'INTEGER' }],
    jobId: 'job-1',
    cacheHit: false,
    executionTimeMs: 12,
    totalBytesProcessed: '2048',
    totalRows: rowCount,
  });

  const expectConformant = (response: ToolResponse) => {
    const parsed = schema.safeParse(response.structuredContent);
    if (!parsed.success) {
      throw new Error(
        `structuredContent violates the advertised outputSchema:\n${JSON.stringify(
          parsed.error.issues,
          null,
          2
        )}\npayload: ${JSON.stringify(response.structuredContent, null, 2)}`
      );
    }
    expect(parsed.success).toBe(true);
  };

  it('conforms on the normal executed path', async () => {
    const ctx = makeContext(() => Promise.resolve(okResult(3)));
    const response = await new QueryBigQueryHandler(ctx).execute({ query: 'SELECT 1' });
    expectConformant(response);
  });

  it('conforms on the large-result chunked path', async () => {
    const ctx = makeContext(() => Promise.resolve(okResult(1001)));
    const response = await new QueryBigQueryHandler(ctx).execute({ query: 'SELECT 1' });
    expectConformant(response);
  });

  it('conforms on the dry-run path', async () => {
    const ctx = makeContext(
      () => Promise.reject(new Error('should not execute')),
      () => Promise.resolve({ totalBytesProcessed: '4096', estimatedCostUSD: 0.002 })
    );
    const response = await new QueryBigQueryHandler(ctx).execute({
      query: 'SELECT 1',
      dryRun: true,
    });
    expectConformant(response);
  });

  it('emits no schema-violating structuredContent on the error path', async () => {
    const ctx = makeContext(() => Promise.reject(new Error('boom')));
    const response = await new QueryBigQueryHandler(ctx).execute({ query: 'SELECT 1' });

    expect(response.isError).toBe(true);
    // Either absent, or present and conformant — never present and invalid.
    if (response.structuredContent !== undefined) {
      expectConformant(response);
    }
    // The error detail must still be recoverable by the client.
    expect(response.content[0].text).toContain('boom');
  });
});
