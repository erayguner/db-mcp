import { QueryMetricsTracker } from '../../src/bigquery/query-metrics';

describe.skip('QueryMetricsTracker', () => {
  let tracker: QueryMetricsTracker;

  beforeEach(() => {
    tracker = new QueryMetricsTracker({
      slowQueryThresholdMs: 1000,
      expensiveCostThresholdUSD: 0.1,
      retentionPeriodMs: 60000,
    });
  });

  afterEach(() => {
    tracker.stopCleanup();
    tracker.clear();
  });

  describe('startQuery/endQuery', () => {
    it('should track query execution', () => {
      const queryId = 'query-1';
      const query = 'SELECT * FROM users';

      tracker.startQuery(queryId, query);

      // Simulate some work
      const start = Date.now();
      while (Date.now() - start < 10) {
        // Wait
      }

      tracker.endQuery(queryId, {
        success: true,
        bytesProcessed: 1000000,
        rowCount: 100,
      });

      const metric = tracker.getMetric(queryId);
      expect(metric).toBeDefined();
      expect(metric?.success).toBe(true);
      expect(metric?.bytesProcessed).toBe(1000000);
      expect(metric?.duration).toBeGreaterThan(0);
    });

    it('should handle query failures', () => {
      const queryId = 'query-2';

      tracker.startQuery(queryId, 'INVALID SQL');
      tracker.endQuery(queryId, {
        success: false,
        errorMessage: 'Syntax error',
      });

      const metric = tracker.getMetric(queryId);
      expect(metric?.success).toBe(false);
      expect(metric?.errorMessage).toBe('Syntax error');
    });

    it('should track cached queries', () => {
      const queryId = 'query-3';

      tracker.startQuery(queryId, 'SELECT * FROM users');
      tracker.endQuery(queryId, {
        success: true,
        cached: true,
        rowCount: 50,
      });

      const metric = tracker.getMetric(queryId);
      expect(metric?.cached).toBe(true);
    });

    it('should calculate query cost', () => {
      const queryId = 'query-4';

      tracker.startQuery(queryId, 'SELECT * FROM large_table');
      tracker.endQuery(queryId, {
        success: true,
        bytesProcessed: 1000000000000, // 1TB
      });

      const metric = tracker.getMetric(queryId);
      expect(metric?.cost).toBeCloseTo(6.25, 2);
    });
  });

  describe('getStats', () => {
    it('should calculate aggregated statistics', () => {
      // Add successful queries
      for (let i = 0; i < 5; i++) {
        tracker.startQuery(`query-${i}`, 'SELECT * FROM users');
        tracker.endQuery(`query-${i}`, {
          success: true,
          bytesProcessed: 1000000,
        });
      }

      // Add failed query
      tracker.startQuery('query-fail', 'INVALID');
      tracker.endQuery('query-fail', {
        success: false,
        errorMessage: 'Error',
      });

      const stats = tracker.getStats();

      expect(stats.totalQueries).toBe(6);
      expect(stats.successfulQueries).toBe(5);
      expect(stats.failedQueries).toBe(1);
      expect(stats.errorRate).toBeCloseTo(16.67, 1);
    });

    it('should calculate cache hit rate', () => {
      // Cached queries
      for (let i = 0; i < 3; i++) {
        tracker.startQuery(`cached-${i}`, 'SELECT * FROM users');
        tracker.endQuery(`cached-${i}`, {
          success: true,
          cached: true,
        });
      }

      // Non-cached queries
      for (let i = 0; i < 7; i++) {
        tracker.startQuery(`direct-${i}`, 'SELECT * FROM users');
        tracker.endQuery(`direct-${i}`, {
          success: true,
          cached: false,
        });
      }

      const stats = tracker.getStats();
      expect(stats.cacheHitRate).toBe(30);
    });

    it('should identify slow queries', () => {
      // Slow query
      tracker.startQuery('slow', 'SELECT * FROM users');
      const start = Date.now();
      while (Date.now() - start < 1100) {
        // Wait to exceed threshold
      }
      tracker.endQuery('slow', { success: true });

      // Fast query
      tracker.startQuery('fast', 'SELECT * FROM users LIMIT 1');
      tracker.endQuery('fast', { success: true });

      const stats = tracker.getStats();
      expect(stats.slowQueries.length).toBeGreaterThan(0);
    });

    it('should identify expensive queries', () => {
      tracker.startQuery('expensive', 'SELECT * FROM huge_table');
      tracker.endQuery('expensive', {
        success: true,
        bytesProcessed: 100000000000, // 100GB
      });

      tracker.startQuery('cheap', 'SELECT * FROM small_table LIMIT 10');
      tracker.endQuery('cheap', {
        success: true,
        bytesProcessed: 1000,
      });

      const stats = tracker.getStats();
      expect(stats.expensiveQueries.length).toBeGreaterThan(0);
      expect(stats.expensiveQueries[0].queryId).toBe('expensive');
    });
  });

  describe('analyzeUsagePatterns', () => {
    it('should analyze usage by hour', () => {
      // Add queries at different times
      for (let i = 0; i < 5; i++) {
        const queryId = `query-${i}`;
        tracker.startQuery(queryId, 'SELECT * FROM users');
        tracker.endQuery(queryId, {
          success: true,
          bytesProcessed: 1000000,
        });
      }

      const patterns = tracker.analyzeUsagePatterns();

      expect(patterns.length).toBeGreaterThan(0);
      expect(patterns[0]).toHaveProperty('hour');
      expect(patterns[0]).toHaveProperty('queryCount');
      expect(patterns[0]).toHaveProperty('totalBytes');
      expect(patterns[0]).toHaveProperty('totalCost');
    });
  });

  describe('getTopQueries', () => {
    beforeEach(() => {
      // Add queries with varying metrics
      tracker.startQuery('slow', 'SELECT * FROM users');
      const start = Date.now();
      while (Date.now() - start < 100) {
        // Make it slower
      }
      tracker.endQuery('slow', { success: true, bytesProcessed: 1000 });

      tracker.startQuery('expensive', 'SELECT * FROM large_table');
      tracker.endQuery('expensive', { success: true, bytesProcessed: 1000000000000 });

      tracker.startQuery('fast', 'SELECT * FROM users LIMIT 1');
      tracker.endQuery('fast', { success: true, bytesProcessed: 100 });
    });

    it('should get top queries by duration', () => {
      const topQueries = tracker.getTopQueries('duration', 2);

      expect(topQueries.length).toBeGreaterThan(0);
      expect(topQueries[0].duration).toBeGreaterThanOrEqual(
        topQueries[topQueries.length - 1].duration!
      );
    });

    it('should get top queries by cost', () => {
      const topQueries = tracker.getTopQueries('cost', 2);

      expect(topQueries.length).toBeGreaterThan(0);
      expect(topQueries[0].queryId).toBe('expensive');
    });

    it('should get top queries by bytes processed', () => {
      const topQueries = tracker.getTopQueries('bytes', 2);

      expect(topQueries.length).toBeGreaterThan(0);
      expect(topQueries[0].bytesProcessed).toBeGreaterThanOrEqual(
        topQueries[topQueries.length - 1].bytesProcessed
      );
    });
  });

  describe('generateReport', () => {
    it('should generate comprehensive report', () => {
      // Add some queries
      for (let i = 0; i < 10; i++) {
        tracker.startQuery(`query-${i}`, 'SELECT * FROM users');
        tracker.endQuery(`query-${i}`, {
          success: true,
          bytesProcessed: 1000000,
        });
      }

      const report = tracker.generateReport();

      expect(report.stats).toBeDefined();
      expect(report.usagePatterns).toBeDefined();
      expect(report.topSlowQueries).toBeDefined();
      expect(report.topExpensiveQueries).toBeDefined();
      expect(report.recommendations).toBeDefined();
    });

    it('should provide recommendations for high error rate', () => {
      // Add mostly failing queries
      for (let i = 0; i < 10; i++) {
        tracker.startQuery(`query-${i}`, 'SELECT * FROM users');
        tracker.endQuery(`query-${i}`, {
          success: i < 2, // Only 2 succeed
          errorMessage: i >= 2 ? 'Error' : undefined,
        });
      }

      const report = tracker.generateReport();

      const errorRecommendation = report.recommendations.find((r) => r.includes('error rate'));
      expect(errorRecommendation).toBeDefined();
    });

    it('should recommend cache improvements for low hit rate', () => {
      // Add queries with low cache hit rate
      for (let i = 0; i < 10; i++) {
        tracker.startQuery(`query-${i}`, 'SELECT * FROM users');
        tracker.endQuery(`query-${i}`, {
          success: true,
          cached: i === 0, // Only 1 cached
        });
      }

      const report = tracker.generateReport();

      const cacheRecommendation = report.recommendations.find((r) => r.includes('cache hit rate'));
      expect(cacheRecommendation).toBeDefined();
    });
  });

  describe('cleanup', () => {
    it('should remove old metrics', async () => {
      const shortRetentionTracker = new QueryMetricsTracker({
        retentionPeriodMs: 100,
      });

      shortRetentionTracker.startQuery('old', 'SELECT * FROM users');
      shortRetentionTracker.endQuery('old', { success: true });

      // Wait for retention period to expire
      await new Promise((resolve) => setTimeout(resolve, 150));

      const removed = shortRetentionTracker.cleanup();

      expect(removed).toBe(1);
      expect(shortRetentionTracker.getMetric('old')).toBeNull();

      shortRetentionTracker.stopCleanup();
    });
  });

  describe('export', () => {
    it('should export metrics data', () => {
      tracker.startQuery('query-1', 'SELECT * FROM users');
      tracker.endQuery('query-1', { success: true, bytesProcessed: 1000 });

      const exported = tracker.export();

      expect(exported.metrics).toBeDefined();
      expect(exported.stats).toBeDefined();
      expect(exported.exportTime).toBeDefined();
      expect(exported.metrics.length).toBe(1);
    });
  });

  describe('configuration', () => {
    it('should update configuration', () => {
      tracker.updateConfig({ slowQueryThresholdMs: 5000 });

      const config = tracker.getConfig();
      expect(config.slowQueryThresholdMs).toBe(5000);
    });
  });
});
