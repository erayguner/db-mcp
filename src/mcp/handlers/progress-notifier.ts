import { logger } from '../../utils/logger.js';

/**
 * A progress update emitted during a long-running BigQuery operation.
 */
export interface ProgressUpdate {
  progressToken: string | number;
  progress: number;
  total?: number;
  message?: string;
}

/**
 * Callback invoked whenever progress changes.
 */
export type ProgressCallback = (update: ProgressUpdate) => void;

/**
 * Tracks progress for a single long-running operation.
 *
 * Each lifecycle method emits a {@link ProgressUpdate} through the
 * registered callback.
 */
export class ProgressTracker {
  private currentProgress = 0;
  private currentTotal: number | undefined;

  constructor(
    private readonly operationId: string,
    private readonly callback: ProgressCallback,
  ) {}

  /** Mark the operation as queued (waiting to start). */
  queued(): void {
    this.emit(0, undefined, 'Queued — waiting for BigQuery slot');
  }

  /** Mark the operation as actively running. */
  running(): void {
    this.emit(0, undefined, 'Running — query execution started');
  }

  /**
   * Report incremental processing progress.
   *
   * @param bytesProcessed - Bytes processed so far.
   * @param totalBytes     - Total bytes expected (may be undefined).
   */
  processing(bytesProcessed: number, totalBytes?: number): void {
    this.currentProgress = bytesProcessed;
    this.currentTotal = totalBytes;

    const pct = totalBytes && totalBytes > 0
      ? ((bytesProcessed / totalBytes) * 100).toFixed(1)
      : undefined;

    const message = pct
      ? `Processing — ${pct}% (${formatBytes(bytesProcessed)} / ${formatBytes(totalBytes!)})`
      : `Processing — ${formatBytes(bytesProcessed)} processed`;

    this.emit(bytesProcessed, totalBytes, message);
  }

  /** Mark the operation as successfully completed. */
  complete(): void {
    const total = this.currentTotal ?? this.currentProgress;
    this.emit(total, total, 'Complete');

    logger.debug('Operation completed', { operationId: this.operationId });
  }

  /** Mark the operation as failed. */
  error(message: string): void {
    this.emit(this.currentProgress, this.currentTotal, `Error: ${message}`);

    logger.warn('Operation errored', {
      operationId: this.operationId,
      error: message,
    });
  }

  // ---------------------------------------------------------------------------
  // Helpers
  // ---------------------------------------------------------------------------

  private emit(progress: number, total: number | undefined, message: string): void {
    const update: ProgressUpdate = {
      progressToken: this.operationId,
      progress,
      total,
      message,
    };

    try {
      this.callback(update);
    } catch (err) {
      logger.error('Progress callback threw', {
        operationId: this.operationId,
        error: (err as Error).message,
      });
    }
  }
}

/**
 * Creates and manages {@link ProgressTracker} instances for concurrent
 * BigQuery operations.
 */
export class ProgressNotifier {
  private readonly activeOperations = new Map<string, ProgressTracker>();

  /**
   * Create a new tracker for the given operation.
   *
   * If a tracker with the same `operationId` already exists it is replaced.
   */
  createTracker(operationId: string, callback: ProgressCallback): ProgressTracker {
    const tracker = new ProgressTracker(operationId, (update) => {
      callback(update);

      // Automatically remove the tracker on terminal states.
      if (update.message?.startsWith('Complete') || update.message?.startsWith('Error:')) {
        this.activeOperations.delete(operationId);
      }
    });

    this.activeOperations.set(operationId, tracker);

    logger.debug('Progress tracker created', {
      operationId,
      activeCount: this.activeOperations.size,
    });

    return tracker;
  }

  /** Number of currently active (non-terminal) operations. */
  get activeCount(): number {
    return this.activeOperations.size;
  }

  /** Return the set of operation IDs that are currently being tracked. */
  getActiveOperationIds(): string[] {
    return Array.from(this.activeOperations.keys());
  }
}

// ---------------------------------------------------------------------------
// Internal utility
// ---------------------------------------------------------------------------

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}
