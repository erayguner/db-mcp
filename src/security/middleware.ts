import { z } from 'zod';
import { logger } from '../utils/logger.js';
import { recordError } from '../telemetry/metrics.js';
import { recordException, setSpanAttributes } from '../telemetry/tracing.js';

/**
 * Security Middleware for MCP Server
 *
 * Implements comprehensive security best practices:
 * - Data exposure prevention
 * - Prompt injection mitigation
 * - Input validation
 * - Rate limiting
 * - Access control
 * - Audit logging
 */

// ==========================================
// Security Configuration
// ==========================================

export const SecurityConfigSchema = z.object({
  // Rate limiting
  rateLimitEnabled: z.boolean().default(true),
  rateLimitWindowMs: z.number().default(60000), // 1 minute
  rateLimitMaxRequests: z.number().default(100),

  // Input validation
  maxQueryLength: z.number().default(10000), // 10KB
  maxDatasetNameLength: z.number().default(100),
  maxTableNameLength: z.number().default(100),

  // Prompt injection detection
  promptInjectionDetection: z.boolean().default(true),
  suspiciousPatterns: z.array(z.string()).default([
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
  ]),

  // Data exposure prevention
  sensitiveDataPatterns: z.array(z.string()).default([
    'password',
    'secret',
    'api_key',
    'token',
    'private_key',
    'credit_card',
    'ssn',
    'social_security',
  ]),

  // Tool validation
  toolValidationEnabled: z.boolean().default(true),
  allowedTools: z.array(z.string()).default([
    'query_bigquery',
    'execute_query', // alias
    'list_datasets',
    'list_tables',
    'get_table_schema',
  ]),

  // Logging
  securityLoggingEnabled: z.boolean().default(true),
  logSuspiciousActivity: z.boolean().default(true),
});

export type SecurityConfig = z.infer<typeof SecurityConfigSchema>;

// ==========================================
// Rate Limiting
// ==========================================

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

export class RateLimiter {
  private requests: Map<string, RateLimitEntry> = new Map();
  private config: SecurityConfig;

  constructor(config: SecurityConfig) {
    this.config = config;

    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60000);
  }

  /**
   * Check if request should be rate limited
   */
  checkRateLimit(identifier: string): { allowed: boolean; remaining: number } {
    if (!this.config.rateLimitEnabled) {
      return { allowed: true, remaining: this.config.rateLimitMaxRequests };
    }

    const now = Date.now();
    const entry = this.requests.get(identifier);

    // No entry or expired window - allow and create new entry
    if (!entry || now >= entry.resetTime) {
      this.requests.set(identifier, {
        count: 1,
        resetTime: now + this.config.rateLimitWindowMs,
      });
      return {
        allowed: true,
        remaining: this.config.rateLimitMaxRequests - 1,
      };
    }

    // Check if limit exceeded
    if (entry.count >= this.config.rateLimitMaxRequests) {
      logger.warn('Rate limit exceeded', {
        identifier,
        count: entry.count,
        limit: this.config.rateLimitMaxRequests,
      });
      recordError('rate_limit_exceeded');
      return { allowed: false, remaining: 0 };
    }

    // Increment count
    entry.count++;
    return {
      allowed: true,
      remaining: this.config.rateLimitMaxRequests - entry.count,
    };
  }

  /**
   * Cleanup expired entries
   */
  private cleanup() {
    const now = Date.now();
    for (const [key, entry] of this.requests.entries()) {
      if (now >= entry.resetTime) {
        this.requests.delete(key);
      }
    }
  }

  /**
   * Reset rate limit for identifier
   */
  reset(identifier: string) {
    this.requests.delete(identifier);
  }
}

// ==========================================
// Prompt Injection Detection
// ==========================================

export class PromptInjectionDetector {
  private config: SecurityConfig;

  constructor(config: SecurityConfig) {
    this.config = config;
  }

  /**
   * Detect potential prompt injection attempts
   */
  detect(input: string): { detected: boolean; matches: string[] } {
    if (!this.config.promptInjectionDetection) {
      return { detected: false, matches: [] };
    }

    const normalizedInput = input.toLowerCase();
    const matches: string[] = [];

    for (const pattern of this.config.suspiciousPatterns) {
      if (normalizedInput.includes(pattern.toLowerCase())) {
        matches.push(pattern);
      }
    }

    if (matches.length > 0) {
      logger.warn('Prompt injection detected', {
        input: input.substring(0, 100) + '...',
        matches,
      });
      recordError('prompt_injection_detected');
      setSpanAttributes({
        'security.prompt_injection': true,
        'security.matches': matches.length,
      });
    }

    return {
      detected: matches.length > 0,
      matches,
    };
  }

  /**
   * Sanitize input by removing suspicious patterns
   */
  sanitize(input: string): string {
    let sanitized = input;

    for (const pattern of this.config.suspiciousPatterns) {
      const regex = new RegExp(pattern, 'gi');
      sanitized = sanitized.replace(regex, '[REDACTED]');
    }

    return sanitized;
  }
}

// ==========================================
// Input Validation
// ==========================================

export class InputValidator {
  private config: SecurityConfig;

  constructor(config: SecurityConfig) {
    this.config = config;
  }

  /**
   * Validate SQL query input
   */
  validateQuery(query: string): { valid: boolean; error?: string } {
    // Length check
    if (query.length > this.config.maxQueryLength) {
      logger.warn('Query too long', { length: query.length });
      recordError('query_too_long');
      return {
        valid: false,
        error: `Query exceeds maximum length of ${this.config.maxQueryLength} characters`,
      };
    }

    // SQL injection patterns (basic)
    const dangerousPatterns = [
      /;\s*DROP\s+/i,
      /^\s*DROP\s+/i,
      /;\s*DELETE\s+/i,
      /^\s*DELETE\s+/i,
      /;\s*TRUNCATE\s+/i,
      /^\s*TRUNCATE\s+/i,
      /;\s*ALTER\s+/i,
      /^\s*ALTER\s+/i,
      /;\s*CREATE\s+USER/i,
      /^\s*CREATE\s+USER/i,
      /;\s*GRANT\s+/i,
      /^\s*GRANT\s+/i,
      /UNION\s+SELECT/i,
      /--\s*$/,
      /\/\*.*\*\//,
    ];

    for (const pattern of dangerousPatterns) {
      if (pattern.test(query)) {
        logger.warn('Dangerous SQL pattern detected', {
          pattern: pattern.source,
          query: query.substring(0, 100),
        });
        recordError('dangerous_sql_pattern');
        return {
          valid: false,
          error: 'Query contains potentially dangerous SQL patterns',
        };
      }
    }

    return { valid: true };
  }

  /**
   * Validate dataset ID
   */
  validateDatasetId(datasetId: string): { valid: boolean; error?: string } {
    if (datasetId.length > this.config.maxDatasetNameLength) {
      return {
        valid: false,
        error: `Dataset ID exceeds maximum length of ${this.config.maxDatasetNameLength}`,
      };
    }

    // Only allow alphanumeric, underscore, and hyphen
    if (!/^[a-zA-Z0-9_-]+$/.test(datasetId)) {
      return {
        valid: false,
        error: 'Dataset ID contains invalid characters',
      };
    }

    return { valid: true };
  }

  /**
   * Validate table ID
   */
  validateTableId(tableId: string): { valid: boolean; error?: string } {
    if (tableId.length > this.config.maxTableNameLength) {
      return {
        valid: false,
        error: `Table ID exceeds maximum length of ${this.config.maxTableNameLength}`,
      };
    }

    // Only allow alphanumeric, underscore, and hyphen
    if (!/^[a-zA-Z0-9_-]+$/.test(tableId)) {
      return {
        valid: false,
        error: 'Table ID contains invalid characters',
      };
    }

    return { valid: true };
  }
}

// ==========================================
// Sensitive Data Detection
// ==========================================

export class SensitiveDataDetector {
  private config: SecurityConfig;

  constructor(config: SecurityConfig) {
    this.config = config;
  }

  /**
   * Check if data contains sensitive information
   */
  detectSensitiveData(data: unknown): { detected: boolean; fields: string[] } {
    const sensitiveFields: string[] = [];

    const checkObject = (obj: unknown, path: string = '') => {
      if (typeof obj !== 'object' || obj === null) {
        return;
      }

      for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
        const fullPath = path ? `${path}.${key}` : key;
        const keyLower = key.toLowerCase();

        // Check field names
        for (const pattern of this.config.sensitiveDataPatterns) {
          if (keyLower.includes(pattern.toLowerCase())) {
            sensitiveFields.push(fullPath);
            break;
          }
        }

        // Recursively check nested objects
        if (typeof value === 'object' && value !== null) {
          checkObject(value, fullPath);
        }
      }
    };

    checkObject(data);

    if (sensitiveFields.length > 0) {
      logger.warn('Sensitive data detected', {
        fields: sensitiveFields,
      });
      recordError('sensitive_data_detected');
    }

    return {
      detected: sensitiveFields.length > 0,
      fields: sensitiveFields,
    };
  }

  /**
   * Redact sensitive fields from data
   */
  redactSensitiveData(data: unknown): unknown {
    if (typeof data !== 'object' || data === null) {
      return data;
    }

    if (Array.isArray(data)) {
      const redacted = (data as unknown[]).slice();
      return redacted.map(item => this.redactSensitiveData(item));
    }

    const redacted: Record<string, unknown> = { ...(data as Record<string, unknown>) };

    for (const [key, value] of Object.entries(redacted)) {
      const keyLower = key.toLowerCase();

      // Check if field name matches sensitive patterns
      let isSensitive = false;
      for (const pattern of this.config.sensitiveDataPatterns) {
        if (keyLower.includes(pattern.toLowerCase())) {
          isSensitive = true;
          break;
        }
      }

      if (isSensitive) {
        redacted[key] = '[REDACTED]';
      } else if (typeof value === 'object' && value !== null) {
        redacted[key] = this.redactSensitiveData(value);
      }
    }

    return redacted;
  }
}

// ==========================================
// Tool Validation
// ==========================================

export class ToolValidator {
  private config: SecurityConfig;
  private toolDescriptions: Map<string, string> = new Map();

  constructor(config: SecurityConfig) {
    this.config = config;
  }

  /**
   * Register tool description (for change detection)
   */
  registerTool(toolName: string, description: string) {
    this.toolDescriptions.set(toolName, description);
  }

  /**
   * Validate tool request
   */
  validateToolRequest(toolName: string): { valid: boolean; error?: string } {
    if (!this.config.toolValidationEnabled) {
      return { valid: true };
    }

    // Check if tool is in allowed list
    if (!this.config.allowedTools.includes(toolName)) {
      logger.warn('Unauthorized tool request', { toolName });
      recordError('unauthorized_tool');
      return {
        valid: false,
        error: `Tool '${toolName}' is not authorized`,
      };
    }

    return { valid: true };
  }

  /**
   * Detect tool description changes (rug pull prevention)
   */
  detectToolChange(toolName: string, newDescription: string): boolean {
    const oldDescription = this.toolDescriptions.get(toolName);

    if (!oldDescription) {
      // First time seeing this tool
      this.toolDescriptions.set(toolName, newDescription);
      return false;
    }

    if (oldDescription !== newDescription) {
      logger.error('Tool description changed', {
        toolName,
        oldDescription,
        newDescription,
      });
      recordError('tool_description_changed');
      // Update to new description after detecting change
      this.toolDescriptions.set(toolName, newDescription);
      return true;
    }

    return false;
  }
}

// ==========================================
// Security Audit Logger
// ==========================================

export interface SecurityEvent {
  timestamp: Date;
  type: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  userId?: string;
  toolName?: string;
  details: Record<string, unknown>;
}

export class SecurityAuditLogger {
  private config: SecurityConfig;
  private events: SecurityEvent[] = [];
  private maxEvents = 10000;

  constructor(config: SecurityConfig) {
    this.config = config;
  }

  /**
   * Log security event
   */
  logEvent(event: Omit<SecurityEvent, 'timestamp'>) {
    if (!this.config.securityLoggingEnabled) {
      return;
    }

    const fullEvent: SecurityEvent = {
      timestamp: new Date(),
      ...event,
    };

    this.events.push(fullEvent);

    // Trim old events
    if (this.events.length > this.maxEvents) {
      this.events = this.events.slice(-this.maxEvents);
    }

    // Log to Cloud Logging
    const logMethod = event.severity === 'critical' || event.severity === 'high'
      ? logger.error
      : event.severity === 'medium'
      ? logger.warn
      : logger.info;

    logMethod('Security event', {
      securityEvent: true,
      ...fullEvent,
    });

    // Record metric
    recordError(`security_${event.type}`);
  }

  /**
   * Get recent security events
   */
  getRecentEvents(count: number = 100): SecurityEvent[] {
    return this.events.slice(-count);
  }

  /**
   * Get events by severity
   */
  getEventsBySeverity(severity: SecurityEvent['severity']): SecurityEvent[] {
    return this.events.filter((e) => e.severity === severity);
  }
}

// ==========================================
// Main Security Middleware
// ==========================================

export class SecurityMiddleware {
  private config: SecurityConfig;
  private rateLimiter: RateLimiter;
  private promptDetector: PromptInjectionDetector;
  private inputValidator: InputValidator;
  private sensitiveDetector: SensitiveDataDetector;
  private toolValidator: ToolValidator;
  private auditLogger: SecurityAuditLogger;

  constructor(config: Partial<SecurityConfig> = {}) {
    this.config = SecurityConfigSchema.parse(config);
    this.rateLimiter = new RateLimiter(this.config);
    this.promptDetector = new PromptInjectionDetector(this.config);
    this.inputValidator = new InputValidator(this.config);
    this.sensitiveDetector = new SensitiveDataDetector(this.config);
    this.toolValidator = new ToolValidator(this.config);
    this.auditLogger = new SecurityAuditLogger(this.config);

    logger.info('Security middleware initialized', {
      rateLimitEnabled: this.config.rateLimitEnabled,
      promptInjectionDetection: this.config.promptInjectionDetection,
      toolValidationEnabled: this.config.toolValidationEnabled,
    });
  }

  /**
   * Get configuration
   */
  getConfig(): SecurityConfig {
    return this.config;
  }

  /**
   * Get individual components
   */
  getRateLimiter(): RateLimiter {
    return this.rateLimiter;
  }

  getPromptDetector(): PromptInjectionDetector {
    return this.promptDetector;
  }

  getInputValidator(): InputValidator {
    return this.inputValidator;
  }

  getSensitiveDetector(): SensitiveDataDetector {
    return this.sensitiveDetector;
  }

  getToolValidator(): ToolValidator {
    return this.toolValidator;
  }

  getAuditLogger(): SecurityAuditLogger {
    return this.auditLogger;
  }

  /**
   * Validate MCP request (main entry point)
   */
  validateRequest(params: {
    toolName: string;
    userId?: string;
    arguments?: unknown;
  }): { allowed: boolean; error?: string; warnings?: string[] } {
    const warnings: string[] = [];

    try {
      // Rate limiting
      const identifier = params.userId || 'anonymous';
      const rateLimit = this.rateLimiter.checkRateLimit(identifier);
      if (!rateLimit.allowed) {
        this.auditLogger.logEvent({
          type: 'rate_limit_exceeded',
          severity: 'medium',
          userId: params.userId,
          toolName: params.toolName,
          details: {},
        });
        return {
          allowed: false,
          error: 'Rate limit exceeded. Please try again later.',
        };
      }

      // Tool validation
      const toolValidation = this.toolValidator.validateToolRequest(params.toolName);
      if (!toolValidation.valid) {
        this.auditLogger.logEvent({
          type: 'unauthorized_tool',
          severity: 'high',
          userId: params.userId,
          toolName: params.toolName,
          details: {},
        });
        return {
          allowed: false,
          error: toolValidation.error,
        };
      }

      // Input validation based on tool type
      const args = params.arguments as { query?: string; datasetId?: string; tableId?: string } | undefined;

      if (params.toolName === 'query_bigquery' && args?.query) {
        const queryValidation = this.inputValidator.validateQuery(args.query);
        if (!queryValidation.valid) {
          this.auditLogger.logEvent({
            type: 'invalid_query',
            severity: 'high',
            userId: params.userId,
            toolName: params.toolName,
            details: { error: queryValidation.error },
          });
          return {
            allowed: false,
            error: queryValidation.error,
          };
        }

        // Prompt injection detection
        const injectionCheck = this.promptDetector.detect(args.query);
        if (injectionCheck.detected) {
          this.auditLogger.logEvent({
            type: 'prompt_injection',
            severity: 'critical',
            userId: params.userId,
            toolName: params.toolName,
            details: { matches: injectionCheck.matches },
          });
          return {
            allowed: false,
            error: 'Potential prompt injection detected. Request blocked.',
          };
        }
      }

      if (params.toolName === 'list_tables' && args?.datasetId) {
        const datasetValidation = this.inputValidator.validateDatasetId(args.datasetId);
        if (!datasetValidation.valid) {
          return {
            allowed: false,
            error: datasetValidation.error,
          };
        }
      }

      if (params.toolName === 'get_table_schema') {
        if (args?.datasetId) {
          const datasetValidation = this.inputValidator.validateDatasetId(args.datasetId);
          if (!datasetValidation.valid) {
            return { allowed: false, error: datasetValidation.error };
          }
        }
        if (args?.tableId) {
          const tableValidation = this.inputValidator.validateTableId(args.tableId);
          if (!tableValidation.valid) {
            return { allowed: false, error: tableValidation.error };
          }
        }
      }

      // Log successful validation
      this.auditLogger.logEvent({
        type: 'request_validated',
        severity: 'low',
        userId: params.userId,
        toolName: params.toolName,
        details: {},
      });

      return {
        allowed: true,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    } catch (error) {
      logger.error('Security validation error', { error });
      recordException(error as Error);
      return {
        allowed: false,
        error: 'Security validation failed',
      };
    }
  }

  /**
   * Validate response data
   */
  validateResponse(data: unknown): { allowed: boolean; redacted?: unknown; warnings?: string[] } {
    const warnings: string[] = [];

    try {
      // Check for sensitive data
      const sensitiveCheck = this.sensitiveDetector.detectSensitiveData(data);
      if (sensitiveCheck.detected) {
        warnings.push(`Sensitive data detected in fields: ${sensitiveCheck.fields.join(', ')}`);

        this.auditLogger.logEvent({
          type: 'sensitive_data_detected',
          severity: 'high',
          details: { fields: sensitiveCheck.fields },
        });

        // Redact sensitive data
        const redacted = this.sensitiveDetector.redactSensitiveData(data);
        return {
          allowed: true,
          redacted,
          warnings,
        };
      }

      return { allowed: true };
    } catch (error) {
      logger.error('Response validation error', { error });
      return { allowed: true }; // Allow response but log error
    }
  }
}
