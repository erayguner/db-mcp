import { logger } from '../../utils/logger.js';

/**
 * A query history entry recorded within a session.
 */
export interface QueryHistoryEntry {
  query: string;
  timestamp: Date;
  rowCount?: number;
  bytesProcessed?: string;
  error?: string;
}

/**
 * Metadata associated with an MCP session.
 */
export interface SessionMetadata {
  userId?: string;
  tenantId?: string;
  toolCallCount: number;
}

/**
 * Represents a multi-turn MCP session for BigQuery interactions.
 */
export interface MCPSession {
  id: string;
  createdAt: Date;
  lastAccessedAt: Date;
  queryHistory: QueryHistoryEntry[];
  context: Record<string, unknown>;
  metadata: SessionMetadata;
}

/**
 * Summary snapshot of a session.
 */
export interface SessionSummary {
  totalQueries: number;
  totalBytes: string;
  lastQuery: string | undefined;
  duration: number;
}

const DEFAULT_MAX_AGE_MS = 60 * 60 * 1000; // 1 hour
const MAX_SESSIONS = 1000;
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Manages MCP sessions for multi-turn query interactions.
 *
 * - Caps concurrent sessions at {@link MAX_SESSIONS}.
 * - Runs an automatic (unref'd) cleanup interval for expired sessions.
 */
export class SessionManager {
  private readonly sessions = new Map<string, MCPSession>();
  private readonly cleanupTimer: ReturnType<typeof setInterval>;

  constructor() {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpired();
    }, CLEANUP_INTERVAL_MS);

    // Allow the process to exit even if the timer is still active.
    if (typeof this.cleanupTimer === 'object' && 'unref' in this.cleanupTimer) {
      this.cleanupTimer.unref();
    }
  }

  // ---------------------------------------------------------------------------
  // Public API
  // ---------------------------------------------------------------------------

  /**
   * Create a new session, evicting the oldest if the cap has been reached.
   */
  createSession(userId?: string, tenantId?: string): MCPSession {
    // Enforce max sessions — evict oldest
    if (this.sessions.size >= MAX_SESSIONS) {
      this.evictOldest();
    }

    const now = new Date();
    const session: MCPSession = {
      id: crypto.randomUUID(),
      createdAt: now,
      lastAccessedAt: now,
      queryHistory: [],
      context: {},
      metadata: {
        userId,
        tenantId,
        toolCallCount: 0,
      },
    };

    this.sessions.set(session.id, session);

    logger.debug('Session created', {
      sessionId: session.id,
      userId,
      tenantId,
      activeSessions: this.sessions.size,
    });

    return session;
  }

  /**
   * Retrieve a session by ID. Returns `undefined` if not found.
   * Updates `lastAccessedAt` on access.
   */
  getSession(sessionId: string): MCPSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastAccessedAt = new Date();
    }
    return session;
  }

  /**
   * Merge partial updates into an existing session.
   */
  updateSession(sessionId: string, updates: Partial<MCPSession>): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn('Attempted to update non-existent session', { sessionId });
      return;
    }

    if (updates.context !== undefined) {
      Object.assign(session.context, updates.context);
    }

    if (updates.metadata !== undefined) {
      Object.assign(session.metadata, updates.metadata);
    }

    if (updates.queryHistory !== undefined) {
      session.queryHistory = updates.queryHistory;
    }

    session.lastAccessedAt = new Date();
  }

  /**
   * Append a query history entry to the session and bump the tool call count.
   */
  recordQuery(sessionId: string, entry: QueryHistoryEntry): void {
    const session = this.sessions.get(sessionId);
    if (!session) {
      logger.warn('Attempted to record query for non-existent session', { sessionId });
      return;
    }

    session.queryHistory.push(entry);
    session.metadata.toolCallCount += 1;
    session.lastAccessedAt = new Date();

    logger.debug('Query recorded', {
      sessionId,
      queryCount: session.queryHistory.length,
    });
  }

  /**
   * Return a summary snapshot for the given session.
   */
  getSessionSummary(sessionId: string): SessionSummary | undefined {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return undefined;
    }

    const totalBytes = session.queryHistory.reduce((sum, q) => {
      return sum + BigInt(q.bytesProcessed ?? '0');
    }, 0n);

    const lastEntry =
      session.queryHistory.length > 0
        ? session.queryHistory[session.queryHistory.length - 1]
        : undefined;

    return {
      totalQueries: session.queryHistory.length,
      totalBytes: totalBytes.toString(),
      lastQuery: lastEntry?.query,
      duration: Date.now() - session.createdAt.getTime(),
    };
  }

  /**
   * Remove sessions older than `maxAgeMs` (default: 1 hour).
   * @returns The number of sessions removed.
   */
  cleanupExpired(maxAgeMs: number = DEFAULT_MAX_AGE_MS): number {
    const cutoff = Date.now() - maxAgeMs;
    let removed = 0;

    for (const [id, session] of this.sessions) {
      if (session.lastAccessedAt.getTime() < cutoff) {
        this.sessions.delete(id);
        removed += 1;
      }
    }

    if (removed > 0) {
      logger.info('Expired sessions cleaned up', {
        removed,
        remaining: this.sessions.size,
      });
    }

    return removed;
  }

  /**
   * Stop the automatic cleanup timer. Call this during graceful shutdown.
   */
  dispose(): void {
    clearInterval(this.cleanupTimer);
  }

  /** Current number of active sessions. */
  get size(): number {
    return this.sessions.size;
  }

  // ---------------------------------------------------------------------------
  // Internal helpers
  // ---------------------------------------------------------------------------

  private evictOldest(): void {
    let oldestId: string | undefined;
    let oldestTime = Infinity;

    for (const [id, session] of this.sessions) {
      const t = session.lastAccessedAt.getTime();
      if (t < oldestTime) {
        oldestTime = t;
        oldestId = id;
      }
    }

    if (oldestId) {
      this.sessions.delete(oldestId);
      logger.debug('Evicted oldest session due to capacity limit', {
        evictedSessionId: oldestId,
      });
    }
  }
}
