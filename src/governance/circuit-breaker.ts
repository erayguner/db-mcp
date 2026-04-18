import { logger } from '../utils/logger.js';

/**
 * Circuit breaker for external dependencies (§13.1).
 *
 * Documented thresholds; an open breaker denies cleanly with a named reason
 * rather than failing silently. Used by BigQuery client, approval gateway,
 * and any outbound MCP server call.
 */

export type BreakerState = 'closed' | 'open' | 'half-open';

export interface BreakerOptions {
  name: string;
  failureThreshold: number;      // consecutive failures to open
  halfOpenAfterMs: number;        // cool-down before trial request
  successThreshold: number;       // successes in half-open to close
  callTimeoutMs?: number;         // optional per-call timeout
}

export class CircuitOpenError extends Error {
  constructor(public readonly breaker: string, public readonly reason: string) {
    super(`circuit open: ${breaker} — ${reason}`);
    this.name = 'CircuitOpenError';
  }
}

export class CircuitBreaker {
  private state: BreakerState = 'closed';
  private failures = 0;
  private successes = 0;
  private openedAt = 0;

  constructor(private readonly opts: BreakerOptions) {}

  get currentState(): BreakerState { return this.state; }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.state === 'open') {
      if (Date.now() - this.openedAt < this.opts.halfOpenAfterMs) {
        throw new CircuitOpenError(this.opts.name, 'cool-down');
      }
      this.transition('half-open');
    }
    try {
      const result = await this.withTimeout(fn);
      this.onSuccess();
      return result;
    } catch (err) {
      this.onFailure(err);
      throw err;
    }
  }

  private async withTimeout<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.opts.callTimeoutMs) return fn();
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        fn(),
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timeout after ${this.opts.callTimeoutMs}ms`)), this.opts.callTimeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  private onSuccess(): void {
    this.failures = 0;
    if (this.state === 'half-open') {
      this.successes += 1;
      if (this.successes >= this.opts.successThreshold) this.transition('closed');
    }
  }

  private onFailure(err: unknown): void {
    this.successes = 0;
    this.failures += 1;
    logger.warn('circuit-breaker failure', { name: this.opts.name, failures: this.failures, err: String(err) });
    if (this.state === 'half-open' || this.failures >= this.opts.failureThreshold) {
      this.openedAt = Date.now();
      this.transition('open');
    }
  }

  private transition(next: BreakerState): void {
    if (this.state === next) return;
    logger.info('circuit-breaker state change', { name: this.opts.name, from: this.state, to: next });
    this.state = next;
    if (next === 'closed') { this.failures = 0; this.successes = 0; }
    if (next === 'half-open') this.successes = 0;
  }
}
