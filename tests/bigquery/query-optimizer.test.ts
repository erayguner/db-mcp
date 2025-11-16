import { QueryOptimizer } from '../../src/bigquery/query-optimizer';
import { BigQueryClient } from '../../src/bigquery/client';

// Mock BigQueryClient
jest.mock('../../src/bigquery/client');

describe('QueryOptimizer', () => {
  let optimizer: QueryOptimizer;
  let mockClient: jest.Mocked<BigQueryClient>;

  beforeEach(() => {
    mockClient = {
      dryRun: jest.fn(),
    } as any;

    optimizer = new QueryOptimizer(mockClient, {
      autoAddLimit: true,
      maxAutoLimit: 100,
      costThresholdUSD: 0.10,
    });
  });

  describe('validate', () => {
    it('should validate correct SELECT queries', async () => {
      const query = 'SELECT * FROM users WHERE id = 1';
      const result = await optimizer.validate(query);

      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should detect empty queries', async () => {
      const result = await optimizer.validate('');

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Query cannot be empty');
    });

    it('should detect dangerous SQL patterns', async () => {
      const query = 'SELECT * FROM users; DROP TABLE users';
      const result = await optimizer.validate(query);

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should warn about expensive operations', async () => {
      const query = 'SELECT * FROM large_table';
      const result = await optimizer.validate(query);

      expect(result.warnings.length).toBeGreaterThan(0);
    });

    it('should detect unbalanced parentheses', async () => {
      const query = 'SELECT * FROM users WHERE (id = 1';
      const result = await optimizer.validate(query);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Unbalanced parentheses in query');
    });

    it('should handle WITH (CTE) queries', async () => {
      const query = 'WITH temp AS (SELECT * FROM users) SELECT * FROM temp';
      const result = await optimizer.validate(query);

      expect(result.valid).toBe(true);
    });
  });

  describe('estimateCost', () => {
    it('should estimate query cost', async () => {
      mockClient.dryRun.mockResolvedValue({
        totalBytesProcessed: '1000000000',
        estimatedCost: 0.00625,
      });

      const cost = await optimizer.estimateCost('SELECT * FROM users');

      expect(cost.totalBytesProcessed).toBe('1000000000');
      expect(cost.estimatedCostUSD).toBe(0.00625);
      expect(cost.processedGB).toBeCloseTo(1, 2);
    });

    it('should mark expensive queries', async () => {
      mockClient.dryRun.mockResolvedValue({
        totalBytesProcessed: '100000000000',
        estimatedCost: 0.625,
      });

      const cost = await optimizer.estimateCost('SELECT * FROM large_table');

      expect(cost.isExpensive).toBe(true);
      expect(cost.recommendation).toBeDefined();
    });

    it('should not mark cheap queries as expensive', async () => {
      mockClient.dryRun.mockResolvedValue({
        totalBytesProcessed: '1000000',
        estimatedCost: 0.00000625,
      });

      const cost = await optimizer.estimateCost('SELECT * FROM small_table LIMIT 10');

      expect(cost.isExpensive).toBe(false);
    });
  });

  describe('injectLimit', () => {
    it('should inject LIMIT clause when missing', () => {
      const query = 'SELECT * FROM users';
      const limited = optimizer.injectLimit(query);

      expect(limited).toContain('LIMIT 100');
    });

    it('should not inject LIMIT if already present', () => {
      const query = 'SELECT * FROM users LIMIT 50';
      const limited = optimizer.injectLimit(query);

      expect(limited).toBe(query);
    });

    it('should handle custom limit values', () => {
      const query = 'SELECT * FROM users';
      const limited = optimizer.injectLimit(query, 500);

      expect(limited).toContain('LIMIT 500');
    });

    it('should preserve semicolons', () => {
      const query = 'SELECT * FROM users;';
      const limited = optimizer.injectLimit(query);

      expect(limited).toMatch(/LIMIT \d+;$/);
    });

    it('should respect autoAddLimit configuration', () => {
      const noLimitOptimizer = new QueryOptimizer(mockClient, {
        autoAddLimit: false,
      });

      const query = 'SELECT * FROM users';
      const result = noLimitOptimizer.injectLimit(query);

      expect(result).toBe(query);
    });
  });

  describe('optimize', () => {
    beforeEach(() => {
      mockClient.dryRun.mockResolvedValue({
        totalBytesProcessed: '1000000',
        estimatedCost: 0.00000625,
      });
    });

    it('should optimize valid queries', async () => {
      const query = 'SELECT * FROM users';
      const result = await optimizer.optimize(query);

      expect(result.optimized).toBeDefined();
      expect(result.suggestions).toBeDefined();
      expect(result.costEstimate).toBeDefined();
    });

    it('should provide optimization suggestions', async () => {
      mockClient.dryRun.mockResolvedValue({
        totalBytesProcessed: '10000000000',
        estimatedCost: 0.0625,
      });

      const query = 'SELECT * FROM large_table';
      const result = await optimizer.optimize(query);

      expect(result.suggestions.length).toBeGreaterThan(0);
    });

    it('should throw on invalid queries', async () => {
      const query = 'INVALID SQL';

      await expect(optimizer.optimize(query)).rejects.toThrow();
    });

    it('should add LIMIT for expensive queries', async () => {
      mockClient.dryRun.mockResolvedValue({
        totalBytesProcessed: '2000000000',
        estimatedCost: 0.0125,
      });

      const query = 'SELECT * FROM users';
      const result = await optimizer.optimize(query);

      expect(result.optimized).toContain('LIMIT');
    });
  });

  describe('analyzeQueryPlan', () => {
    it('should analyze query complexity', async () => {
      const simpleQuery = 'SELECT * FROM users';
      const plan1 = await optimizer.analyzeQueryPlan(simpleQuery);

      expect(plan1.complexity).toBe('simple');

      const complexQuery = `
        SELECT u.*, COUNT(o.id)
        FROM users u
        JOIN orders o ON u.id = o.user_id
        GROUP BY u.id
        ORDER BY COUNT(o.id)
      `;
      const plan2 = await optimizer.analyzeQueryPlan(complexQuery);

      expect(plan2.complexity).toBe('complex');
    });

    it('should detect query operations', async () => {
      const query = 'SELECT * FROM users JOIN orders ON users.id = orders.user_id';
      const plan = await optimizer.analyzeQueryPlan(query);

      expect(plan.hasJoin).toBe(true);
    });

    it('should detect aggregations', async () => {
      const query = 'SELECT COUNT(*) FROM users GROUP BY country';
      const plan = await optimizer.analyzeQueryPlan(query);

      expect(plan.hasAggregation).toBe(true);
    });
  });

  describe('generateReport', () => {
    beforeEach(() => {
      mockClient.dryRun.mockResolvedValue({
        totalBytesProcessed: '1000000',
        estimatedCost: 0.00000625,
      });
    });

    it('should generate comprehensive report', async () => {
      const query = 'SELECT * FROM users LIMIT 10';
      const report = await optimizer.generateReport(query);

      expect(report.validation).toBeDefined();
      expect(report.cost).toBeDefined();
      expect(report.plan).toBeDefined();
      expect(report.score).toBeGreaterThanOrEqual(0);
      expect(report.score).toBeLessThanOrEqual(100);
    });

    it('should penalize invalid queries', async () => {
      const query = 'INVALID SQL';
      const report = await optimizer.generateReport(query);

      expect(report.score).toBeLessThan(50);
    });

    it('should give high scores to optimized queries', async () => {
      const query = 'SELECT id, name FROM users WHERE country = "US" LIMIT 100';
      const report = await optimizer.generateReport(query);

      expect(report.score).toBeGreaterThan(80);
    });
  });

  describe('configuration', () => {
    it('should update configuration', () => {
      optimizer.updateConfig({ maxAutoLimit: 500 });

      const config = optimizer.getConfig();
      expect(config.maxAutoLimit).toBe(500);
    });

    it('should preserve other config values when updating', () => {
      const originalConfig = optimizer.getConfig();
      optimizer.updateConfig({ maxAutoLimit: 500 });

      const newConfig = optimizer.getConfig();
      expect(newConfig.autoAddLimit).toBe(originalConfig.autoAddLimit);
    });
  });
});
