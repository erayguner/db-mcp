import { QueryCache } from './query-cache.js';
import { logger } from '../utils/logger.js';

/**
 * Graceful Degradation Handler with Circuit Breaker
 *
 * Wraps BigQuery query execution with resilience patterns:
 * - Circuit breaker (closed -> open -> half-open -> closed)
 * - Stale cache fallback when BigQuery is unavailable
 * - Degradation notices when no cache is available
 *
 * Circuit states:
 * - closed:    Normal operation, requests pass through
 * - open:      BigQuery is down, serve from stale cache or fallback
 * - half-open: Testing if BigQuery has recovered (single probe request)
 */

// ==========================================
// Types & Interfaces
// ==========================================

export interface DegradationConfig {
  enabled: boolean;
  staleCacheMaxAgeMs: number;       // max age for stale cache to serve (default 30min)
  circuitBreakerThreshold: number;  // failures before opening circuit (default 5)
  circuitBreakerResetMs: number;    // time before half-open (default 60s)
  fallbackMessage: string;
}

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface DegradationResult<T> {
  result: T;
  degraded: boolean;
  source: 'live' | 'stale-cache' | 'fallback';
}

export interface DegradationStats {
  state: CircuitState;
  failures: number;
  lastFailure: Date | null;
  fallbacksServed: number;
  staleCacheHits: number;
}

// ==========================================
// Graceful Degradation Handler
// ==========================================

export class GracefulDegradationHandler {
  private readonly config: DegradationConfig;
  private state: CircuitState = 'closed';
  private consecutiveFailures = 0;
  private lastFailureTime: number | null = null;
  private fallbacksServed = 0;
  private staleCacheHits = 0;

  constructor(config?: Partial<DegradationConfig>) {
    this.config = {
      enabled: config?.enabled ?? true,
      staleCacheMaxAgeMs: config?.staleCacheMaxAgeMs ?? 30 * 60 * 1000,       // 30 minutes
      circuitBreakerThreshold: config?.circuitBreakerThreshold ?? 5,
      circuitBreakerResetMs: config?.circuitBreakerResetMs ?? 60 * 1000,       // 60 seconds
      fallbackMessage: config?.fallbackMessage ??
        'BigQuery is temporarily unavailable. Results may be stale or incomplete.',
    };

    logger.info('GracefulDegradationHandler initialized', {
      enabled: this.config.enabled,
      staleCacheMaxAgeMs: this.config.staleCacheMaxAgeMs,
      circuitBreakerThreshold: this.config.circuitBreakerThreshold,
      circuitBreakerResetMs: this.config.circuitBreakerResetMs,
    });
  }

  /**
   * Execute an operation with circuit breaker and stale-cache fallback.
   *
   * @param operation   The live BigQuery operation to attempt
   * @param cacheKey    Cache key for looking up / storing results
   * @param cache       The QueryCache instance to use for fallback
   */
  async executeWithFallback<T>(
    operation: () => Promise<T>,
    cacheKey: string,
    cache: QueryCache<T>,
  ): Promise<DegradationResult<T>> {
    if (!this.config.enabled) {
      const result = await operation();
      return { result, degraded: false, source: 'live' };
    }

    // Check circuit state transitions
    this.maybeTransitionToHalfOpen();

    // If circuit is open, go directly to fallback
    if (this.state === 'open') {
      logger.debug('Circuit open, attempting fallback', { cacheKey: cacheKey.substring(0, 16) });
      return this.serveFallback<T>(cacheKey, cache);
    }

    // Attempt the live operation (closed or half-open)
    try {
      const result = await operation();

      this.onSuccess();

      // Update cache with fresh result
      cache.set(cacheKey, result);

      return { result, degraded: false, source: 'live' };
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);

      this.onFailure();

      logger.warn('Operation failed, attempting fallback', {
        error: errorMsg,
        state: this.state,
        consecutiveFailures: this.consecutiveFailures,
      });

      return this.serveFallback<T>(cacheKey, cache);
    }
  }

  /**
   * Get the current circuit breaker state.
   */
  getCircuitState(): CircuitState {
    this.maybeTransitionToHalfOpen();
    return this.state;
  }

  /**
   * Get degradation statistics.
   */
  getStats(): DegradationStats {
    return {
      state: this.state,
      failures: this.consecutiveFailures,
      lastFailure: this.lastFailureTime !== null ? new Date(this.lastFailureTime) : null,
      fallbacksServed: this.fallbacksServed,
      staleCacheHits: this.staleCacheHits,
    };
  }

  /**
   * Manually reset the circuit breaker to closed state.
   */
  reset(): void {
    this.state = 'closed';
    this.consecutiveFailures = 0;
    this.lastFailureTime = null;
    logger.info('Circuit breaker manually reset');
  }

  // ==========================================
  // Private Helpers
  // ==========================================

  /**
   * Transition from open to half-open if enough time has passed.
   */
  private maybeTransitionToHalfOpen(): void {
    if (
      this.state === 'open' &&
      this.lastFailureTime !== null &&
      Date.now() - this.lastFailureTime >= this.config.circuitBreakerResetMs
    ) {
      this.state = 'half-open';
      logger.info('Circuit breaker transitioning to half-open');
    }
  }

  /**
   * Handle a successful operation.
   */
  private onSuccess(): void {
    if (this.state === 'half-open') {
      logger.info('Circuit breaker closing after successful probe');
    }
    this.state = 'closed';
    this.consecutiveFailures = 0;
  }

  /**
   * Handle a failed operation.
   */
  private onFailure(): void {
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    if (this.state === 'half-open') {
      // Failed during probe, go back to open
      this.state = 'open';
      logger.warn('Circuit breaker reopened after failed probe');
    } else if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      this.state = 'open';
      logger.warn('Circuit breaker opened', {
        consecutiveFailures: this.consecutiveFailures,
        threshold: this.config.circuitBreakerThreshold,
      });
    }
  }

  /**
   * Attempt to serve a result from stale cache or return a fallback notice.
   */
  private serveFallback<T>(cacheKey: string, cache: QueryCache<T>): DegradationResult<T> {
    // Try to get from cache, even if expired (stale)
    const entry = cache.getEntry(cacheKey);

    if (entry) {
      const ageMs = Date.now() - entry.timestamp;

      if (ageMs <= this.config.staleCacheMaxAgeMs) {
        this.staleCacheHits++;
        logger.info('Serving stale cache result', {
          cacheKey: cacheKey.substring(0, 16),
          ageMs,
          maxAgeMs: this.config.staleCacheMaxAgeMs,
        });

        return {
          result: entry.value,
          degraded: true,
          source: 'stale-cache',
        };
      }

      logger.warn('Stale cache entry too old, discarding', {
        cacheKey: cacheKey.substring(0, 16),
        ageMs,
        maxAgeMs: this.config.staleCacheMaxAgeMs,
      });
    }

    // No cache available, return degradation notice
    this.fallbacksServed++;
    logger.warn('No cache available, serving fallback notice');

    const fallbackResult = {
      error: 'service_degraded',
      message: this.config.fallbackMessage,
      timestamp: new Date().toISOString(),
    } as unknown as T;

    return {
      result: fallbackResult,
      degraded: true,
      source: 'fallback',
    };
  }
}
