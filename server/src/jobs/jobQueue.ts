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
      return toDto(existing);
    }
  }

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
  const docs = await JobRecord.find(query).sort({ createdAt: -1 }).limit(filter.limit ?? 50);
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
