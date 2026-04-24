# Error Handling Strategy

## Overview

The BigQuery MCP Server implements comprehensive error handling with automatic retry, graceful degradation, and detailed
error reporting to ensure reliability and debuggability.

## Error Classification

### 1. Transient Errors (Retry-able)

**Network Errors**

- `ECONNRESET`: Connection reset by peer
- `ETIMEDOUT`: Request timeout
- `ECONNREFUSED`: Connection refused
- `ENETUNREACH`: Network unreachable

**BigQuery Errors**

- `503 Service Unavailable`: Temporary BigQuery outage
- `429 Too Many Requests`: Rate limiting
- `500 Internal Server Error`: Temporary server error
- `409 Conflict`: Concurrent modification (for DDL)

**Authentication Errors**

- `401 Unauthorized`: Token expired (refresh and retry)
- `403 Forbidden` (transient): Temporary IAM propagation delay

**Action**: Retry with exponential backoff

### 2. Permanent Errors (Non-retry-able)

**Client Errors**

- `400 Bad Request`: Invalid SQL syntax
- `403 Forbidden` (persistent): Missing IAM permissions
- `404 Not Found`: Dataset or table doesn't exist
- `413 Payload Too Large`: Query too long

**Authorization Errors**

- `403 Forbidden`: Insufficient permissions
- `401 Unauthorized` (persistent): Invalid credentials

**Resource Errors**

- `404 Not Found`: Resource doesn't exist
- `410 Gone`: Resource deleted

**Validation Errors**

- SQL injection detected
- Invalid parameter format
- Schema mismatch

**Action**: Fail immediately with descriptive error

### 3. Degraded State Errors

**Partial Failures**

- Query succeeded but pagination failed
- Metrics export failed
- Cache write failed

**Action**: Return result with warning

## Retry Strategy

### Exponential Backoff with Jitter

```typescript
class RetryStrategy {
  private readonly config = {
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 32000,
    exponentialBase: 2,
    jitterFactor: 0.1,
  };

  async executeWithRetry<T>(operation: () => Promise<T>, context: RetryContext): Promise<T> {
    let lastError: Error;
    let attempt = 0;

    while (attempt < this.config.maxAttempts) {
      try {
        attempt++;

        // Execute operation
        const result = await operation();

        // Log success if retried
        if (attempt > 1) {
          logger.info('Operation succeeded after retry', {
            operation: context.operationName,
            attempts: attempt,
          });
        }

        return result;
      } catch (error) {
        lastError = error;

        // Check if error is retryable
        if (!this.isRetryable(error)) {
          throw error;
        }

        // Check if we have attempts left
        if (attempt >= this.config.maxAttempts) {
          throw new MaxRetriesExceededError(`Operation failed after ${attempt} attempts`, lastError);
        }

        // Calculate delay with exponential backoff and jitter
        const delay = this.calculateDelay(attempt);

        logger.warn('Operation failed, retrying', {
          operation: context.operationName,
          attempt,
          maxAttempts: this.config.maxAttempts,
          error: error.message,
          retryAfter: delay,
        });

        // Wait before retry
        await this.sleep(delay);
      }
    }

    throw lastError!;
  }

  private calculateDelay(attempt: number): number {
    // Exponential backoff: baseDelay * (exponentialBase ^ attempt)
    const exponentialDelay = this.config.baseDelayMs * Math.pow(this.config.exponentialBase, attempt - 1);

    // Cap at max delay
    const cappedDelay = Math.min(exponentialDelay, this.config.maxDelayMs);

    // Add jitter to avoid thundering herd
    const jitter = cappedDelay * this.config.jitterFactor * Math.random();

    return Math.floor(cappedDelay + jitter);
  }

  private isRetryable(error: any): boolean {
    // Network errors
    if (error.code in ['ECONNRESET', 'ETIMEDOUT', 'ECONNREFUSED', 'ENETUNREACH']) {
      return true;
    }

    // HTTP status codes
    if (error.status) {
      const retryableStatuses = [408, 429, 500, 502, 503, 504];
      return retryableStatuses.includes(error.status);
    }

    // BigQuery specific errors
    if (error.name === 'BigQueryError') {
      return error.code in ['rateLimitExceeded', 'backendError', 'serviceUnavailable'];
    }

    // Token expiration
    if (error.code === 'auth/token-expired') {
      return true;
    }

    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
```

### Retry Configuration by Operation

```typescript
const retryConfigs: Record<string, RetryConfig> = {
  // Query operations: aggressive retry
  query_execute: {
    maxAttempts: 5,
    baseDelayMs: 1000,
    maxDelayMs: 32000,
  },

  // Schema operations: moderate retry (cached)
  schema_list: {
    maxAttempts: 3,
    baseDelayMs: 500,
    maxDelayMs: 8000,
  },

  // Auth operations: quick retry
  auth_token: {
    maxAttempts: 3,
    baseDelayMs: 200,
    maxDelayMs: 2000,
  },

  // Write operations: minimal retry
  table_insert: {
    maxAttempts: 2,
    baseDelayMs: 1000,
    maxDelayMs: 5000,
  },
};
```

## Circuit Breaker Pattern

```typescript
class CircuitBreaker {
  private state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';
  private failureCount = 0;
  private lastFailureTime?: Date;

  private readonly config = {
    failureThreshold: 5, // Open after 5 failures
    resetTimeout: 60000, // Try closing after 60s
    halfOpenSuccessThreshold: 2, // Close after 2 successes
  };

  async execute<T>(operation: () => Promise<T>): Promise<T> {
    // Check circuit state
    if (this.state === 'OPEN') {
      if (this.shouldAttemptReset()) {
        this.state = 'HALF_OPEN';
        logger.info('Circuit breaker entering half-open state');
      } else {
        throw new CircuitOpenError('Circuit breaker is OPEN', this.lastFailureTime);
      }
    }

    try {
      const result = await operation();

      // Success - update state
      this.onSuccess();

      return result;
    } catch (error) {
      // Failure - update state
      this.onFailure();

      throw error;
    }
  }

  private onSuccess(): void {
    if (this.state === 'HALF_OPEN') {
      logger.info('Circuit breaker closing after successful request');
      this.state = 'CLOSED';
      this.failureCount = 0;
    }
  }

  private onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = new Date();

    if (this.failureCount >= this.config.failureThreshold) {
      logger.error('Circuit breaker opening due to failures', {
        failureCount: this.failureCount,
        threshold: this.config.failureThreshold,
      });
      this.state = 'OPEN';
    }
  }

  private shouldAttemptReset(): boolean {
    if (!this.lastFailureTime) {
      return false;
    }

    const timeSinceLastFailure = Date.now() - this.lastFailureTime.getTime();
    return timeSinceLastFailure >= this.config.resetTimeout;
  }

  getState(): { state: string; failureCount: number } {
    return {
      state: this.state,
      failureCount: this.failureCount,
    };
  }
}
```

## Error Response Format

### MCP Error Response

```typescript
interface MCPError {
  code: ErrorCode;
  message: string;
  details?: {
    reason?: string;
    location?: string;
    debugInfo?: any;
    helpUrl?: string;
  };
  retryable: boolean;
}

enum ErrorCode {
  // Client errors (4xx)
  INVALID_ARGUMENT = 'INVALID_ARGUMENT',
  UNAUTHENTICATED = 'UNAUTHENTICATED',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  NOT_FOUND = 'NOT_FOUND',
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',

  // Server errors (5xx)
  INTERNAL = 'INTERNAL',
  UNAVAILABLE = 'UNAVAILABLE',
  DEADLINE_EXCEEDED = 'DEADLINE_EXCEEDED',

  // Application errors
  QUERY_ERROR = 'QUERY_ERROR',
  SCHEMA_ERROR = 'SCHEMA_ERROR',
  AUTH_ERROR = 'AUTH_ERROR',
}

class ErrorFormatter {
  formatError(error: Error, context: ErrorContext): MCPError {
    // BigQuery errors
    if (error instanceof BigQueryError) {
      return this.formatBigQueryError(error, context);
    }

    // Auth errors
    if (error instanceof AuthError) {
      return this.formatAuthError(error, context);
    }

    // Validation errors
    if (error instanceof ValidationError) {
      return this.formatValidationError(error, context);
    }

    // Generic errors
    return {
      code: ErrorCode.INTERNAL,
      message: 'An unexpected error occurred',
      details: {
        debugInfo: process.env.NODE_ENV === 'development' ? error.stack : undefined,
        helpUrl: 'https://docs.example.com/errors/internal',
      },
      retryable: false,
    };
  }

  private formatBigQueryError(error: BigQueryError, context: ErrorContext): MCPError {
    const errorMap: Record<string, { code: ErrorCode; retryable: boolean }> = {
      invalidQuery: {
        code: ErrorCode.INVALID_ARGUMENT,
        retryable: false,
      },
      notFound: {
        code: ErrorCode.NOT_FOUND,
        retryable: false,
      },
      rateLimitExceeded: {
        code: ErrorCode.RESOURCE_EXHAUSTED,
        retryable: true,
      },
      backendError: {
        code: ErrorCode.UNAVAILABLE,
        retryable: true,
      },
    };

    const mapping = errorMap[error.code] || {
      code: ErrorCode.INTERNAL,
      retryable: false,
    };

    return {
      code: mapping.code,
      message: error.message,
      details: {
        reason: error.code,
        location: error.location,
        debugInfo: {
          query: context.query?.substring(0, 200), // Truncate for privacy
          jobId: context.jobId,
        },
        helpUrl: `https://cloud.google.com/bigquery/docs/error-messages#${error.code}`,
      },
      retryable: mapping.retryable,
    };
  }

  private formatAuthError(error: AuthError, context: ErrorContext): MCPError {
    return {
      code: error.code === 'token-expired' ? ErrorCode.UNAUTHENTICATED : ErrorCode.PERMISSION_DENIED,
      message: 'Authentication failed',
      details: {
        reason: error.code,
        helpUrl: 'https://docs.example.com/auth/troubleshooting',
      },
      retryable: error.code === 'token-expired',
    };
  }

  private formatValidationError(error: ValidationError, context: ErrorContext): MCPError {
    return {
      code: ErrorCode.INVALID_ARGUMENT,
      message: error.message,
      details: {
        reason: error.field,
        location: error.location,
        helpUrl: 'https://docs.example.com/validation',
      },
      retryable: false,
    };
  }
}
```

## Error Logging

### Structured Error Logging

```typescript
class ErrorLogger {
  logError(error: Error, context: ErrorContext): void {
    const severity = this.getErrorSeverity(error);

    const logEntry = {
      timestamp: new Date().toISOString(),
      severity,
      error: {
        name: error.name,
        message: error.message,
        stack: error.stack,
        code: (error as any).code,
      },
      context: {
        operation: context.operation,
        requestId: context.requestId,
        principal: context.principal,
        resource: context.resource,
      },
      metadata: {
        ...context.metadata,
        retryable: this.isRetryable(error),
        clientVisible: !this.isSensitive(error),
      },
    };

    // Log to appropriate destination
    switch (severity) {
      case 'ERROR':
      case 'CRITICAL':
        logger.error(logEntry);
        // Send to error tracking service
        this.sendToErrorTracking(logEntry);
        break;

      case 'WARNING':
        logger.warn(logEntry);
        break;

      default:
        logger.info(logEntry);
    }

    // Record metric
    this.recordErrorMetric(error, context);
  }

  private getErrorSeverity(error: Error): string {
    // Critical: Auth failures, permission denials
    if (error instanceof AuthError || error instanceof PermissionError) {
      return 'CRITICAL';
    }

    // Error: Unexpected failures, internal errors
    if (error instanceof InternalError) {
      return 'ERROR';
    }

    // Warning: Client errors, validation failures
    if (error instanceof ValidationError || error instanceof NotFoundError) {
      return 'WARNING';
    }

    return 'INFO';
  }

  private isSensitive(error: Error): boolean {
    // Don't expose sensitive errors to clients
    return (
      error instanceof AuthError ||
      error instanceof InternalError ||
      error.message.includes('credential') ||
      error.message.includes('token')
    );
  }

  private async sendToErrorTracking(logEntry: any): Promise<void> {
    // Send to error tracking service (e.g., Sentry, Error Reporting)
    try {
      await errorTrackingClient.report({
        error: logEntry.error,
        context: logEntry.context,
        severity: logEntry.severity,
        fingerprint: this.generateFingerprint(logEntry),
      });
    } catch (err) {
      // Don't let error tracking failures affect main flow
      logger.error('Failed to send error to tracking service', { err });
    }
  }

  private generateFingerprint(logEntry: any): string {
    // Group similar errors together
    return `${logEntry.error.name}:${logEntry.context.operation}:${logEntry.error.code}`;
  }

  private recordErrorMetric(error: Error, context: ErrorContext): void {
    errorCounter.add(1, {
      error_type: error.name,
      error_code: (error as any).code || 'unknown',
      operation: context.operation,
      retryable: this.isRetryable(error).toString(),
    });
  }
}
```

## Graceful Degradation

### Fallback Strategies

```typescript
class GracefulDegradation {
  async executeWithFallback<T>(primary: () => Promise<T>, fallback: () => Promise<T>, context: string): Promise<T> {
    try {
      return await primary();
    } catch (error) {
      logger.warn(`Primary operation failed, using fallback`, {
        context,
        error: error.message,
      });

      try {
        return await fallback();
      } catch (fallbackError) {
        logger.error(`Fallback also failed`, {
          context,
          primaryError: error.message,
          fallbackError: fallbackError.message,
        });
        throw error; // Throw original error
      }
    }
  }

  // Example: Schema with cache fallback
  async getTableSchema(datasetId: string, tableId: string): Promise<TableSchema> {
    return this.executeWithFallback(
      // Primary: Fetch from BigQuery
      () => this.bigqueryClient.getTableSchema(datasetId, tableId),

      // Fallback: Return cached schema (even if expired)
      async () => {
        const cached = await this.cache.get(`schema:${datasetId}.${tableId}`, {
          ignoreExpiry: true,
        });

        if (!cached) {
          throw new Error('No cached schema available');
        }

        logger.info('Returning stale cached schema', {
          datasetId,
          tableId,
          cacheAge: cached.age,
        });

        return {
          ...cached.value,
          _stale: true,
          _cacheAge: cached.age,
        };
      },

      `getTableSchema:${datasetId}.${tableId}`
    );
  }

  // Example: Query with partial results
  async executeQuery(query: string, options: QueryOptions): Promise<QueryResult> {
    try {
      return await this.queryService.execute(query, options);
    } catch (error) {
      // If pagination failed but we have some results, return them
      if (error instanceof PaginationError && error.partialResults) {
        logger.warn('Returning partial query results', {
          totalRows: error.partialResults.length,
          error: error.message,
        });

        return {
          rows: error.partialResults,
          schema: error.schema,
          incomplete: true,
          warning: 'Result set may be incomplete due to pagination failure',
        };
      }

      throw error;
    }
  }
}
```

## Timeout Management

```typescript
class TimeoutManager {
  async executeWithTimeout<T>(operation: () => Promise<T>, timeoutMs: number, operationName: string): Promise<T> {
    return Promise.race([operation(), this.createTimeout(timeoutMs, operationName)]);
  }

  private createTimeout(timeoutMs: number, operationName: string): Promise<never> {
    return new Promise((_, reject) => {
      setTimeout(() => {
        reject(new TimeoutError(`Operation ${operationName} exceeded timeout of ${timeoutMs}ms`));
      }, timeoutMs);
    });
  }

  // Timeout with cleanup
  async executeWithTimeoutAndCleanup<T>(
    operation: (signal: AbortSignal) => Promise<T>,
    timeoutMs: number,
    operationName: string
  ): Promise<T> {
    const controller = new AbortController();

    try {
      return await Promise.race([operation(controller.signal), this.createTimeout(timeoutMs, operationName)]);
    } catch (error) {
      // Abort operation on timeout
      controller.abort();
      throw error;
    }
  }
}

// Example usage with BigQuery
async function executeQueryWithTimeout(query: string, timeoutMs: number): Promise<QueryResult> {
  const timeout = new TimeoutManager();

  return timeout.executeWithTimeoutAndCleanup(
    async (signal) => {
      // Submit query job
      const job = await bigquery.createQueryJob({ query });

      // Poll for completion with abort signal
      while (!signal.aborted) {
        const [metadata] = await job.getMetadata();

        if (metadata.status.state === 'DONE') {
          return job.getQueryResults();
        }

        await sleep(500);
      }

      // Cleanup: Cancel job if aborted
      await job.cancel();
      throw new Error('Query cancelled due to timeout');
    },
    timeoutMs,
    'bigquery_query'
  );
}
```

## Error Recovery Workflows

### Self-Healing

```typescript
class SelfHealing {
  async recoverFromAuthFailure(): Promise<void> {
    logger.info('Attempting auth recovery');

    // 1. Clear token cache
    this.tokenManager.clearCache();

    // 2. Re-acquire credentials
    try {
      await this.authManager.authenticate();
      logger.info('Auth recovery successful');
    } catch (error) {
      logger.error('Auth recovery failed', { error });
      throw new FatalError('Unable to recover from auth failure');
    }
  }

  async recoverFromConnectionFailure(): Promise<void> {
    logger.info('Attempting connection recovery');

    // 1. Reset connection pool
    await this.bigqueryClient.closeConnections();

    // 2. Wait for backoff
    await sleep(5000);

    // 3. Re-establish connection
    try {
      await this.bigqueryClient.testConnection();
      logger.info('Connection recovery successful');
    } catch (error) {
      logger.error('Connection recovery failed', { error });
      throw new FatalError('Unable to recover from connection failure');
    }
  }
}
```

## Next Steps

See [Observability Design](./06-observability.md) for monitoring and debugging strategies.
