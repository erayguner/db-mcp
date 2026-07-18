import crypto from 'crypto';
import { logger } from '../utils/logger.js';

/**
 * Column-Level Data Masking Engine
 *
 * Applies masking rules to query result rows based on tenant configuration.
 * Supports glob-based pattern matching for dataset, table, and column names.
 *
 * Mask types:
 * - redact:   Replace value with [REDACTED]
 * - hash:     SHA-256 hash (preserves referential integrity)
 * - partial:  Show first/last characters (e.g., j***@email.com, ****1234)
 * - nullify:  Replace with null
 */

// ==========================================
// Types & Interfaces
// ==========================================

export interface ColumnMaskingRule {
  datasetPattern: string; // glob or regex pattern for dataset
  tablePattern: string; // glob or regex pattern for table
  columnPattern: string; // glob or regex pattern for column name
  maskType: 'redact' | 'hash' | 'partial' | 'nullify';
  description?: string;
}

export interface MaskingConfig {
  rules: ColumnMaskingRule[];
  enabled: boolean;
  defaultMaskType: 'redact' | 'hash' | 'partial' | 'nullify';
}

interface CompiledRule {
  rule: ColumnMaskingRule;
  datasetRegex: RegExp;
  tableRegex: RegExp;
  columnRegex: RegExp;
}

// ==========================================
// Column Masking Engine
// ==========================================

export class ColumnMaskingEngine {
  private readonly config: MaskingConfig;
  private readonly compiledRules: CompiledRule[];

  constructor(config: MaskingConfig) {
    this.config = config;
    this.compiledRules = config.rules.map((rule) => ({
      rule,
      datasetRegex: this.globToRegex(rule.datasetPattern),
      tableRegex: this.globToRegex(rule.tablePattern),
      columnRegex: this.globToRegex(rule.columnPattern),
    }));

    logger.info('ColumnMaskingEngine initialized', {
      enabled: config.enabled,
      ruleCount: config.rules.length,
      defaultMaskType: config.defaultMaskType,
    });
  }

  /**
   * Mask a single row according to matching rules.
   */
  maskRow(
    row: Record<string, unknown>,
    datasetId: string,
    tableId: string,
    schema?: Array<{ name: string; type: string }>
  ): Record<string, unknown> {
    if (!this.config.enabled) {
      return row;
    }

    const applicableRules = this.getApplicableRules(datasetId, tableId);
    if (applicableRules.length === 0) {
      return row;
    }

    const masked = { ...row };
    const schemaMap = new Map(schema?.map((s) => [s.name, s.type]) ?? []);

    for (const columnName of Object.keys(masked)) {
      const matchingRule = this.findMatchingRule(applicableRules, columnName);
      if (matchingRule) {
        const columnType = schemaMap.get(columnName);
        masked[columnName] = this.applyMask(masked[columnName], matchingRule.maskType, columnType);
      }
    }

    return masked;
  }

  /**
   * Mask multiple rows. Convenience wrapper around maskRow.
   */
  maskRows(
    rows: Record<string, unknown>[],
    datasetId: string,
    tableId: string,
    schema?: Array<{ name: string; type: string }>
  ): Record<string, unknown>[] {
    if (!this.config.enabled) {
      return rows;
    }

    return rows.map((row) => this.maskRow(row, datasetId, tableId, schema));
  }

  /**
   * Mask rows returned by an arbitrary query that may touch several tables.
   *
   * Rules from *every* referenced table are unioned before matching column
   * names. This deliberately over-masks: a join between a table with a rule on
   * `email` and one without still masks `email` in the output. Over-masking is
   * the safe failure direction, because the alternative — resolving each output
   * column back to its source table — is not possible without a full SQL
   * parser, and guessing wrong would leak the value the rule exists to protect.
   *
   * If no table references could be extracted from the query (`refs` empty) and
   * masking is enabled with at least one rule, every rule is applied by column
   * name alone, again to avoid leaking on an unparseable query.
   */
  maskQueryRows(
    rows: Record<string, unknown>[],
    refs: Array<{ datasetId: string; tableId: string }>,
    schema?: Array<{ name: string; type: string }>
  ): { rows: Record<string, unknown>[]; maskedColumns: string[] } {
    if (!this.config.enabled || this.compiledRules.length === 0 || rows.length === 0) {
      return { rows, maskedColumns: [] };
    }

    const applicable =
      refs.length > 0
        ? this.compiledRules.filter((cr) =>
            refs.some(
              (ref) => cr.datasetRegex.test(ref.datasetId) && cr.tableRegex.test(ref.tableId)
            )
          )
        : // Unparseable query: fall back to matching on column name alone.
          this.compiledRules;

    if (applicable.length === 0) {
      return { rows, maskedColumns: [] };
    }

    const schemaMap = new Map(schema?.map((s) => [s.name, s.type]) ?? []);
    const maskedColumns = new Set<string>();

    const maskedRows = rows.map((row) => {
      const masked = { ...row };
      for (const columnName of Object.keys(masked)) {
        const rule = applicable.find((cr) => cr.columnRegex.test(columnName))?.rule;
        if (rule) {
          masked[columnName] = this.applyMask(
            masked[columnName],
            rule.maskType,
            schemaMap.get(columnName)
          );
          maskedColumns.add(columnName);
        }
      }
      return masked;
    });

    if (maskedColumns.size > 0) {
      logger.info('Column masking applied to query result', {
        maskedColumns: Array.from(maskedColumns),
        rowCount: maskedRows.length,
        tableRefs: refs.length,
      });
    }

    return { rows: maskedRows, maskedColumns: Array.from(maskedColumns) };
  }

  /**
   * Get all rules that apply to a given dataset and table.
   */
  getApplicableRules(datasetId: string, tableId: string): ColumnMaskingRule[] {
    return this.compiledRules
      .filter((cr) => cr.datasetRegex.test(datasetId) && cr.tableRegex.test(tableId))
      .map((cr) => cr.rule);
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  /**
   * Find the first rule whose column pattern matches the given column name.
   */
  private findMatchingRule(
    applicableRules: ColumnMaskingRule[],
    columnName: string
  ): ColumnMaskingRule | null {
    for (const compiled of this.compiledRules) {
      if (applicableRules.includes(compiled.rule) && compiled.columnRegex.test(columnName)) {
        return compiled.rule;
      }
    }
    return null;
  }

  /**
   * Apply a mask to a value.
   */
  private applyMask(
    value: unknown,
    maskType: ColumnMaskingRule['maskType'],
    _columnType?: string
  ): unknown {
    if (value === null || value === undefined) {
      return value;
    }

    switch (maskType) {
      case 'redact':
        return '[REDACTED]';

      case 'hash':
        return this.hashValue(value);

      case 'partial':
        return this.partialMask(value);

      case 'nullify':
        return null;

      default:
        logger.warn('Unknown mask type, falling back to redact', { maskType });
        return '[REDACTED]';
    }
  }

  /**
   * SHA-256 hash the value for referential integrity preservation.
   */
  private hashValue(value: unknown): string {
    const str = typeof value === 'string' ? value : JSON.stringify(value);
    return crypto.createHash('sha256').update(str).digest('hex');
  }

  /**
   * Partial masking: show first/last characters.
   *
   * - Email: j***@email.com
   * - Numbers (card, SSN): ****1234
   * - General strings: first + *** + last char
   * - Short values (<4 chars): fully masked
   */
  private partialMask(value: unknown): string {
    const str = String(value);

    if (str.length < 4) {
      return '****';
    }

    // Email pattern
    const emailMatch = str.match(/^(.)(.*?)(@.+)$/);
    if (emailMatch) {
      return `${emailMatch[1]}***${emailMatch[3]}`;
    }

    // Numeric-like (credit card, SSN, phone, etc.)
    const digitsOnly = str.replace(/\D/g, '');
    if (digitsOnly.length >= 4 && digitsOnly.length === str.replace(/[\s-]/g, '').length) {
      const lastFour = digitsOnly.slice(-4);
      return `****${lastFour}`;
    }

    // General string: show first and last character
    return `${str[0]}${'*'.repeat(Math.min(str.length - 2, 8))}${str[str.length - 1]}`;
  }

  /**
   * Convert a simple glob pattern to a RegExp.
   * Converts `*` to `.*` and escapes other regex metacharacters.
   */
  private globToRegex(pattern: string): RegExp {
    const escaped = pattern
      .replace(/[.+^${}()|[\]\\]/g, '\\$&') // escape regex meta (except *)
      .replace(/\*/g, '.*'); // convert glob * to regex .*
    return new RegExp(`^${escaped}$`, 'i');
  }
}
