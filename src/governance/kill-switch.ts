import { logger } from '../utils/logger.js';

/**
 * Kill-switch / AgentSupervisor (§14.1).
 *
 * Halts a session in <1 min without rotating IAM credentials. Any in-flight
 * tool call observing a halted session short-circuits to DENY with
 * `haltReason`. Every halt/resume is an audited HumanOverrideStep.
 */

export interface HaltRecord {
  sessionId: string;
  reason: string;
  actor: string;
  haltedAt: number;
  resumedAt?: number;
}

export interface KillSwitchHooks {
  onHalt?(record: HaltRecord): void;
  onResume?(record: HaltRecord): void;
}

export class KillSwitch {
  private readonly halted = new Map<string, HaltRecord>();
  constructor(private readonly hooks: KillSwitchHooks = {}) {}

  halt(sessionId: string, reason: string, actor: string): HaltRecord {
    if (this.halted.has(sessionId)) return this.halted.get(sessionId)!;
    const rec: HaltRecord = { sessionId, reason, actor, haltedAt: Date.now() };
    this.halted.set(sessionId, rec);
    logger.warn('kill-switch engaged', rec);
    this.hooks.onHalt?.(rec);
    return rec;
  }

  resume(sessionId: string, actor: string): HaltRecord | null {
    const rec = this.halted.get(sessionId);
    if (!rec) return null;
    rec.resumedAt = Date.now();
    this.halted.delete(sessionId);
    logger.info('kill-switch released', { sessionId, actor, haltMs: rec.resumedAt - rec.haltedAt });
    this.hooks.onResume?.(rec);
    return rec;
  }

  isHalted(sessionId: string): boolean {
    return this.halted.has(sessionId);
  }
  reason(sessionId: string): string | undefined {
    return this.halted.get(sessionId)?.reason;
  }
  listHalted(): HaltRecord[] {
    return [...this.halted.values()];
  }

  /** Call at the top of every governed tool handler. Throws if halted. */
  enforce(sessionId: string): void {
    const rec = this.halted.get(sessionId);
    if (rec) throw new SessionHaltedError(sessionId, rec.reason);
  }
}

export class SessionHaltedError extends Error {
  constructor(
    public readonly sessionId: string,
    public readonly haltReason: string
  ) {
    super(`session ${sessionId} halted: ${haltReason}`);
    this.name = 'SessionHaltedError';
  }
}

let _singleton: KillSwitch | null = null;
export function getKillSwitch(hooks?: KillSwitchHooks): KillSwitch {
  if (!_singleton) _singleton = new KillSwitch(hooks);
  return _singleton;
}
