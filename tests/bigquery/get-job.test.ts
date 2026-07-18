import { BigQueryClient } from '../../src/bigquery/client';
import { setMockJob, resetMockJobs } from '../../__mocks__/@google-cloud/bigquery.js';

/**
 * `bigquery://jobs/{jobId}` was advertised in resources/templates/list but
 * BigQueryClient had no getJob(), so every read of that template threw
 * "not implemented in this build". These tests cover the implementation.
 */
describe('BigQueryClient.getJob', () => {
  let client: BigQueryClient;

  beforeEach(() => {
    resetMockJobs();
    client = new BigQueryClient({
      projectId: 'test-project',
      location: 'europe-west2',
    } as never);
  });

  it('returns normalized job metadata', async () => {
    const job = await client.getJob('job-abc');

    expect(job.jobId).toBe('job-abc');
    expect(job.state).toBe('DONE');
    expect(job.totalBytesProcessed).toBe('2048');
    expect(job.cacheHit).toBe(false);
  });

  it('converts BigQuery epoch-millis timestamps to ISO strings and a duration', async () => {
    const job = await client.getJob('job-timing');

    expect(job.startTime).toBe(new Date(1700000000000).toISOString());
    expect(job.endTime).toBe(new Date(1700000001500).toISOString());
    expect(job.durationMs).toBe(1500);
  });

  it('surfaces a job error result', async () => {
    setMockJob('job-failed', {
      status: { state: 'DONE', errorResult: { message: 'Query exceeded limit' } },
      statistics: {},
    });

    const job = await client.getJob('job-failed');
    expect(job.error).toBe('Query exceeded limit');
  });

  it('omits optional fields rather than emitting undefined/NaN when stats are absent', async () => {
    setMockJob('job-bare', { status: { state: 'RUNNING' }, statistics: {} });

    const job = await client.getJob('job-bare');
    expect(job.state).toBe('RUNNING');
    expect(job).not.toHaveProperty('durationMs');
    expect(job.startTime).toBeUndefined();
  });
});
