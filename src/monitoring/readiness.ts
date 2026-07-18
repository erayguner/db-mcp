import { logger } from '../utils/logger.js';

/**
 * Readiness probing for container orchestrators (Cloud Run / Kubernetes).
 *
 * Liveness and readiness answer two different questions and must not share an
 * implementation:
 *
 * - **Liveness** — "is this process still able to run code?" A failed liveness
 *   probe restarts the container. It must therefore never depend on a remote
 *   dependency: a BigQuery outage would otherwise roll the whole fleet, turning
 *   a recoverable upstream incident into a crash-loop.
 * - **Readiness** — "can this instance serve a request right now?" A failed
 *   readiness probe only removes the instance from the load balancer. This is
 *   where dependency checks belong; the instance rejoins automatically once the
 *   dependency recovers.
 *
 * Probes registered here are readiness probes. A probe signals failure by
 * throwing or rejecting; the thrown message is surfaced in the probe response
 * so an operator can see *which* dependency is down without reading logs.
 */

/** Per-probe timeout. A probe that outlives this budget counts as not-ready. */
export const DEFAULT_PROBE_TIMEOUT_MS = 2_000;

/**
 * How long a readiness verdict is reused. Orchestrator probe traffic is
 * periodic and often redundant (Cloud Run + LB + uptime checks all poll), so
 * without caching every probe would issue a fresh BigQuery round trip.
 */
export const DEFAULT_READINESS_CACHE_MS = 5_000;

/**
 * A single readiness dependency check. Resolve/return to signal healthy; throw
 * or reject to signal not-ready. The thrown message becomes the reported cause.
 */
export type ReadinessProbe = () => Promise<void> | void;

/** Outcome of one probe within a readiness evaluation. */
export interface ReadinessProbeResult {
  name: string;
  ok: boolean;
  durationMs: number;
  /** Failure cause — present only when `ok` is false. */
  error?: string;
}

/** Aggregate readiness verdict. */
export interface ReadinessResult {
  ready: boolean;
  checks: ReadinessProbeResult[];
  /** ISO timestamp of when the verdict was computed (not when it was served). */
  checkedAt: string;
  /** True when served from the short-lived cache rather than freshly evaluated. */
  cached: boolean;
}

/** Tuning knobs for a {@link ReadinessRegistry}. */
export interface ReadinessRegistryOptions {
  timeoutMs?: number;
  cacheTtlMs?: number;
}

/**
 * Registry of readiness probes with per-probe timeouts, a short result cache,
 * and single-flight de-duplication of concurrent evaluations.
 */
export class ReadinessRegistry {
  private readonly probes = new Map<string, ReadinessProbe>();
  private readonly timeoutMs: number;
  private readonly cacheTtlMs: number;
  private cached: { result: ReadinessResult; expiresAt: number } | null = null;
  private inFlight: Promise<ReadinessResult> | null = null;

  constructor(options: ReadinessRegistryOptions = {}) {
    this.timeoutMs = options.timeoutMs ?? DEFAULT_PROBE_TIMEOUT_MS;
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_READINESS_CACHE_MS;
  }

  /**
   * Register (or replace) a named readiness probe. Registering invalidates any
   * cached verdict so the new dependency is reflected on the next probe.
   */
  register(name: string, probe: ReadinessProbe): void {
    this.probes.set(name, probe);
    this.invalidate();
    logger.info('Readiness probe registered', { probe: name, totalProbes: this.probes.size });
  }

  /** Remove a probe by name. Returns true when a probe was actually removed. */
  unregister(name: string): boolean {
    const removed = this.probes.delete(name);
    if (removed) {
      this.invalidate();
    }
    return removed;
  }

  /** Remove every probe (used by tests and on shutdown). */
  clear(): void {
    this.probes.clear();
    this.invalidate();
  }

  /** Number of registered probes. */
  get size(): number {
    return this.probes.size;
  }

  /** Names of the registered probes, in registration order. */
  probeNames(): string[] {
    return [...this.probes.keys()];
  }

  /** Drop any cached verdict, forcing the next `check()` to re-evaluate. */
  invalidate(): void {
    this.cached = null;
  }

  /**
   * Evaluate readiness, serving a cached verdict when one is still fresh.
   *
   * Never rejects: a probe that throws, rejects, or exceeds the timeout is
   * recorded as a failed check rather than propagating — a probe endpoint that
   * throws is indistinguishable from a crashed server to an orchestrator.
   */
  async check(): Promise<ReadinessResult> {
    const now = Date.now();

    if (this.cached && this.cached.expiresAt > now) {
      return { ...this.cached.result, cached: true };
    }

    // Single-flight: a burst of simultaneous probes shares one evaluation.
    if (this.inFlight) {
      return this.inFlight;
    }

    this.inFlight = this.evaluate().finally(() => {
      this.inFlight = null;
    });

    return this.inFlight;
  }

  /**
   * Run every probe in parallel and cache the aggregate verdict.
   */
  private async evaluate(): Promise<ReadinessResult> {
    const entries = [...this.probes.entries()];
    const checks = await Promise.all(entries.map(([name, probe]) => this.runProbe(name, probe)));

    const result: ReadinessResult = {
      ready: checks.every((check) => check.ok),
      checks,
      checkedAt: new Date().toISOString(),
      cached: false,
    };

    this.cached = { result, expiresAt: Date.now() + this.cacheTtlMs };

    return result;
  }

  /**
   * Run a single probe under a timeout. A hung dependency must not hang the
   * probe request itself — orchestrators interpret a probe that never answers
   * as a failure only after their own (much longer) timeout, during which the
   * instance keeps receiving traffic it cannot serve.
   */
  private async runProbe(name: string, probe: ReadinessProbe): Promise<ReadinessProbeResult> {
    const start = Date.now();
    let timer: NodeJS.Timeout | undefined;

    try {
      await Promise.race([
        // Wrapped so a probe that throws synchronously becomes a rejection.
        (async () => probe())(),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new Error(`timed out after ${this.timeoutMs}ms`)),
            this.timeoutMs
          );
          // Do not keep the event loop alive purely for a probe timeout.
          timer.unref?.();
        }),
      ]);

      return { name, ok: true, durationMs: Date.now() - start };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.warn('Readiness probe failed', { probe: name, error: message });
      return { name, ok: false, durationMs: Date.now() - start, error: message };
    } finally {
      if (timer) {
        clearTimeout(timer);
      }
    }
  }
}

/**
 * Process-wide readiness registry read by the HTTP transport's readiness
 * endpoints. Server bootstrap registers its dependency probes here — see
 * {@link registerBigQueryReadinessProbe}.
 */
export const readinessRegistry = new ReadinessRegistry();

/**
 * Minimal structural view of a BigQuery client, kept structural so the
 * monitoring layer does not depend on the BigQuery module graph.
 */
export interface BigQueryReadinessTarget {
  /** Local state check: client constructed, not shutting down, pool usable. */
  isHealthy(): boolean;
  /** Issues a query against the BigQuery API. */
  query(options: { query: string; dryRun?: boolean; retry?: boolean }): Promise<unknown>;
}

/**
 * Register the BigQuery readiness probe: the client must be initialised
 * (`isHealthy()`) *and* the BigQuery API must be reachable with usable
 * credentials.
 *
 * Reachability uses a `dryRun` query — BigQuery validates and plans it without
 * executing, so the round trip proves connectivity, authentication and
 * authorization while scanning zero bytes and incurring zero cost. Combined
 * with the registry's result cache this issues at most one API call per cache
 * window regardless of probe volume.
 */
export function registerBigQueryReadinessProbe(
  target: BigQueryReadinessTarget,
  options: { registry?: ReadinessRegistry; name?: string } = {}
): void {
  const registry = options.registry ?? readinessRegistry;

  registry.register(options.name ?? 'bigquery', async () => {
    if (!target.isHealthy()) {
      throw new Error('BigQuery client is not initialised or its connection pool is unavailable');
    }

    // `retry: false` keeps the probe inside its timeout budget — retrying a
    // dependency that is already failing only delays the not-ready verdict.
    await target.query({ query: 'SELECT 1', dryRun: true, retry: false });
  });
}
