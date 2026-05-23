/**
 * Test Fixtures - Mock Factories
 */

import { BigQuery } from '@google-cloud/bigquery';

/**
 * Create mock BigQuery client
 */
export function createMockBigQueryClient() {
  const mockJob = {
    id: 'test-job-123',
    metadata: {
      statistics: {
        query: {
          totalBytesProcessed: '1048576',
        },
      },
    },
    getQueryResults: jest.fn().mockResolvedValue([[]]),
  };

  const mockTable = {
    id: 'test-table',
    getMetadata: jest.fn().mockResolvedValue([
      {
        schema: {
          fields: [
            { name: 'id', type: 'STRING' },
            { name: 'name', type: 'STRING' },
          ],
        },
      },
    ]),
  };

  const mockDataset = {
    id: 'test-dataset',
    getTables: jest.fn().mockResolvedValue([[mockTable]]),
    table: jest.fn().mockReturnValue(mockTable),
    getMetadata: jest.fn().mockResolvedValue([{ id: 'test-dataset' }]),
  };

  return {
    createQueryJob: jest.fn().mockResolvedValue([mockJob]),
    getDatasets: jest.fn().mockResolvedValue([[mockDataset]]),
    dataset: jest.fn().mockReturnValue(mockDataset),
    projectId: 'test-project',
  } as unknown as jest.Mocked<BigQuery>;
}

/**
 * Create mock security validation result
 */
export function createMockValidationResult(allowed = true, error?: string) {
  return {
    allowed,
    error,
    warnings: [],
  };
}

/**
 * Create mock MCP request
 */
export function createMockMCPRequest(toolName: string, args: any = {}) {
  return {
    params: {
      name: toolName,
      arguments: args,
    },
    userId: 'test-user-123',
  };
}

/**
 * Create mock logger
 */
export function createMockLogger() {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
}
