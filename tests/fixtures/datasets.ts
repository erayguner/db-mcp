/**
 * Test Fixtures - Dataset Data
 */

export const mockDatasets = [
  { id: 'dataset1', location: 'US' },
  { id: 'dataset2', location: 'US' },
  { id: 'analytics', location: 'EU' },
];

export const mockTables = {
  dataset1: ['users', 'orders', 'products'],
  dataset2: ['transactions', 'customers'],
  analytics: ['events', 'sessions'],
};

export const mockTableSchema = {
  fields: [
    { name: 'id', type: 'STRING', mode: 'REQUIRED' },
    { name: 'email', type: 'STRING', mode: 'NULLABLE' },
    { name: 'created_at', type: 'TIMESTAMP', mode: 'REQUIRED' },
    { name: 'updated_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
  ],
};

export const mockQueryResults = [
  { id: '1', email: 'user1@example.com', created_at: '2024-01-01T00:00:00Z' },
  { id: '2', email: 'user2@example.com', created_at: '2024-01-02T00:00:00Z' },
  { id: '3', email: 'user3@example.com', created_at: '2024-01-03T00:00:00Z' },
];

export const mockJobMetadata = {
  statistics: {
    query: {
      totalBytesProcessed: '1048576', // 1MB
      totalBytesBilled: '10485760', // 10MB
      cacheHit: false,
    },
  },
  status: {
    state: 'DONE',
  },
};
