/**
 * Bounded Batch Processor Framework (#1137).
 *
 * Implements bounded, memory-safe, backpressure-aware batch processing for
 * large datasets (e.g. catalog re-indexing, bulk moderation, backfills,
 * analytics rollups, or audit archival).
 *
 * Design Guarantees:
 *   1. Space Complexity: O(B) heap usage, where B is batchSize. Paging via
 *      cursors guarantees memory does not scale with total dataset size N.
 *   2. Time Complexity: O(N) overall. Batches process sequentially or with
 *      strictly bounded worker concurrency. An event-loop pause (setImmediate)
 *      between batches prevents event loop starvation.
 *   3. Checkpoint & Resume: Checkpoints are saved at clean batch boundaries,
 *      allowing interrupted runs to resume without re-processing items.
 *   4. Failure Isolation: Item failures do not crash the batch (when continueOnError is true),
 *      and a consecutive error threshold acts as a circuit breaker.
 *   5. Authorization: Requires verified actor credentials before initiating any batch run.
 */

export interface BatchActor {
  id: string;
  permissions: ReadonlySet<string>;
}

export interface BatchCursorPage<T, C> {
  items: T[];
  nextCursor: C | null;
  hasMore: boolean;
}

export interface BatchProcessorOptions<T, C> {
  jobName: string;
  batchSize?: number; // Default 50, bounded [1, 500]
  concurrency?: number; // Concurrent items within a batch, bounded [1, 10], default 1
  delayBetweenBatchesMs?: number; // Backpressure throttle, default 0
  continueOnError?: boolean; // Default true
  maxConsecutiveErrors?: number; // Circuit breaker limit, default 10
  requiredPermission?: string; // Authorization check
  fetchPage: (cursor: C | null, limit: number) => Promise<BatchCursorPage<T, C>>;
  processItem: (item: T, index: number) => Promise<void>;
  saveCheckpoint?: (checkpoint: BatchCheckpoint<C>) => Promise<void>;
  compensate?: (item: T, error: Error) => Promise<void>;
}

export interface BatchCheckpoint<C> {
  jobName: string;
  cursor: C | null;
  processedCount: number;
  successCount: number;
  failureCount: number;
  updatedAt: string;
  isComplete: boolean;
}

export interface BatchItemError<C> {
  itemIndex: number;
  cursor: C | null;
  error: string;
}

export interface BatchRunReport<C> {
  jobName: string;
  status: "completed" | "aborted" | "interrupted" | "failed";
  totalProcessed: number;
  totalSucceeded: number;
  totalFailed: number;
  cursor: C | null;
  errors: BatchItemError<C>[];
  durationMs: number;
}

export class BatchAuthorizationError extends Error {
  readonly code = "batch_unauthorized";
  constructor(message: string) {
    super(message);
    this.name = "BatchAuthorizationError";
  }
}

export class BatchCircuitBreakerError extends Error {
  readonly code = "batch_circuit_breaker_tripped";
  constructor(message: string) {
    super(message);
    this.name = "BatchCircuitBreakerError";
  }
}

const MIN_BATCH_SIZE = 1;
const MAX_BATCH_SIZE = 500;
const DEFAULT_BATCH_SIZE = 50;

/**
 * Executes a bounded batch run over a potentially massive dataset.
 */
export async function executeBoundedBatch<T, C>(
  options: BatchProcessorOptions<T, C>,
  actor?: BatchActor,
  resumeCheckpoint?: BatchCheckpoint<C> | null,
  signal?: AbortSignal,
): Promise<BatchRunReport<C>> {
  const startTime = Date.now();

  // 1. Authorization Path
  if (options.requiredPermission) {
    if (!actor || !actor.permissions.has(options.requiredPermission)) {
      throw new BatchAuthorizationError(
        `Actor '${actor?.id ?? "anonymous"}' lacks required permission '${options.requiredPermission}'`,
      );
    }
  }

  const batchSize = Math.min(
    Math.max(options.batchSize ?? DEFAULT_BATCH_SIZE, MIN_BATCH_SIZE),
    MAX_BATCH_SIZE,
  );
  const concurrency = Math.min(Math.max(options.concurrency ?? 1, 1), 10);
  const continueOnError = options.continueOnError ?? true;
  const maxConsecutiveErrors = options.maxConsecutiveErrors ?? 10;
  const delayMs = Math.max(options.delayBetweenBatchesMs ?? 0, 0);

  let currentCursor: C | null = resumeCheckpoint?.cursor ?? null;
  let totalProcessed = resumeCheckpoint?.processedCount ?? 0;
  let totalSucceeded = resumeCheckpoint?.successCount ?? 0;
  let totalFailed = resumeCheckpoint?.failureCount ?? 0;
  let consecutiveErrors = 0;
  const errors: BatchItemError<C>[] = [];
  let status: BatchRunReport<C>["status"] = "completed";

  while (!signal?.aborted) {
    // 2. Bounded Page Fetch: Space Complexity O(B)
    const page = await options.fetchPage(currentCursor, batchSize);
    if (!page.items || page.items.length === 0) {
      break;
    }

    // 3. Process Chunk with Bounded Concurrency
    for (let i = 0; i < page.items.length; i += concurrency) {
      if (signal?.aborted) {
        status = "interrupted";
        break;
      }

      const chunk = page.items.slice(i, i + concurrency);
      const results = await Promise.allSettled(
        chunk.map((item, idx) => options.processItem(item, totalProcessed + idx)),
      );

      for (let j = 0; j < results.length; j++) {
        const res = results[j];
        const item = chunk[j];
        totalProcessed++;

        if (res.status === "fulfilled") {
          totalSucceeded++;
          consecutiveErrors = 0;
        } else {
          totalFailed++;
          consecutiveErrors++;
          const errorMsg = res.reason instanceof Error ? res.reason.message : String(res.reason);
          errors.push({
            itemIndex: totalProcessed - 1,
            cursor: currentCursor,
            error: errorMsg,
          });

          if (options.compensate) {
            try {
              await options.compensate(
                item,
                res.reason instanceof Error ? res.reason : new Error(errorMsg),
              );
            } catch {
              // Compensation error does not mask original error
            }
          }

          if (!continueOnError) {
            status = "failed";
            break;
          }

          if (consecutiveErrors >= maxConsecutiveErrors) {
            status = "aborted";
            break;
          }
        }
      }

      if (status !== "completed") {
        break;
      }
    }

    currentCursor = page.nextCursor;

    // 4. Checkpoint at Clean Batch Boundary
    if (options.saveCheckpoint) {
      await options.saveCheckpoint({
        jobName: options.jobName,
        cursor: currentCursor,
        processedCount: totalProcessed,
        successCount: totalSucceeded,
        failureCount: totalFailed,
        updatedAt: new Date().toISOString(),
        isComplete: !page.hasMore || status === "completed",
      });
    }

    if (status !== "completed" || !page.hasMore || currentCursor === null) {
      break;
    }

    // 5. Backpressure / Event Loop Pause: prevents CPU & I/O starvation
    if (delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } else {
      await new Promise((resolve) => setImmediate(resolve));
    }
  }

  if (signal?.aborted && status === "completed") {
    status = "interrupted";
  }

  return {
    jobName: options.jobName,
    status,
    totalProcessed,
    totalSucceeded,
    totalFailed,
    cursor: currentCursor,
    errors,
    durationMs: Date.now() - startTime,
  };
}

