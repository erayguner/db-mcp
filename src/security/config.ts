import { SecurityConfig } from './middleware.js';

/**
 * Security Configuration Presets
 *
 * Provides environment-specific security configurations
 */

export const SecurityPresets = {
  /**
   * Development environment - relaxed for testing
   */
  development: {
    rateLimitEnabled: true,
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 1000, // More lenient for development
    maxQueryLength: 10000,
    maxDatasetNameLength: 100,
    maxTableNameLength: 100,
    promptInjectionDetection: true,
    toolValidationEnabled: true,
    securityLoggingEnabled: true,
    logSuspiciousActivity: true,
    suspiciousPatterns: [
      'ignore previous instructions',
      'disregard above',
      'system:',
      'DROP TABLE',
      'DELETE FROM',
      'UNION SELECT',
    ],
    sensitiveDataPatterns: ['password', 'api_key', 'secret', 'token', 'credit_card'],
  } as Partial<SecurityConfig>,

  /**
   * Staging environment - moderate security
   */
  staging: {
    rateLimitEnabled: true,
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 200,
    maxQueryLength: 10000,
    maxDatasetNameLength: 100,
    maxTableNameLength: 100,
    promptInjectionDetection: true,
    toolValidationEnabled: true,
    securityLoggingEnabled: true,
    logSuspiciousActivity: true,
  } as Partial<SecurityConfig>,

  /**
   * Production environment - strict security
   */
  production: {
    rateLimitEnabled: true,
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 100, // Stricter for production
    maxQueryLength: 10000,
    maxDatasetNameLength: 100,
    maxTableNameLength: 100,
    promptInjectionDetection: true,
    toolValidationEnabled: true,
    securityLoggingEnabled: true,
    logSuspiciousActivity: true,
    // Additional production-specific patterns
    suspiciousPatterns: [
      'ignore previous instructions',
      'disregard above',
      'forget everything',
      'new instructions:',
      'system:',
      'admin:',
      'override',
      'bypass security',
      'DROP TABLE',
      'DELETE FROM',
      'TRUNCATE',
      'ALTER TABLE',
      'CREATE USER',
      'GRANT ALL',
      'REVOKE',
      'INSERT INTO',
      'UPDATE SET',
      'EXEC',
      'EXECUTE',
      'xp_cmdshell',
      'sp_executesql',
    ],
    sensitiveDataPatterns: [
      'password',
      'passwd',
      'pwd',
      'secret',
      'api_key',
      'apikey',
      'token',
      'bearer',
      'private_key',
      'credit_card',
      'creditcard',
      'ccn',
      'ssn',
      'social_security',
      'tax_id',
      'taxpayer',
      'ein',
      'bank_account',
      'routing_number',
      'iban',
      'swift',
    ],
  } as Partial<SecurityConfig>,

  /**
   * Testing environment - minimal security for unit tests
   */
  test: {
    rateLimitEnabled: false,
    rateLimitWindowMs: 60000,
    rateLimitMaxRequests: 999999,
    maxQueryLength: 10000,
    maxDatasetNameLength: 100,
    maxTableNameLength: 100,
    promptInjectionDetection: false,
    toolValidationEnabled: false,
    securityLoggingEnabled: false,
    logSuspiciousActivity: false,
    suspiciousPatterns: ['ignore previous instructions', 'DROP TABLE'],
    sensitiveDataPatterns: ['password', 'api_key', 'credit_card'],
  } as Partial<SecurityConfig>,
};

/**
 * Get security configuration for environment
 */
export function getSecurityConfig(
  environment: 'development' | 'staging' | 'production' | 'test' = 'development',
  overrides: Partial<SecurityConfig> = {}
): Partial<SecurityConfig> {
  const preset = SecurityPresets[environment] || SecurityPresets.development;
  return { ...preset, ...overrides };
}

/**
 * Custom security policy builder
 */
export class SecurityPolicyBuilder {
  private config: Partial<SecurityConfig> = {};

  /**
   * Start with a preset
   */
  withPreset(environment: keyof typeof SecurityPresets): this {
    this.config = { ...SecurityPresets[environment] };
    return this;
  }

  /**
   * Enable/disable rate limiting
   */
  rateLimit(enabled: boolean, maxRequests?: number, windowMs?: number): this {
    this.config.rateLimitEnabled = enabled;
    if (maxRequests !== undefined) {
      this.config.rateLimitMaxRequests = maxRequests;
    }
    if (windowMs !== undefined) {
      this.config.rateLimitWindowMs = windowMs;
    }
    return this;
  }

  /**
   * Configure input validation limits
   */
  inputLimits(options: {
    maxQueryLength?: number;
    maxDatasetNameLength?: number;
    maxTableNameLength?: number;
  }): this {
    if (options.maxQueryLength !== undefined) {
      this.config.maxQueryLength = options.maxQueryLength;
    }
    if (options.maxDatasetNameLength !== undefined) {
      this.config.maxDatasetNameLength = options.maxDatasetNameLength;
    }
    if (options.maxTableNameLength !== undefined) {
      this.config.maxTableNameLength = options.maxTableNameLength;
    }
    return this;
  }

  /**
   * Enable/disable prompt injection detection
   */
  promptInjection(enabled: boolean, customPatterns?: string[]): this {
    this.config.promptInjectionDetection = enabled;
    if (customPatterns) {
      this.config.suspiciousPatterns = [
        ...(this.config.suspiciousPatterns || []),
        ...customPatterns,
      ];
    }
    return this;
  }

  /**
   * Add sensitive data patterns
   */
  sensitiveData(patterns: string[]): this {
    this.config.sensitiveDataPatterns = [...(this.config.sensitiveDataPatterns || []), ...patterns];
    return this;
  }

  /**
   * Enable/disable tool validation
   */
  toolValidation(enabled: boolean, allowedTools?: string[]): this {
    this.config.toolValidationEnabled = enabled;
    if (allowedTools) {
      this.config.allowedTools = allowedTools;
    }
    return this;
  }

  /**
   * Enable/disable security logging
   */
  logging(enabled: boolean, logSuspicious?: boolean): this {
    this.config.securityLoggingEnabled = enabled;
    if (logSuspicious !== undefined) {
      this.config.logSuspiciousActivity = logSuspicious;
    }
    return this;
  }

  /**
   * Build final configuration
   */
  build(): Partial<SecurityConfig> {
    return this.config;
  }
}

/**
 * Example usage:
 *
 * const config = new SecurityPolicyBuilder()
 *   .withPreset('production')
 *   .rateLimit(true, 50)
 *   .promptInjection(true, ['custom pattern'])
 *   .toolValidation(true, ['query_bigquery', 'list_datasets'])
 *   .build();
 */
