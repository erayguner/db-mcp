import { jest, beforeEach, afterEach } from '@jest/globals';
import { loadFeature, defineFeature } from 'jest-cucumber';
import {
  QueryBigQueryHandler,
  type ToolHandlerContext,
} from '../../src/mcp/handlers/tool-handlers.js';

const feature = loadFeature('./query-cost-guard.feature', { loadRelativePath: true });

type CallToolResult = {
  isError?: boolean;
  content: Array<{ type: string; text: string }>;
  _meta?: Record<string, unknown>;
};

defineFeature(feature, (test) => {
  const originalEnv = { ...process.env };
  let mockClient: {
    query: jest.Mock;
    dryRun: jest.Mock;
    listDatasets: jest.Mock;
    listTables: jest.Mock;
    getTable: jest.Mock;
    getProjectId: jest.Mock;
    isHealthy: jest.Mock;
  };
  let context: ToolHandlerContext;
  let response: CallToolResult;

  beforeEach(() => {
    mockClient = {
      query: jest.fn(),
      dryRun: jest.fn(),
      listDatasets: jest.fn(),
      listTables: jest.fn(),
      getTable: jest.fn(),
      getProjectId: jest.fn(() => 'test-project'),
      isHealthy: jest.fn(() => true),
    };
    mockClient.query.mockResolvedValue({
      rows: [{ x: 1 }],
      schema: [{ name: 'x', type: 'INTEGER' }],
      jobId: 'job-ok',
      totalRows: 1,
      cacheHit: false,
      executionTimeMs: 1,
      totalBytesProcessed: '500',
    } as never);
    context = {
      bigQueryClient: mockClient,
      userId: 'test-user',
      requestId: 'req-cost',
    } as unknown as ToolHandlerContext;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  const enableGate = (given: (s: RegExp, fn: (...a: string[]) => void) => void) =>
    given(
      /^the cost elicitation gate is enabled with a threshold of (\d+) bytes$/,
      (bytes: string) => {
        process.env.MCP_COST_ELICITATION_ENABLED = 'true';
        process.env.MCP_COST_ELICITATION_BYTES = bytes;
      }
    );

  const dryRunReports = (and: (s: RegExp, fn: (...a: string[]) => void) => void) =>
    and(/^a dry run that reports (\d+) bytes$/, (bytes: string) => {
      mockClient.dryRun.mockResolvedValue({
        totalBytesProcessed: bytes,
        estimatedCostUSD: 1,
      } as never);
    });

  const executeWithout = (when: (s: RegExp, fn: (...a: string[]) => Promise<void>) => void) =>
    when(/^the query "(.*)" is executed without cost confirmation$/, async (query: string) => {
      const handler = new QueryBigQueryHandler(context);
      response = (await handler.execute({ query })) as unknown as CallToolResult;
    });

  test('A query under the cost threshold runs without confirmation', ({
    given,
    and,
    when,
    then,
  }) => {
    enableGate(given);
    dryRunReports(and);
    executeWithout(when);
    then('the query is executed', () => {
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });
    and('no confirmation is required', () => {
      expect(response._meta?.requiresConfirmation).toBeUndefined();
    });
  });

  test('A query over the cost threshold requires confirmation', ({ given, and, when, then }) => {
    enableGate(given);
    dryRunReports(and);
    executeWithout(when);
    then('the query is not executed', () => {
      expect(mockClient.query).not.toHaveBeenCalled();
    });
    and('a cost confirmation is required', () => {
      expect(response._meta?.requiresConfirmation).toBe(true);
      const body = JSON.parse(response.content[0].text);
      expect(body.status).toBe('requires_confirmation');
    });
    and(/^the confirmation reports (\d+) estimated bytes$/, (bytes) => {
      const body = JSON.parse(response.content[0].text);
      expect(body.estimate.totalBytesProcessed).toBe(Number(bytes));
    });
  });

  test('A confirmed query runs even above the threshold', ({ given, and, when, then }) => {
    enableGate(given);
    dryRunReports(and);
    when(/^the query "(.*)" is executed with cost confirmation$/, async (query) => {
      const handler = new QueryBigQueryHandler(context);
      response = (await handler.execute({
        query,
        confirmCost: true,
      })) as unknown as CallToolResult;
    });
    then('the query is executed', () => {
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });
  });

  test('The cost gate can be disabled', ({ given, when, then, and }) => {
    given('the cost elicitation gate is disabled', () => {
      process.env.MCP_COST_ELICITATION_ENABLED = 'false';
      process.env.MCP_COST_ELICITATION_BYTES = '1';
    });
    executeWithout(when);
    then('the query is executed', () => {
      expect(mockClient.query).toHaveBeenCalledTimes(1);
    });
    and('no dry run is performed', () => {
      expect(mockClient.dryRun).not.toHaveBeenCalled();
    });
  });
});
