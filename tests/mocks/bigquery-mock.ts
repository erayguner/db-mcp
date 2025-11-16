/**
 * Mock BigQuery Client for Testing
 * Simulates Google Cloud BigQuery API responses
 */

import { BigQuery, Job, Dataset, Table } from '@google-cloud/bigquery';

export class MockBigQueryJob {
  public id: string;
  private metadata: any;
  private queryResults: any[];

  constructor(id: string, results: any[] = [], metadata: any = {}) {
    this.id = id;
    this.queryResults = results;
    this.metadata = {
      statistics: {
        query: {
          totalBytesProcessed: '1024000',
          totalSlotMs: '5000',
          cacheHit: false,
          ...metadata.statistics?.query,
        },
      },
      configuration: {
        query: {
          destinationTable: {
            schema: {
              fields: [],
            },
          },
        },
      },
      ...metadata,
    };
  }

  async getQueryResults(): Promise<[any[], any, any]> {
    return [this.queryResults, {}, {}];
  }

  async getMetadata(): Promise<[any]> {
    return [this.metadata];
  }
}

export class MockBigQuery {
  private datasets: Map<string, MockDataset> = new Map();
  private shouldFail: boolean = false;
  private failureError: Error | null = null;

  constructor() {
    this.setupDefaultDatasets();
  }

  private setupDefaultDatasets() {
    const testDataset = new MockDataset('test_dataset', 'test-project');
    testDataset.addTable('test_table', [
      { name: 'id', type: 'INTEGER', mode: 'REQUIRED' },
      { name: 'name', type: 'STRING', mode: 'NULLABLE' },
      { name: 'created_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
    ]);
    this.datasets.set('test_dataset', testDataset);

    const analyticsDataset = new MockDataset('analytics', 'test-project');
    analyticsDataset.addTable('events', [
      { name: 'event_id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'event_type', type: 'STRING', mode: 'REQUIRED' },
      { name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' },
    ]);
    this.datasets.set('analytics', analyticsDataset);
  }

  setShouldFail(shouldFail: boolean, error?: Error) {
    this.shouldFail = shouldFail;
    this.failureError = error || new Error('Mock BigQuery Error');
  }

  async createQueryJob(options: any): Promise<[Job]> {
    if (this.shouldFail) {
      throw this.failureError;
    }

    // Simulate dry run
    if (options.dryRun) {
      const job = new MockBigQueryJob('dry-run-job-id', [], {
        statistics: {
          query: {
            totalBytesProcessed: '2048000',
          },
        },
      });
      return [job as any];
    }

    // Simulate query execution
    const mockResults = this.generateMockResults(options.query);
    const job = new MockBigQueryJob('mock-job-id', mockResults);
    return [job as any];
  }

  private generateMockResults(query: string): any[] {
    // Simple mock: return different results based on query content
    if (query.toLowerCase().includes('count')) {
      return [{ count: 42 }];
    }
    if (query.toLowerCase().includes('select *')) {
      return [
        { id: 1, name: 'Test 1', created_at: new Date().toISOString() },
        { id: 2, name: 'Test 2', created_at: new Date().toISOString() },
        { id: 3, name: 'Test 3', created_at: new Date().toISOString() },
      ];
    }
    return [];
  }

  async getDatasets(): Promise<[Dataset[]]> {
    if (this.shouldFail) {
      throw this.failureError;
    }

    const datasets = Array.from(this.datasets.values());
    return [datasets as any];
  }

  dataset(datasetId: string): Dataset {
    let dataset = this.datasets.get(datasetId);
    if (!dataset) {
      dataset = new MockDataset(datasetId, 'test-project');
      this.datasets.set(datasetId, dataset);
    }
    return dataset as any;
  }

  addDataset(datasetId: string, tables: Array<{ id: string; schema: any[] }> = []) {
    const dataset = new MockDataset(datasetId, 'test-project');
    tables.forEach(({ id, schema }) => {
      dataset.addTable(id, schema);
    });
    this.datasets.set(datasetId, dataset);
  }
}

export class MockDataset {
  private tables: Map<string, MockTable> = new Map();

  constructor(public id: string, public projectId: string) {}

  addTable(tableId: string, schema: any[]) {
    this.tables.set(tableId, new MockTable(tableId, this.id, schema));
  }

  async getTables(): Promise<[Table[]]> {
    return [Array.from(this.tables.values()) as any];
  }

  table(tableId: string): Table {
    let table = this.tables.get(tableId);
    if (!table) {
      table = new MockTable(tableId, this.id, []);
      this.tables.set(tableId, table);
    }
    return table as any;
  }

  async getMetadata(): Promise<[any]> {
    return [
      {
        id: this.id,
        datasetReference: {
          datasetId: this.id,
          projectId: this.projectId,
        },
        location: 'US',
        creationTime: Date.now(),
      },
    ];
  }
}

export class MockTable {
  constructor(
    public id: string,
    public datasetId: string,
    public schema: any[]
  ) {}

  async getMetadata(): Promise<[any]> {
    return [
      {
        id: this.id,
        tableReference: {
          tableId: this.id,
          datasetId: this.datasetId,
        },
        schema: {
          fields: this.schema,
        },
        numRows: '1000',
        numBytes: '10240',
        creationTime: Date.now(),
      },
    ];
  }
}

/**
 * Create mock BigQuery instance
 */
export function createMockBigQuery(): MockBigQuery {
  return new MockBigQuery();
}

/**
 * Mock GCP authentication
 */
export function mockGoogleAuth() {
  return {
    getClient: jest.fn().mockResolvedValue({
      email: 'test@test-project.iam.gserviceaccount.com',
      projectId: 'test-project',
    }),
    getProjectId: jest.fn().mockResolvedValue('test-project'),
    getAccessToken: jest.fn().mockResolvedValue({
      token: 'mock-access-token',
      expiry_date: Date.now() + 3600000,
    }),
  };
}
