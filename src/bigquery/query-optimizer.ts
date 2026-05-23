import { BigQueryClient } from './client.js';
import { logger } from '../utils/logger.js';

/**
 * Query Validation Result
 */
export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  sanitized: string;
}

/**
 * Query Cost Estimation
 */
export interface CostEstimate {
  totalBytesProcessed: string;
  estimatedCostUSD: number;
  processedGB: number;
  isExpensive: boolean;
  recommendation?: string;
}

/**
 * Query Plan Analysis
 */
export interface QueryPlan {
  stages: QueryStage[];
  totalSlotMs: number;
  estimatedRows: number;
  hasSort: boolean;
  hasJoin: boolean;
  hasAggregation: boolean;
  complexity: 'simple' | 'moderate' | 'complex';
}

export interface QueryStage {
  name: string;
  status: string;
  recordsRead: number;
  recordsWritten: number;
  steps: string[];
}

/**
 * Optimization Suggestion
 */
export interface OptimizationSuggestion {
  type: 'limit' | 'partition' | 'clustering' | 'caching' | 'indexing' | 'query_structure';
  severity: 'info' | 'warning' | 'critical';
  message: string;
  estimatedSavings?: number; // Percentage
}

/**
 * Query Optimizer Configuration
 */
export interface QueryOptimizerConfig {
  autoAddLimit: boolean;
  maxAutoLimit: number;
  costThresholdUSD: number; // Warn if query costs more than this
  enableQueryRewrite: boolean;
  enablePartitionPruning: boolean;
}

/**
 * Query Optimizer for BigQuery
 *
 * Features:
 * - Query validation and sanitization
 * - Cost estimation and analysis
 * - Automatic LIMIT clause injection
 * - Query plan analysis
 * - Optimization recommendations
 * - Security checks (SQL injection prevention)
 */
export class QueryOptimizer {
  private client: BigQueryClient;
  private config: QueryOptimizerConfig;

  // Dangerous SQL patterns to block
  private readonly dangerousPatterns = [
    /;\s*drop\s+/i,
    /;\s*delete\s+/i,
    /;\s*truncate\s+/i,
    /;\s*alter\s+/i,
    /;\s*create\s+/i,
    /exec\s*\(/i,
    /execute\s*\(/i,
    /script\s*\(/i,
  ];

  // Expensive operations to warn about
  private readonly expensivePatterns = [
    /select\s+\*\s+from.*(?!limit)/i,
    /cross\s+join/i,
    /unnest.*unnest/i, // Multiple UNNESTs
    /order\s+by.*(?!limit)/i,
  ];

  constructor(client: BigQueryClient, config?: Partial<QueryOptimizerConfig>) {
    this.client = client;
    this.config = {
      autoAddLimit: config?.autoAddLimit ?? true,
      maxAutoLimit: config?.maxAutoLimit ?? 1000,
      costThresholdUSD: config?.costThresholdUSD ?? 0.5,
      enableQueryRewrite: config?.enableQueryRewrite ?? true,
      enablePartitionPruning: config?.enablePartitionPruning ?? true,
    };

    logger.info('QueryOptimizer initialized', this.config);
  }

  /**
   * Validate and sanitize SQL query
   */
  validate(query: string): ValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const sanitized = query.trim();

    // Check for empty query
    if (!sanitized) {
      errors.push('Query cannot be empty');
      return { valid: false, errors, warnings, sanitized };
    }

    // Check for dangerous patterns
    for (const pattern of this.dangerousPatterns) {
      if (pattern.test(sanitized)) {
        errors.push(`Potentially dangerous SQL pattern detected: ${pattern.source}`);
      }
    }

    // Check for expensive operations
    for (const pattern of this.expensivePatterns) {
      if (pattern.test(sanitized)) {
        warnings.push(`Potentially expensive operation detected: ${pattern.source}`);
      }
    }

    // Check for SELECT * without LIMIT
    if (/select\s+\*\s+from/i.test(sanitized) && !/limit\s+\d+/i.test(sanitized)) {
      warnings.push('SELECT * without LIMIT can be expensive. Consider adding a LIMIT clause.');
    }

    // Validate SQL syntax (basic check)
    const hasSelect = /^\s*(select|with)/i.test(sanitized);
    if (!hasSelect) {
      errors.push('Query must start with SELECT or WITH clause');
    }

    // Check for balanced parentheses
    const openParens = (sanitized.match(/\(/g) || []).length;
    const closeParens = (sanitized.match(/\)/g) || []).length;
    if (openParens !== closeParens) {
      errors.push('Unbalanced parentheses in query');
    }

    logger.debug('Query validation completed', {
      errors: errors.length,
      warnings: warnings.length,
    });

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      sanitized,
    };
  }

  /**
   * Estimate query cost using dry run
   */
  async estimateCost(query: string): Promise<CostEstimate> {
    try {
      const result = await this.client.dryRun(query);
      const bytes = parseInt(result.totalBytesProcessed);
      const processedGB = bytes / 1e9;

      // BigQuery pricing: $6.25 per TB (first 1TB free per month)
      const estimatedCostUSD = result.estimatedCostUSD;
      const isExpensive = estimatedCostUSD > this.config.costThresholdUSD;

      let recommendation: string | undefined;
      if (isExpensive) {
        recommendation = `Query will process ${processedGB.toFixed(2)}GB and cost ~$${estimatedCostUSD.toFixed(4)}. Consider adding filters or using partitioned tables.`;
      }

      logger.info('Query cost estimated', {
        bytesProcessed: result.totalBytesProcessed,
        estimatedCost: `$${estimatedCostUSD.toFixed(4)}`,
        isExpensive,
      });

      return {
        totalBytesProcessed: result.totalBytesProcessed,
        estimatedCostUSD,
        processedGB,
        isExpensive,
        recommendation,
      };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Cost estimation failed', { error: errorMsg });
      throw error;
    }
  }

  /**
   * Inject LIMIT clause if not present
   */
  injectLimit(query: string, limit?: number): string {
    // Skip if limit already exists
    if (/limit\s+\d+/i.test(query)) {
      return query;
    }

    // Skip if not enabled
    if (!this.config.autoAddLimit) {
      return query;
    }

    const limitValue = limit ?? this.config.maxAutoLimit;
    const trimmedQuery = query.trim();

    // Handle queries with semicolon at the end
    const hasSemicolon = trimmedQuery.endsWith(';');
    const baseQuery = hasSemicolon ? trimmedQuery.slice(0, -1) : trimmedQuery;

    const limitedQuery = `${baseQuery} LIMIT ${limitValue}${hasSemicolon ? ';' : ''}`;

    logger.debug('LIMIT clause injected', { limit: limitValue });

    return limitedQuery;
  }

  /**
   * Optimize query with automatic improvements
   */
  async optimize(query: string): Promise<{
    optimized: string;
    suggestions: OptimizationSuggestion[];
    costEstimate: CostEstimate;
  }> {
    const suggestions: OptimizationSuggestion[] = [];
    let optimized = query;

    // Validate query first
    const validation = this.validate(query);
    if (!validation.valid) {
      throw new Error(`Query validation failed: ${validation.errors.join(', ')}`);
    }

    // Add warnings as suggestions
    for (const warning of validation.warnings) {
      suggestions.push({
        type: 'query_structure',
        severity: 'warning',
        message: warning,
      });
    }

    // Estimate cost
    const costEstimate = await this.estimateCost(query);
    if (costEstimate.isExpensive) {
      suggestions.push({
        type: 'caching',
        severity: 'warning',
        message: costEstimate.recommendation!,
        estimatedSavings: 50,
      });
    }

    // Auto-inject LIMIT if enabled and cost is high
    if (this.config.autoAddLimit && costEstimate.processedGB > 1) {
      optimized = this.injectLimit(optimized);
      suggestions.push({
        type: 'limit',
        severity: 'info',
        message: `Added LIMIT ${this.config.maxAutoLimit} to prevent expensive query`,
      });
    }

    // Check for partition opportunities
    if (this.config.enablePartitionPruning) {
      const partitionSuggestion = this.analyzePartitioning(query);
      if (partitionSuggestion) {
        suggestions.push(partitionSuggestion);
      }
    }

    logger.info('Query optimization completed', {
      suggestionsCount: suggestions.length,
      modified: optimized !== query,
    });

    return {
      optimized,
      suggestions,
      costEstimate,
    };
  }

  /**
   * Analyze query plan (mock implementation - would use BigQuery API in production)
   */
  analyzeQueryPlan(query: string): QueryPlan {
    // This is a simplified mock. In production, you would:
    // 1. Execute query with explain plan
    // 2. Parse the execution plan from BigQuery
    // 3. Extract stage information

    const hasSort = /order\s+by/i.test(query);
    const hasJoin = /join/i.test(query);
    const hasAggregation = /(group\s+by|sum|count|avg|max|min)\s*\(/i.test(query);

    let complexity: 'simple' | 'moderate' | 'complex' = 'simple';
    if (hasSort && hasJoin && hasAggregation) {
      complexity = 'complex';
    } else if (hasSort || hasJoin || hasAggregation) {
      complexity = 'moderate';
    }

    const plan: QueryPlan = {
      stages: [
        {
          name: 'S00: Input',
          status: 'COMPLETE',
          recordsRead: 0,
          recordsWritten: 0,
          steps: ['READ'],
        },
      ],
      totalSlotMs: 0,
      estimatedRows: 0,
      hasSort,
      hasJoin,
      hasAggregation,
      complexity,
    };

    logger.debug('Query plan analyzed', { complexity });

    return plan;
  }

  /**
   * Analyze partitioning opportunities
   */
  private analyzePartitioning(query: string): OptimizationSuggestion | null {
    // Check if query references date/timestamp columns without filters
    const hasDateColumn = /(created_at|updated_at|timestamp|date|datetime)/i.test(query);
    const hasDateFilter = /where.*\b(created_at|updated_at|timestamp|date|datetime)\b/i.test(query);

    if (hasDateColumn && !hasDateFilter) {
      return {
        type: 'partition',
        severity: 'warning',
        message:
          'Query references date/timestamp columns but has no date filter. Consider filtering by date to reduce scanned data.',
        estimatedSavings: 70,
      };
    }

    return null;
  }

  /**
   * Generate optimization report
   */
  async generateReport(query: string): Promise<{
    validation: ValidationResult;
    cost: CostEstimate;
    plan: QueryPlan;
    suggestions: OptimizationSuggestion[];
    score: number; // 0-100, higher is better
  }> {
    const validation = this.validate(query);
    const cost = await this.estimateCost(query);
    const plan = this.analyzeQueryPlan(query);
    const suggestions: OptimizationSuggestion[] = [];

    // Calculate optimization score
    let score = 100;

    if (!validation.valid) score -= 50;
    if (validation.warnings.length > 0) score -= validation.warnings.length * 5;
    if (cost.isExpensive) score -= 20;
    if (plan.complexity === 'complex') score -= 10;
    if (!/limit\s+\d+/i.test(query)) score -= 10;

    score = Math.max(0, score);

    logger.info('Optimization report generated', { score });

    return {
      validation,
      cost,
      plan,
      suggestions,
      score,
    };
  }

  /**
   * Update optimizer configuration
   */
  updateConfig(config: Partial<QueryOptimizerConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('Optimizer configuration updated', this.config);
  }

  /**
   * Get current configuration
   */
  getConfig(): QueryOptimizerConfig {
    return { ...this.config };
  }
}
