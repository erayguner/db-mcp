import { logger } from '../utils/logger.js';

/**
 * Dead-letter queue for transient write failures (§13.2).
 *
 * Audit writes, notifications, and approval callbacks that fail transiently
 * land here with an exponential retry schedule. A non-empty DLQ is a monitored
 * alert condition — consumers expose `.size` + `.oldestAgeMs()` for Prometheus.
 */

export interface DlqEntry<T> {
  id: string;
  payload: T;
  attempts: number;
  firstSeenAt: number;
  lastAttemptAt: number;
  lastError: string;
}

export interface DlqOptions<T> {
  name: string;
  maxAttempts: number;
  baseDelayMs: number;        // exponential backoff base
  maxBacklog: number;         // hard cap; beyond this, entries drop with alert
  handler: (payload: T) => Promise<void>;
}

export class DeadLetterQueue<T> {
  private readonly entries = new Map<string, DlqEntry<T>>();
  private draining = false;

  constructor(private readonly opts: DlqOptions<T>) {}

  get size(): number { return this.entries.size; }

  oldestAgeMs(): number {
    let oldest = Number.POSITIVE_INFINITY;
    for (const e of this.entries.values()) oldest = Math.min(oldest, e.firstSeenAt);
    return oldest === Number.POSITIVE_INFINITY ? 0 : Date.now() - oldest;
  }

  async submit(id: string, payload: T): Promise<void> {
    try {
      await this.opts.handler(payload);
    } catch (err) {
      this.enqueue(id, payload, String(err));
    }
  }

  private enqueue(id: string, payload: T, error: string): void {
    if (this.entries.size >= this.opts.maxBacklog) {
      logger.error('DLQ backlog full — dropping entry', { dlq: this.opts.name, id });
      return;
    }
    const existing = this.entries.get(id);
    if (existing) {
      existing.attempts += 1;
      existing.lastAttemptAt = Date.now();
      existing.lastError = error;
    } else {
      this.entries.set(id, {
        id, payload, attempts: 1,
        firstSeenAt: Date.now(),
        lastAttemptAt: Date.now(),
        lastError: error,
      });
    }
    logger.warn('DLQ enqueue', { dlq: this.opts.name, id, attempts: this.entries.get(id)?.attempts });
  }

  /** Retry due entries. Call from a scheduler (reconciliation agent, §13.3). */
  async drain(now: number = Date.now()): Promise<{ succeeded: number; retained: number; dropped: number }> {
    if (this.draining) return { succeeded: 0, retained: this.entries.size, dropped: 0 };
    this.draining = true;
    let succeeded = 0, dropped = 0;
    try {
      for (const [id, entry] of [...this.entries.entries()]) {
        const due = entry.lastAttemptAt + this.backoff(entry.attempts);
        if (now < due) continue;
        if (entry.attempts >= this.opts.maxAttempts) {
          logger.error('DLQ drop — max attempts', { dlq: this.opts.name, id, attempts: entry.attempts });
          this.entries.delete(id);
          dropped += 1;
          continue;
        }
        try {
          await this.opts.handler(entry.payload);
          this.entries.delete(id);
          succeeded += 1;
        } catch (err) {
          entry.attempts += 1;
          entry.lastAttemptAt = now;
          entry.lastError = String(err);
        }
      }
      return { succeeded, retained: this.entries.size, dropped };
    } finally {
      this.draining = false;
    }
  }

  private backoff(attempts: number): number {
    return this.opts.baseDelayMs * 2 ** Math.min(attempts, 10);
  }
}
