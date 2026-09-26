/**
 * Worker entry point — polls the job queue, dispatches handlers, applies retry/backoff/DLQ.
 *
 * Usage:
 *   import { startWorker } from "./jobs/worker";
 *   startWorker().catch(console.error);
 *
 *   // or for testing: `processOne(workerId)` to handle a single job deterministically.
 */

import { claimNextJob, markJobCompleted, markJobFailed } from "./jobQueue";
import type { JobRecordDTO } from "./types";

// Handler registry — each handler is a pure async function that either resolves or throws.
import { handleSettlementPoll } from "./handlers/settlementPoll";
import { handleEntitlementRepair } from "./handlers/entitlementRepair";
import { handleAnalyticsAggregate } from "./handlers/analyticsAggregate";
import { handleExportCsv } from "./handlers/exportCsv";
import { handleStaleDisputeCleanup } from "./handlers/staleDisputeCleanup";

type Handler = (job: JobRecordDTO) => Promise<void>;

const HANDLERS: Record<string, Handler> = {
  settlement_poll: handleSettlementPoll,
  entitlement_repair: handleEntitlementRepair,
  analytics_aggregate: handleAnalyticsAggregate,
  export_csv: handleExportCsv,
  stale_dispute_cleanup: handleStaleDisputeCleanup,
};

export function getHandler(type: string): Handler | undefined {
  return HANDLERS[type];
}

export async function processOne(workerId = `worker-${process.pid}`): Promise<JobRecordDTO | null> {
  const job = await claimNextJob(workerId);
  if (!job) return null;

  const handler = getHandler(job.type);
  if (!handler) {
    return markJobFailed(job.id, `No handler registered for job type: ${job.type}`);
  }

  try {
    await handler(job);
    await markJobCompleted(job.id);
    return job;
  } catch (err: any) {
    const message = err?.message ?? String(err);
    return markJobFailed(job.id, message);
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
      console.log("[worker] stopped");
    },
  };
}
