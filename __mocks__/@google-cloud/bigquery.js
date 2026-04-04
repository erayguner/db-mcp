/**
 * Mock BigQuery Client for Jest Tests
 * Simulates Google Cloud BigQuery API responses
 */

/**
 * Mock BigQuery Job
 */
export class Job {
  constructor(id = 'mock-job-id', results = [], metadata = {}) {
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

  async getQueryResults() {
    return [this.queryResults, {}, {}];
  }

  async getMetadata() {
    return [this.metadata];
  }
}

/**
 * Mock BigQuery Table
 */
export class Table {
  constructor(id = 'mock-table', datasetId = 'mock-dataset', schema = []) {
    this.id = id;
    this.datasetId = datasetId;
    this.schema = schema;
  }

  async getMetadata() {
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
        type: 'TABLE',
      },
    ];
  }

  async insert(rows) {
    return Promise.resolve();
  }

  async load(source) {
    return Promise.resolve([new Job('load-job-id')]);
  }
}

/**
 * Mock BigQuery Dataset
 */
export class Dataset {
  constructor(id = 'mock-dataset', projectId = 'test-project') {
    this.id = id;
    this.projectId = projectId;
    this.tables = new Map();
  }

  async getTables() {
    return [Array.from(this.tables.values())];
  }

  table(tableId) {
    let table = this.tables.get(tableId);
    if (!table) {
      table = new Table(tableId, this.id, []);
      this.tables.set(tableId, table);
    }
    return table;
  }

  async getMetadata() {
    return [
      {
        id: this.id,
        datasetReference: {
          datasetId: this.id,
          projectId: this.projectId,
        },
        location: 'EU',
        creationTime: Date.now(),
      },
    ];
  }

  async create() {
    return Promise.resolve([this]);
  }

  async delete() {
    return Promise.resolve();
  }
}

/**
 * Mock BigQuery Client
 */
export class BigQuery {
  constructor(options = {}) {
    this.projectId = options.projectId || 'test-project';
    this.location = options.location || 'EU';
    this.datasets = new Map();
    this.shouldFail = false;
    this.failureError = null;

    // Setup default datasets for testing
    this.setupDefaultDatasets();
  }

  setupDefaultDatasets() {
    const testDataset = new Dataset('test_dataset', this.projectId);
    const testTable = new Table('test_table', 'test_dataset', [
      { name: 'id', type: 'INTEGER', mode: 'REQUIRED' },
      { name: 'name', type: 'STRING', mode: 'NULLABLE' },
      { name: 'created_at', type: 'TIMESTAMP', mode: 'NULLABLE' },
    ]);
    testDataset.tables.set('test_table', testTable);
    this.datasets.set('test_dataset', testDataset);

    const analyticsDataset = new Dataset('analytics', this.projectId);
    const eventsTable = new Table('events', 'analytics', [
      { name: 'event_id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'user_id', type: 'STRING', mode: 'REQUIRED' },
      { name: 'event_type', type: 'STRING', mode: 'REQUIRED' },
      { name: 'timestamp', type: 'TIMESTAMP', mode: 'REQUIRED' },
    ]);
    analyticsDataset.tables.set('events', eventsTable);
    this.datasets.set('analytics', analyticsDataset);
  }

  setShouldFail(shouldFail, error) {
    this.shouldFail = shouldFail;
    this.failureError = error || new Error('Mock BigQuery Error');
  }

  async createQueryJob(options) {
    if (this.shouldFail) {
      throw this.failureError;
    }

    // Simulate dry run
    if (options.dryRun) {
      const job = new Job('dry-run-job-id', [], {
        statistics: {
          query: {
            totalBytesProcessed: '2048000',
          },
        },
      });
      return [job];
    }

    // Simulate query execution
    const mockResults = this.generateMockResults(options.query || '');
    const metadata = {
      statistics: {
        query: {
          totalBytesProcessed: options.dryRun ? '2048000' : '1024000',
          cacheHit: false,
        },
      },
    };
    const job = new Job('mock-job-id', mockResults, metadata);
    return [job];
  }

  generateMockResults(query) {
    const lowerQuery = query.toLowerCase();

    // Return specific results based on query content
    if (lowerQuery.includes('count')) {
      return [{ count: 42 }];
    }

    if (lowerQuery.includes('select 1')) {
      return [{ result: 1 }];
    }

    if (lowerQuery.includes('select *')) {
      return [
        { id: 1, name: 'Test 1', created_at: new Date().toISOString() },
        { id: 2, name: 'Test 2', created_at: new Date().toISOString() },
        { id: 3, name: 'Test 3', created_at: new Date().toISOString() },
      ];
    }

    return [];
  }

  async query(options) {
    const [job] = await this.createQueryJob(options);
    const [rows] = await job.getQueryResults();
    return [rows];
  }

  async getDatasets() {
    if (this.shouldFail) {
      throw this.failureError;
    }

    return [Array.from(this.datasets.values())];
  }

  dataset(datasetId) {
    let dataset = this.datasets.get(datasetId);
    if (!dataset) {
      dataset = new Dataset(datasetId, this.projectId);
      this.datasets.set(datasetId, dataset);
    }
    return dataset;
  }

  async createDataset(datasetId, options) {
    const dataset = new Dataset(datasetId, this.projectId);
    this.datasets.set(datasetId, dataset);
    return [dataset];
  }

  // Helper method for tests to add datasets
  addDataset(datasetId, tables = []) {
    const dataset = new Dataset(datasetId, this.projectId);
    tables.forEach(({ id, schema }) => {
      const table = new Table(id, datasetId, schema);
      dataset.tables.set(id, table);
    });
    this.datasets.set(datasetId, dataset);
    return dataset;
  }
}

// Export default and named exports
export default {
  BigQuery,
  Job,
  Dataset,
  Table,
};
