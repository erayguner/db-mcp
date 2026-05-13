import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import {
  loadCostElicitationConfig,
  estimateQueryCostUsd,
} from '../../../src/mcp/tools/annotations.js';
import {
  QueryBigQueryHandler,
  ToolHandlerContext,
} from '../../../src/mcp/handlers/tool-handlers.js';
import { BigQueryClient } from '../../../src/bigquery/client.js';

jest.mock('../../../src/bigquery/client');
jest.mock('../../../src/utils/logger', () => ({
  logger: { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() },
}));

describe('Cost elicitation helpers', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe('loadCostElicitationConfig', () => {
    it('defaults to enabled with a 10 GiB threshold and $6.25/TiB', () => {
      delete process.env.MCP_COST_ELICITATION_ENABLED;
      delete process.env.MCP_COST_ELICITATION_BYTES;
      delete process.env.MCP_BQ_USD_PER_TIB;
      const cfg = loadCostElicitationConfig();
      expect(cfg.enabled).toBe(true);
      expect(cfg.thresholdBytes).toBe(10 * 1024 ** 3);
      expect(cfg.usdPerTiB).toBe(6.25);
    });

    it('honours env overrides', () => {
      process.env.MCP_COST_ELICITATION_ENABLED = 'false';
      process.env.MCP_COST_ELICITATION_BYTES = '1024';
      process.env.MCP_BQ_USD_PER_TIB = '10';
      const cfg = loadCostElicitationConfig();
      expect(cfg.enabled).toBe(false);
      expect(cfg.thresholdBytes).toBe(1024);
      expect(cfg.usdPerTiB).toBe(10);
    });
  });

  describe('estimateQueryCostUsd', () => {
    it('computes $6.25 for exactly 1 TiB at the default rate', () => {
      expect(estimateQueryCostUsd(1024 ** 4, 6.25)).toBeCloseTo(6.25, 4);
    });

    it('returns approximately 0 for sub-MB scans', () => {
      const cost = estimateQueryCostUsd(1024, 6.25);
      expect(cost).toBeGreaterThanOrEqual(0);
      expect(cost).toBeLessThan(0.0001);
    });
  });
});

describe('QueryBigQueryHandler — cost elicitation gate', () => {
  let mockBigQueryClient: jest.Mocked<BigQueryClient>;
  let context: ToolHandlerContext;
  const originalEnv = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    mockBigQueryClient = {
      query: jest.fn(),
      dryRun: jest.fn(),
      listDatasets: jest.fn(),
      listTables: jest.fn(),
      getTable: jest.fn(),
      getProjectId: jest.fn().mockReturnValue('test-project'),
      isHealthy: jest.fn().mockReturnValue(true),
    } as unknown as jest.Mocked<BigQueryClient>;

    context = {
      bigQueryClient: mockBigQueryClient,
      userId: 'test-user',
      requestId: 'req-cost-1',
    };
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it('returns requires_confirmation when estimated bytes exceed threshold', async () => {
    process.env.MCP_COST_ELICITATION_ENABLED = 'true';
    process.env.MCP_COST_ELICITATION_BYTES = '1000';

    mockBigQueryClient.dryRun.mockResolvedValue({
      totalBytesProcessed: '50000', // 50× the 1000-byte threshold
      estimatedCostUSD: 12.34,
    } as unknown as never);

    const handler = new QueryBigQueryHandler(context);
    const response = await handler.execute({ query: 'SELECT * FROM big_table' });

    expect(mockBigQueryClient.query).not.toHaveBeenCalled();
    expect(response.isError).toBeFalsy();
    const meta = response._meta as Record<string, unknown> | undefined;
    expect(meta?.requiresConfirmation).toBe(true);
    expect((meta?.elicitation as Record<string, unknown>).kind).toBe('cost_acknowledgement');
    const body = JSON.parse(response.content[0].text as string);
    expect(body.status).toBe('requires_confirmation');
    expect(body.reason).toBe('cost_threshold_exceeded');
    expect(body.estimate.totalBytesProcessed).toBe(50000);
  });

  it('proceeds with execution when confirmCost is true even above threshold', async () => {
    process.env.MCP_COST_ELICITATION_ENABLED = 'true';
    process.env.MCP_COST_ELICITATION_BYTES = '1000';

    mockBigQueryClient.dryRun.mockResolvedValue({
      totalBytesProcessed: '50000',
      estimatedCostUSD: 1,
    } as unknown as never);
    mockBigQueryClient.query.mockResolvedValue({
      rows: [{ x: 1 }],
      schema: [{ name: 'x', type: 'INTEGER' }],
      jobId: 'job-confirmed',
      totalRows: 1,
      cacheHit: false,
      executionTimeMs: 10,
      totalBytesProcessed: '50000',
    } as unknown as never);

    const handler = new QueryBigQueryHandler(context);
    const response = await handler.execute({ query: 'SELECT 1', confirmCost: true });

    expect(mockBigQueryClient.query).toHaveBeenCalledTimes(1);
    const meta = response._meta as Record<string, unknown> | undefined;
    expect(meta?.requiresConfirmation).toBeUndefined();
    expect(response.content[0].text).toContain('job-confirmed');
  });

  it('proceeds without confirmation when estimated bytes are below threshold', async () => {
    process.env.MCP_COST_ELICITATION_ENABLED = 'true';
    process.env.MCP_COST_ELICITATION_BYTES = String(10 * 1024 ** 3);

    mockBigQueryClient.dryRun.mockResolvedValue({
      totalBytesProcessed: '1024',
      estimatedCostUSD: 0,
    } as unknown as never);
    mockBigQueryClient.query.mockResolvedValue({
      rows: [],
      schema: [],
      jobId: 'job-small',
      totalRows: 0,
      cacheHit: false,
      executionTimeMs: 5,
      totalBytesProcessed: '1024',
    } as unknown as never);

    const handler = new QueryBigQueryHandler(context);
    const response = await handler.execute({ query: 'SELECT 1' });

    expect(mockBigQueryClient.query).toHaveBeenCalledTimes(1);
    expect((response._meta as Record<string, unknown>)?.requiresConfirmation).toBeUndefined();
  });

  it('skips the gate entirely when MCP_COST_ELICITATION_ENABLED=false', async () => {
    process.env.MCP_COST_ELICITATION_ENABLED = 'false';
    process.env.MCP_COST_ELICITATION_BYTES = '1';

    mockBigQueryClient.query.mockResolvedValue({
      rows: [],
      schema: [],
      jobId: 'job-no-gate',
      totalRows: 0,
      cacheHit: false,
      executionTimeMs: 1,
      totalBytesProcessed: '999999',
    } as unknown as never);

    const handler = new QueryBigQueryHandler(context);
    const response = await handler.execute({ query: 'SELECT 1' });

    expect(mockBigQueryClient.dryRun).not.toHaveBeenCalled();
    expect(mockBigQueryClient.query).toHaveBeenCalledTimes(1);
    expect(response.content[0].text).toContain('job-no-gate');
  });
});
