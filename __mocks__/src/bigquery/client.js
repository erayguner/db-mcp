export const BigQueryClient = jest.fn().mockImplementation(() => ({
  query: jest.fn().mockResolvedValue({ rows: [], schema: [], totalRows: 0, jobId: 'mock-job', cacheHit: false, executionTimeMs: 0 }),
  dryRun: jest.fn().mockResolvedValue({ totalBytesProcessed: '0', estimatedCostUSD: 0 }),
  listDatasets: jest.fn().mockResolvedValue([]),
  listTables: jest.fn().mockResolvedValue([]),
  getTable: jest.fn().mockResolvedValue({ id: 'mock', schema: [], type: 'TABLE', createdAt: new Date(), modifiedAt: new Date() }),
  getProjectId: jest.fn().mockReturnValue('mock-project'),
  testConnection: jest.fn().mockResolvedValue(true),
  isHealthy: jest.fn().mockReturnValue(true),
}));
export default { BigQueryClient };
