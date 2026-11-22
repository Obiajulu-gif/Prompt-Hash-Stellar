import { createHash } from "crypto";
import { canonicalJson } from "./canonicalSerialization";
import IdempotencyRecord, {
  type IIdempotencyRecord,
  type IdempotencyRecordStatus,
} from "../models/IdempotencyRecord";

export const IDEMPOTENCY_RETENTION_MS = 24 * 60 * 60 * 1_000;

export type IdempotencyDecision =
  | { kind: "new"; record: IIdempotencyRecord }
  | { kind: "replay"; record: IIdempotencyRecord }
  | { kind: "conflict"; message: string }
  | { kind: "expired"; message: string }
  | { kind: "in_progress"; message: string };

/**
 * Request digest over the shared canonical serializer (#979). An undefined
 * body keeps its historical "undefined" token so digests already stored for
 * in-flight keys still match on replay.
 */
export function hashIdempotentRequest(input: {
  method: string;
  scope: string;
  body: unknown;
}): string {
  const body = input.body === undefined ? "undefined" : canonicalJson(input.body);
  return createHash("sha256")
    .update(`${input.method.toUpperCase()}\n${input.scope}\n${body}`)
    .digest("hex");
}

/**
 * Duplicate-submission concurrency model (covered by idempotencyService tests):
 *  - normal:        first insert returns `new`; the operation runs once.
 *  - failure:       a completed non-2xx/3xx response is stored as `failed` and replayed.
 *  - retry:         a retry after success replays the cached response; no re-execution.
 *  - authorization: the scope is part of the unique key, so one principal's key
 *                   can never be replayed to another scope.
 *  - edge cases:    same key + different payload -> conflict; expired TTL -> expired;
 *                   stuck `processing` -> in_progress until TTL lapses.
 * Rollback: no schema change is introduced here; existing records remain valid.
 */
export function validateIdempotencyKey(key: string | undefined): string | null {
  if (!key) return "Idempotency-Key header is required for this operation.";
  if (key.length > 255 || /[\r\n]/.test(key)) {
    return "Idempotency-Key must be at most 255 characters and contain no line breaks.";
  }
  return null;
}

/**
 * Claims an idempotency key for a request.
 *
 * Concurrency model: the unique index on (scope, key) is the sole gate. The
 * first writer to insert wins and receives `new`; every other concurrent
 * attempt receives a duplicate-key error and is resolved against the stored
 * record:
 *   - different requestHash        -> conflict (never replayed)
 *   - expiresAt <= now             -> expired (caller must mint a new key)
 *   - status "processing"          -> in_progress (caller should back off/retry)
 *   - succeeded / failed           -> replay (cached response returned)
 *
 * Recovery: a record stuck in "processing" (e.g. the worker crashed before
 * completeIdempotentRequest) is NOT auto-released here; it stays in_progress
 * until its TTL lapses, after which the key reports expired. Callers must not
 * retry the side effect under the same key while in_progress.
 */
export async function beginIdempotentRequest(input: {
  scope: string;
  key: string;
  requestHash: string;
  now?: Date;
  retentionMs?: number;
}): Promise<IdempotencyDecision> {
  const now = input.now ?? new Date();
  const expiresAt = new Date(now.getTime() + (input.retentionMs ?? IDEMPOTENCY_RETENTION_MS));

  try {
    const record = await IdempotencyRecord.create({
      scope: input.scope,
      key: input.key,
      requestHash: input.requestHash,
      status: "processing",
      expiresAt,
    });
    return { kind: "new", record };
  } catch (error: unknown) {
    if ((error as { code?: number }).code !== 11000) throw error;
  }

  const existing = await IdempotencyRecord.findOne({ scope: input.scope, key: input.key });
  if (!existing) {
    // A concurrent insert can become visible just after the duplicate error.
    // Let the caller retry rather than execute without a durable gate.
    throw new Error("Idempotency record could not be read after a duplicate-key error.");
  }
  if (existing.requestHash !== input.requestHash) {
    return {
      kind: "conflict",
      message: "This Idempotency-Key was already used with a different request payload.",
    };
  }
  if (existing.expiresAt.getTime() <= now.getTime()) {
    return {
      kind: "expired",
      message: "This Idempotency-Key has expired. Generate a new key and retry.",
    };
  }
  if (existing.status === "processing") {
    return {
      kind: "in_progress",
      message: "An identical request with this Idempotency-Key is still in progress.",
    };
  }
  return { kind: "replay", record: existing };
}

export async function completeIdempotentRequest(input: {
  recordId: unknown;
  statusCode: number;
  responseBody: unknown;
}): Promise<void> {
  const status: IdempotencyRecordStatus =
    input.statusCode >= 200 && input.statusCode < 400 ? "succeeded" : "failed";
  // Only transition records that are still "processing" so a late or duplicate
  // completion cannot overwrite an already-finalized response.
  await IdempotencyRecord.updateOne(
    { _id: input.recordId, status: "processing" },
    {
      $set: {
        status,
        statusCode: input.statusCode,
        responseBody: input.responseBody ?? null,
      },
    },
  );
}

export function replayStatus(record: IIdempotencyRecord): number {
  return record.statusCode ?? (record.status === "succeeded" ? 200 : 500);
}
