import { BigQueryClient } from '../../src/bigquery/client';
import { setMockJob, resetMockJobs } from '../../__mocks__/@google-cloud/bigquery.js';

/**
 * QueryOptimizer.analyzeQueryPlan() used to fabricate an execution plan from a
 * regex sniff of the SQL text: a single hardcoded "S00: Input" stage plus
 * totalSlotMs/estimatedRows/recordsRead/recordsWritten permanently pinned to 0,
 * which estimateQueryCost() then consumed as if measured.
 *
 * A plan can only come from a job BigQuery actually ran. These tests cover the
 * real implementation, which reads `statistics.query.queryPlan`.
 */
describe('BigQueryClient.getQueryPlan', () => {
  let client: BigQueryClient;

  beforeEach(() => {
    resetMockJobs();
    client = new BigQueryClient({
      projectId: 'test-project',
      location: 'europe-west2',
    } as never);
  });

  it('maps real stages from job statistics', async () => {
    setMockJob('job-plan', {
      status: { state: 'DONE' },
      statistics: {
        query: {
          totalSlotMs: '4200',
          totalBytesProcessed: '10485760',
          cacheHit: false,
          queryPlan: [
            {
              id: '0',
              name: 'S00: Input',
              status: 'COMPLETE',
              slotMs: '3000',
              recordsRead: '15000',
              recordsWritten: '900',
              steps: [{ kind: 'READ', substeps: ['FROM users', 'WHERE id > 5'] }],
            },
            {
              id: '1',
              name: 'S01: Output',
              status: 'COMPLETE',
              slotMs: '1200',
              recordsRead: '900',
              recordsWritten: '900',
              steps: [{ kind: 'WRITE' }],
            },
          ],
        },
      },
    });

    const plan = await client.getQueryPlan('job-plan');

    expect(plan.jobId).toBe('job-plan');
    expect(plan.totalSlotMs).toBe(4200);
    expect(plan.totalBytesProcessed).toBe('10485760');
    expect(plan.cacheHit).toBe(false);
    expect(plan.stages).toHaveLength(2);

    expect(plan.stages[0]).toEqual({
      id: '0',
      name: 'S00: Input',
      status: 'COMPLETE',
      slotMs: 3000,
      recordsRead: 15000,
      recordsWritten: 900,
      steps: ['FROM users', 'WHERE id > 5'],
    });

    // A step with no substeps falls back to its machine-readable kind.
    expect(plan.stages[1].steps).toEqual(['WRITE']);
  });

  it('reports no stages, rather than a fake one, when the job has no plan', async () => {
    setMockJob('job-cached', {
      status: { state: 'DONE' },
      statistics: { query: { cacheHit: true, totalBytesProcessed: '0' } },
    });

    const plan = await client.getQueryPlan('job-cached');

    expect(plan.stages).toEqual([]);
    expect(plan.cacheHit).toBe(true);
    // The key property: an unreported counter stays absent. Returning 0 here is
    // exactly the defect this replaced — a caller cannot distinguish a
    // fabricated zero from a measured one.
    expect(plan).not.toHaveProperty('totalSlotMs');
  });

  it('omits per-stage counters BigQuery did not report', async () => {
    setMockJob('job-partial', {
      status: { state: 'RUNNING' },
      statistics: {
        query: {
          queryPlan: [{ name: 'S00: Input', status: 'RUNNING' }],
        },
      },
    });

    const plan = await client.getQueryPlan('job-partial');
    const stage = plan.stages[0];

    expect(stage.name).toBe('S00: Input');
    expect(stage.steps).toEqual([]);
    expect(stage).not.toHaveProperty('slotMs');
    expect(stage).not.toHaveProperty('recordsRead');
    expect(stage).not.toHaveProperty('recordsWritten');
    expect(stage).not.toHaveProperty('id');
  });

  it('names an unnamed stage explicitly instead of leaving it undefined', async () => {
    setMockJob('job-unnamed', {
      status: { state: 'DONE' },
      statistics: { query: { queryPlan: [{ status: 'COMPLETE' }] } },
    });

    const plan = await client.getQueryPlan('job-unnamed');
    expect(plan.stages[0].name).toBe('unnamed stage');
  });

  it('releases the pooled connection after reading the plan', async () => {
    const before = client.getPoolMetrics();
    await client.getQueryPlan('job-plan-release');
    const after = client.getPoolMetrics();

    expect(after.totalReleased).toBe(before.totalReleased + 1);
    expect(after.activeConnections).toBe(0);
  });
});
