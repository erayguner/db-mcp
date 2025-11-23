/**
 * Verification Test - BigQuery Mock
 * Tests that the mock file is correctly set up and working
 */

import { BigQuery } from '@google-cloud/bigquery';

describe('BigQuery Mock Verification', () => {
  it('should import BigQuery class', () => {
    expect(BigQuery).toBeDefined();
    expect(typeof BigQuery).toBe('function');
  });

  it('should create BigQuery instance', () => {
    const client = new BigQuery({ projectId: 'test-project' });
    expect(client).toBeDefined();
    expect(client.projectId).toBe('test-project');
  });

  it('should have createQueryJob method', async () => {
    const client = new BigQuery({ projectId: 'test-project' });
    expect(typeof client.createQueryJob).toBe('function');

    const [job] = await client.createQueryJob({
      query: 'SELECT 1',
    });

    expect(job).toBeDefined();
    expect(job.id).toBeDefined();
  });

  it('should have dataset method', () => {
    const client = new BigQuery({ projectId: 'test-project' });
    expect(typeof client.dataset).toBe('function');

    const dataset = client.dataset('test_dataset');
    expect(dataset).toBeDefined();
    expect(dataset.id).toBe('test_dataset');
  });

  it('should have table method on dataset', () => {
    const client = new BigQuery({ projectId: 'test-project' });
    const dataset = client.dataset('test_dataset');
    expect(typeof dataset.table).toBe('function');

    const table = dataset.table('test_table');
    expect(table).toBeDefined();
    expect(table.id).toBe('test_table');
  });

  it('should return query results', async () => {
    const client = new BigQuery({ projectId: 'test-project' });
    const [job] = await client.createQueryJob({
      query: 'SELECT 1',
    });

    const [rows] = await job.getQueryResults();
    expect(rows).toBeDefined();
    expect(Array.isArray(rows)).toBe(true);
  });

  it('should return job metadata', async () => {
    const client = new BigQuery({ projectId: 'test-project' });
    const [job] = await client.createQueryJob({
      query: 'SELECT * FROM test_table',
    });

    const [metadata] = await job.getMetadata();
    expect(metadata).toBeDefined();
    expect(metadata.statistics).toBeDefined();
    expect(metadata.statistics.query).toBeDefined();
  });

  it('should support getDatasets method', async () => {
    const client = new BigQuery({ projectId: 'test-project' });
    expect(typeof client.getDatasets).toBe('function');

    const [datasets] = await client.getDatasets();
    expect(datasets).toBeDefined();
    expect(Array.isArray(datasets)).toBe(true);
  });
});
