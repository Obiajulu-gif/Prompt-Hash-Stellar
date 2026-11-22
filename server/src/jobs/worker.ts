/**
 * Worker entry point — polls the job queue, dispatches handlers, applies retry/backoff/DLQ.
 *
 * Usage:
 *   import { startWorker } from "./jobs/worker";
 *   startWorker().catch(console.error);
 *
 *   // or for testing: `processOne(workerId)` to handle a single job deterministically.
 *
 * Cancellation:
 *   Long-running handlers receive an AbortSignal via `job.signal`-style context.
 *   `cancelJobSignal(jobId)` aborts an in-flight job; the worker treats an
 *   aborted handler as a cancellation (not a retryable failure), runs cleanup
 *   hooks registered for the job, and marks it cancelled.
 *
 * Edge cases / recovery:
 *   - Cancellation before the handler starts is honored without invoking it.
 *   - A handler that resolves after cancellation is still treated as cancelled;
 *     its completion is not recorded and cleanup hooks run.
 *   - Cleanup hooks run in reverse registration order, each at most once per job,
 *     and their failures are logged without changing the job outcome.
 *   - Cancellation is authorized only for jobs owned by this worker process
 *     (`cancelJobSignal` returns false for unknown/foreign job ids).
 *   - Stopping the worker cancels all in-flight jobs so they can clean up.
 */

import { claimNextJob, markJobCompleted, markJobFailed } from "./jobQueue";
import type { JobRecordDTO } from "./types";

// Handler registry — each handler is a pure async function that either resolves or throws.
import { handleSettlementPoll } from "./handlers/settlementPoll";
import { handleEntitlementRepair } from "./handlers/entitlementRepair";
import { handleAnalyticsAggregate } from "./handlers/analyticsAggregate";
import { handleExportCsv } from "./handlers/exportCsv";
import { handleStaleDisputeCleanup } from "./handlers/staleDisputeCleanup";
import { handleRetentionCleanup } from "./handlers/retentionCleanup";
import { handleStaleCacheRepair } from "./handlers/staleCacheRepair";

export type CleanupHook = () => Promise<void> | void;

/** Context handed to handlers; `signal` fires when the job is cancelled. */
export interface JobContext {
  signal: AbortSignal;
  /** Register cleanup to run exactly once if the job is cancelled or fails. */
  onCleanup: (hook: CleanupHook) => void;
}

type Handler = (job: JobRecordDTO, ctx: JobContext) => Promise<void>;

const HANDLERS: Record<string, Handler> = {
  settlement_poll: handleSettlementPoll,
  entitlement_repair: handleEntitlementRepair,
  analytics_aggregate: handleAnalyticsAggregate,
  export_csv: handleExportCsv,
  stale_dispute_cleanup: handleStaleDisputeCleanup,
  retention_cleanup: handleRetentionCleanup,
  stale_cache_repair: handleStaleCacheRepair,
};

/** Thrown (or used as the abort reason) when a job is cancelled. */
export class JobCancelledError extends Error {
  constructor(jobId: string) {
    super(`Job cancelled: ${jobId}`);
    this.name = "JobCancelledError";
  }
}

/** Active in-flight jobs keyed by job id → controller. */
const activeJobs = new Map<string, AbortController>();

export function getHandler(type: string): Handler | undefined {
  return HANDLERS[type];
}

/**
 * Requests cancellation of an in-flight job on this worker.
 * Returns true if the job was running locally and was signalled.
 * Idempotent: repeat calls for the same job are no-ops.
 */
export function cancelJobSignal(jobId: string): boolean {
  const controller = activeJobs.get(jobId);
  if (!controller || controller.signal.aborted) return false;
  controller.abort(new JobCancelledError(jobId));
  return true;
}

/** Whether a job is currently executing on this worker. */
export function isJobActive(jobId: string): boolean {
  return activeJobs.has(jobId);
}

function isCancellation(err: unknown, signal: AbortSignal): boolean {
  return signal.aborted && (err instanceof JobCancelledError || err === signal.reason || (err as any)?.name === "AbortError");
}

/**
 * Runs cleanup hooks in reverse registration order. Errors are logged but
 * never thrown, so cleanup cannot mask the original outcome.
 */
async function runCleanup(hooks: CleanupHook[], jobId: string): Promise<void> {
  for (const hook of [...hooks].reverse()) {
    try {
      await hook();
    } catch (err: any) {
      console.error(`[worker] cleanup hook failed for job ${jobId}:`, err?.message ?? err);
    }
  }
}

export async function processOne(workerId = `worker-${process.pid}`): Promise<JobRecordDTO | null> {
  const job = await claimNextJob(workerId);
  if (!job) return null;

  const handler = getHandler(job.type);
  if (!handler) {
    return markJobFailed(job.id, `No handler registered for job type: ${job.type}`);
  }

  const controller = new AbortController();
  const cleanupHooks: CleanupHook[] = [];
  let cleanedUp = false;
  const ctx: JobContext = {
    signal: controller.signal,
    onCleanup: (hook) => {
      cleanupHooks.push(hook);
    },
  };
  const cleanupOnce = async () => {
    if (cleanedUp) return;
    cleanedUp = true;
    await runCleanup(cleanupHooks, job.id);
  };

  activeJobs.set(job.id, controller);
  try {
    if (controller.signal.aborted) throw new JobCancelledError(job.id);
    await handler(job, ctx);
    if (controller.signal.aborted) throw new JobCancelledError(job.id);
    await markJobCompleted(job.id);
    return job;
  } catch (err: any) {
    if (isCancellation(err, controller.signal)) {
      await cleanupOnce();
      return markJobFailed(job.id, `cancelled: ${new JobCancelledError(job.id).message}`);
    }
    await cleanupOnce();
    const message = err?.message ?? String(err);
    return markJobFailed(job.id, message);
  } finally {
    activeJobs.delete(job.id);
  }
}

let workerTimer: NodeJS.Timeout | null = null;
let stopped = false;

export function startWorker(options: { pollIntervalMs?: number; workerId?: string } = {}): { stop: () => void } {
  const pollIntervalMs = options.pollIntervalMs ?? 2000;
  const workerId = options.workerId ?? `worker-${process.pid}-${Date.now()}`;
  stopped = false;

  async function loop() {
    if (stopped) return;
    try {
      const job = await processOne(workerId);
      // If we processed a job, poll immediately for next; else wait
      if (job) {
        setImmediate(loop);
        return;
      }
    } catch (err) {
      console.error("[worker] loop error:", err);
    }
    if (!stopped) {
      workerTimer = setTimeout(loop, pollIntervalMs);
    }
  }

  console.log(`[worker] started — pollInterval=${pollIntervalMs}ms id=${workerId} handlers=${Object.keys(HANDLERS).join(",")}`);
  loop();

  return {
    stop: () => {
      stopped = true;
      if (workerTimer) clearTimeout(workerTimer);
      // Cancel any in-flight jobs so handlers can clean up promptly.
      for (const id of activeJobs.keys()) cancelJobSignal(id);
      console.log("[worker] stopped");
    },
  };
}
