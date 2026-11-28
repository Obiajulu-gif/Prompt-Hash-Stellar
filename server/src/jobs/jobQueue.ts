/**
 * Background job queue — enqueue, retry with backoff, dead-letter, observability.
 *
 * Requirements:
 * - Jobs can be enqueued, retried, and observed.
 * - Failed jobs do not silently disappear — after maxAttempts they go to dead_letter.
 * - Retry uses exponential backoff: delay = baseDelay * 2^(attempt-1) (deterministic for tests).
 * - Idempotency via dedupeKey: enqueue with same key within window returns existing job.
 * - Payloads are small and versioned (see types.ts).
 * - Avoid long-running work in request handlers — enqueue instead.
 */

import crypto from "crypto";
import JobRecord from "../models/JobRecord";
import type { JobType, JobPayload, EnqueueOptions, JobRecordDTO } from "./types";

const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_BASE_DELAY_MS = 1000;
const DEFAULT_DEDUPE_WINDOW_MS = 60_000;

/**
 * Admission ceilings for expensive background work (#1009).
 *
 * Every queued job consumes worker time, database connections, and downstream
 * capacity. A request burst that enqueues thousands of exports or analytics
 * runs must get a fast, retryable rejection instead of growing the queue
 * without bound and starving settlement work.
 *
 * Limits count `pending` + `processing` jobs per type. Settlement and
 * entitlement repairs keep generous ceilings because they are the critical
 * path; expensive reporting/cleanup work is deliberately tighter.
 *
 * Override per environment:
 *   JOB_QUEUE_MAX_PENDING_EXPORT_CSV=10
 *   JOB_QUEUE_MAX_PENDING_ANALYTICS_AGGREGATE=25
 *
 * A value of 0 disables the ceiling for that type (not recommended in
 * production; documented for controlled maintenance windows).
 */
export const DEFAULT_MAX_PENDING_BY_TYPE: Record<JobType, number> = {
  settlement_poll: 1_000,
  entitlement_repair: 500,
  analytics_aggregate: 50,
  export_csv: 25,
  stale_dispute_cleanup: 10,
  retention_cleanup: 5,
  stale_cache_repair: 50,
};

export interface QueuePressure {
  type: JobType;
  limit: number;
  pending: number;
  processing: number;
  total: number;
  saturated: boolean;
  /** Suggested client retry delay when saturated. */
  retryAfterMs: number;
}

export class QueueBackpressureError extends Error {
  readonly code = "queue_backpressure";
  readonly httpStatus = 429;
  readonly type: JobType;
  readonly limit: number;
  readonly pending: number;
  readonly processing: number;
  readonly retryAfterMs: number;

  constructor(pressure: QueuePressure) {
    super(
      `Queue for ${pressure.type} is at capacity (${pressure.total}/${pressure.limit} pending+processing). Retry after ${pressure.retryAfterMs}ms.`,
    );
    this.name = "QueueBackpressureError";
    this.type = pressure.type;
    this.limit = pressure.limit;
    this.pending = pressure.pending;
    this.processing = pressure.processing;
    this.retryAfterMs = pressure.retryAfterMs;
  }
}

function positiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

export function maxPendingForType(type: JobType, env: NodeJS.ProcessEnv = process.env): number {
  const key = `JOB_QUEUE_MAX_PENDING_${type.toUpperCase()}`;
  return positiveInteger(env[key], DEFAULT_MAX_PENDING_BY_TYPE[type] ?? 50);
}

const MIN_RETRY_AFTER_MS = 1_000;

/** Current depth and saturation state for one job type. */
export async function getQueuePressure(
  type: JobType,
  limit = maxPendingForType(type),
): Promise<QueuePressure> {
  const [rows, next] = await Promise.all([
    JobRecord.aggregate([
      { $match: { type, status: { $in: ["pending", "processing"] } } },
      { $group: { _id: "$status", count: { $sum: 1 } } },
    ]),
    JobRecord.findOne({ type, status: "pending" })
      .sort({ nextRunAt: 1 })
      .select("nextRunAt")
      .lean(),
  ]);

  let pending = 0;
  let processing = 0;
  for (const row of rows as Array<{ _id: string; count: number }>) {
    if (row._id === "pending") pending = row.count;
    if (row._id === "processing") processing = row.count;
  }
  const total = pending + processing;

  let retryAfterMs = MIN_RETRY_AFTER_MS;
  if (limit > 0 && total >= limit && next?.nextRunAt) {
    const wait = new Date(next.nextRunAt).getTime() - Date.now();
    retryAfterMs = Math.max(MIN_RETRY_AFTER_MS, wait);
  }

  return {
    type,
    limit,
    pending,
    processing,
    total,
    saturated: limit > 0 && total >= limit,
    retryAfterMs,
  };
}

/**
 * Throw a retryable 429 when admitting another job would exceed the type's
 * ceiling. Admission is a database count, so it is self-healing after a
 * worker restart (no leaked in-memory semaphore). Two processes can race in
 * the tiny window between count and insert; the ceiling is therefore a
 * strict serial bound and a best-effort concurrent bound. Workers additionally
 * drain at their own concurrency, so an overshoot cannot grow without limit.
 */
export async function assertQueueCapacity(
  type: JobType,
  options: { maxPending?: number } = {},
): Promise<QueuePressure> {
  const limit = options.maxPending ?? maxPendingForType(type);
  if (!Number.isSafeInteger(limit) || limit < 0) {
    throw new RangeError("maxPending must be a non-negative safe integer");
  }
  const pressure = await getQueuePressure(type, limit);
  if (pressure.saturated) throw new QueueBackpressureError(pressure);
  return pressure;
}

function toDto(doc: any): JobRecordDTO {
  return {
    id: String(doc._id),
    type: doc.type,
    status: doc.status,
    payload: doc.payload,
    attempts: doc.attempts,
    maxAttempts: doc.maxAttempts,
    lastError: doc.lastError,
    nextRunAt: doc.nextRunAt,
    createdAt: doc.createdAt,
    archivedAt: doc.archivedAt ?? null,
  };
}

function hashPayload(payload: JobPayload): string {
  return crypto.createHash("sha256").update(JSON.stringify(payload)).digest("hex").slice(0, 16);
}

export function computeBackoffDelayMs(attempt: number, baseDelayMs = DEFAULT_BASE_DELAY_MS): number {
  // Deterministic exponential backoff, no random jitter (keeps tests stable).
  // attempt is 1-indexed for the retry that just failed.
  return baseDelayMs * Math.pow(2, Math.max(0, attempt - 1));
}

export async function enqueueJob(
  type: JobType,
  payload: JobPayload,
  options: EnqueueOptions = {}
): Promise<JobRecordDTO> {
  if (!payload || typeof payload.version !== "number") {
    throw new Error("Job payload must be versioned with a numeric `version` field.");
  }
  const payloadJson = JSON.stringify(payload);
  if (payloadJson.length > 4096) {
    throw new Error(`Job payload too large: ${payloadJson.length} bytes > 4096 (keep payloads small and versioned).`);
  }

  const dedupeKey = options.dedupeKey ?? `${type}:${hashPayload(payload)}`;
  const dedupeWindowMs = options.dedupeWindowMs ?? DEFAULT_DEDUPE_WINDOW_MS;

  // Idempotency: if a pending/processing job with same dedupeKey was created
  // within the window, return it instead of duplicating.
  if (dedupeKey) {
    const since = new Date(Date.now() - dedupeWindowMs);
    const existing = await JobRecord.findOne({
      type,
      dedupeKey,
      status: { $in: ["pending", "processing"] },
      createdAt: { $gte: since },
    }).sort({ createdAt: -1 });
    if (existing) {
      // A retry of an already queued job is never rejected by backpressure;
      // returning the existing id is what makes callers' retries idempotent.
      return toDto(existing);
    }
  }

  await assertQueueCapacity(type, { maxPending: options.maxPending });

  const maxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
  const delayMs = options.delayMs ?? 0;
  const nextRunAt = new Date(Date.now() + delayMs);

  const doc = await JobRecord.create({
    type,
    status: "pending",
    payload,
    payloadVersion: payload.version,
    dedupeKey,
    attempts: 0,
    maxAttempts,
    lastError: null,
    nextRunAt,
  });

  return toDto(doc);
}

export async function getJobById(id: string): Promise<JobRecordDTO | null> {
  const doc = await JobRecord.findById(id);
  return doc ? toDto(doc) : null;
}

export async function listJobs(filter: { status?: string; type?: JobType; limit?: number } = {}): Promise<JobRecordDTO[]> {
  const query: any = {};
  if (filter.status) query.status = filter.status;
  if (filter.type) query.type = filter.type;
  const docs = await JobRecord.find(query).sort({ createdAt: -1, _id: -1 }).limit(filter.limit ?? 50);
  return docs.map(toDto);
}

export async function getDeadLetterJobs(limit = 50): Promise<JobRecordDTO[]> {
  return listJobs({ status: "dead_letter", limit });
}

/**
 * Claim the next due job (atomically). Uses findOneAndUpdate with status/nextRunAt.
 * `workerId` is for observability / leasing.
 */
export async function claimNextJob(workerId: string): Promise<JobRecordDTO | null> {
  const now = new Date();
  const doc = await JobRecord.findOneAndUpdate(
    {
      status: "pending",
      nextRunAt: { $lte: now },
    },
    {
      $set: { status: "processing", lockedAt: now, lockedBy: workerId },
    },
    { sort: { nextRunAt: 1, createdAt: 1 }, new: true }
  );
  return doc ? toDto(doc) : null;
}

export async function markJobCompleted(id: string): Promise<void> {
  await JobRecord.findByIdAndUpdate(id, {
    $set: { status: "completed", completedAt: new Date(), lastError: null },
  });
}

export async function markJobFailed(
  id: string,
  error: string,
  opts: { baseDelayMs?: number } = {}
): Promise<JobRecordDTO> {
  const doc = await JobRecord.findById(id);
  if (!doc) throw new Error(`Job ${id} not found`);
  const attempts = doc.attempts + 1;
  const willRetry = attempts < doc.maxAttempts;

  if (willRetry) {
    const delayMs = computeBackoffDelayMs(attempts, opts.baseDelayMs);
    const nextRunAt = new Date(Date.now() + delayMs);
    const updated = await JobRecord.findByIdAndUpdate(
      id,
      {
        $set: {
          status: "pending",
          lastError: String(error).slice(0, 2000),
          nextRunAt,
          lockedAt: null,
          lockedBy: null,
        },
        $inc: { attempts: 1 },
        $push: { attemptHistory: { attempt: attempts, at: new Date(), error: String(error).slice(0, 500) } },
      },
      { new: true }
    );
    // Trim history to last 10
    if (updated && updated.attemptHistory.length > 10) {
      updated.attemptHistory = updated.attemptHistory.slice(-10);
      await updated.save();
    }
    return toDto(updated!);
  } else {
    // Dead-letter: do not silently disappear
    const updated = await JobRecord.findByIdAndUpdate(
      id,
      {
        $set: {
          status: "dead_letter",
          lastError: String(error).slice(0, 2000),
          lockedAt: null,
          lockedBy: null,
        },
        $inc: { attempts: 1 },
        $push: { attemptHistory: { attempt: attempts, at: new Date(), error: String(error).slice(0, 500) } },
      },
      { new: true }
    );
    if (updated && updated.attemptHistory.length > 10) {
      updated.attemptHistory = updated.attemptHistory.slice(-10);
      await updated.save();
    }
    return toDto(updated!);
  }
}

export async function requeueDeadLetter(id: string): Promise<JobRecordDTO> {
  const doc = await JobRecord.findById(id);
  if (!doc) throw new Error(`Job ${id} not found`);
  if (doc.status !== "dead_letter") throw new Error(`Job ${id} is not dead_letter (status=${doc.status})`);
  if (doc.archivedAt) throw new Error(`Job ${id} is archived and cannot be requeued`);
  const updated = await JobRecord.findByIdAndUpdate(
    id,
    { $set: { status: "pending", nextRunAt: new Date(), lastError: null, attempts: 0, lockedAt: null, lockedBy: null } },
    { new: true }
  );
  return toDto(updated!);
}

// ── Helpers for tests / observability ───────────────────────────────────────

export async function countJobsByStatus(): Promise<Record<string, number>> {
  const agg = await JobRecord.aggregate([{ $group: { _id: "$status", count: { $sum: 1 } } }]);
  const out: Record<string, number> = {};
  for (const row of agg) out[row._id] = row.count;
  return out;
}
