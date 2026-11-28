/**
 * Job types and versioned payloads — keep payloads small (<1KB) and versioned.
 * Bump `version` when shape changes; handlers must handle old versions.
 *
 * Cancellation & cleanup:
 * - Any job may carry an optional `cancelRequested` flag (see CancellableJobPayload).
 *   Handlers must check it between units of work and, when set, stop early and
 *   run their cleanup (release locks, clear partial artifacts) before completing.
 * - Cancellation is cooperative: enqueuing a cancel marks the job `cancel_requested`;
 *   a pending job is cancelled immediately, a processing job is cancelled at its next checkpoint.
 * - Failure and retry: a cancelled job is never retried. Cleanup failures are recorded in
 *   `lastError` but do not re-enqueue the job.
 * - Authorization: only the creator (`requestedBy` / `creatorWallet`) or an admin may cancel
 *   a job whose payload names an owner. See CancelJobRequest.
 * - Migration: `cancelRequested` is optional and defaults to false, so existing v1 payloads
 *   remain valid without a version bump.
 *
 * Dependency note (CI fix): the Yarn resolution `typescript@npm:^5.0.0 -> npm:6.0.3`
 * is invalid because TypeScript 6.x does not exist on the 5.x range. Pin the
 * `resolutions` entry in package.json to a 5.x version (e.g. `"typescript": "~5.6.3"`)
 * so the Playwright workflow's "Install dependencies" step resolves successfully.
 */

export interface BaseJobPayload {
  version: number; // schema version — handlers switch on this
  createdAt?: string;
  /** Set when a cancellation has been requested; absent/false means run normally. */
  cancelRequested?: boolean;
}

/** Payloads that support cooperative cancellation. `cancelRequested` is optional (defaults to false). */
export type CancellableJobPayload = BaseJobPayload;

export interface SettlementPollPayload extends BaseJobPayload {
  version: 1;
  purchaseId: string;
  promptId: string;
  buyerWallet: string;
  txHash?: string;
  ledgerSequence?: number;
}

export interface EntitlementRepairPayload extends BaseJobPayload {
  version: 1;
  promptId: string;
  buyerWallet: string;
  expectedHasAccess?: boolean;
}

export interface AnalyticsAggregatePayload extends BaseJobPayload {
  version: 1;
  windowDays: number;
  creatorWallet?: string; // if omitted, aggregate platform-wide (restricted)
}

export interface ExportCsvPayload extends BaseJobPayload {
  version: 1;
  creatorWallet: string;
  startDate?: string;
  endDate?: string;
  requestedBy: string;
}

export interface StaleDisputeCleanupPayload extends BaseJobPayload {
  version: 1;
  olderThanDays: number;
  dryRun?: boolean;
}

export interface RetentionCleanupPayload extends BaseJobPayload {
  version: 1;
  dryRun?: boolean;
}

export interface ArchivedExportPayload extends BaseJobPayload {
  version: 1;
  archived: true;
}

export interface StaleCacheRepairPayload extends BaseJobPayload {
  version: 1;
  dryRun?: boolean;
  promptId?: string;
  sourceVersion?: string | number;
  maxEntries?: number;
}

export type JobPayload =
  | SettlementPollPayload
  | EntitlementRepairPayload
  | AnalyticsAggregatePayload
  | ExportCsvPayload
  | StaleDisputeCleanupPayload
  | RetentionCleanupPayload
  | ArchivedExportPayload
  | StaleCacheRepairPayload;

export type JobType =
  | "settlement_poll"
  | "entitlement_repair"
  | "analytics_aggregate"
  | "export_csv"
  | "stale_dispute_cleanup"
  | "retention_cleanup"
  | "stale_cache_repair";

/** Status values a job may hold. `cancel_requested` = cancel signalled while processing. */
export type JobStatus =
  | "pending"
  | "processing"
  | "completed"
  | "failed"
  | "cancel_requested"
  | "cancelled";

export interface EnqueueOptions {
  maxAttempts?: number;
  delayMs?: number;
  dedupeKey?: string;
  dedupeWindowMs?: number;
  /**
   * Per-enqueue admission ceiling for this job type (pending + processing).
   * Defaults to the type's configured limit; see jobQueue.ts. Useful for
   * tests and for callers with a tighter budget than the global default.
   */
  maxPending?: number;
}

/** Request to cancel a job. `requestedBy` is the wallet asking for cancellation. */
export interface CancelJobRequest {
  jobId: string;
  requestedBy: string;
  isAdmin?: boolean;
}

export type CancelJobResult =
  | { ok: true; jobId: string; status: JobStatus }
  | { ok: false; reason: "not_found" | "forbidden" | "already_terminal" };

/**
 * Ownership used for authorization of cancellation. Returns the wallet that owns
 * a job, or null when the job has no owner (platform-wide jobs: admin-only).
 */
export function getJobOwner(payload: JobPayload): string | null {
  switch (payload.version) {
    case 1:
      if ("requestedBy" in payload) return payload.requestedBy;
      if ("creatorWallet" in payload && payload.creatorWallet) return payload.creatorWallet;
      if ("buyerWallet" in payload) return payload.buyerWallet;
      return null;
    default:
      return null;
  }
}

/** Authorization: owner or admin may cancel; ownerless jobs are admin-only. */
export function canCancelJob(
  payload: JobPayload,
  requestedBy: string,
  isAdmin = false,
): boolean {
  if (isAdmin) return true;
  const owner = getJobOwner(payload);
  return owner !== null && owner === requestedBy;
}

/** Statuses from which no further transition is possible. */
export function isTerminalStatus(status: JobStatus): boolean {
  return status === "completed" || status === "failed" || status === "cancelled";
}

export interface JobRecordDTO {
  id: string;
  type: JobType;
  status: string;
  payload: JobPayload;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  nextRunAt: Date;
  createdAt: Date;
  archivedAt?: Date | null;
}
