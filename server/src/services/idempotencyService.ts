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

export function validateIdempotencyKey(key: string | undefined): string | null {
  if (!key) return "Idempotency-Key header is required for this operation.";
  if (key.length > 255 || /[\r\n]/.test(key)) {
    return "Idempotency-Key must be at most 255 characters and contain no line breaks.";
  }
  return null;
}

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
  await IdempotencyRecord.findByIdAndUpdate(input.recordId, {
    $set: {
      status,
      statusCode: input.statusCode,
      responseBody: input.responseBody ?? null,
    },
  });
}

export function replayStatus(record: IIdempotencyRecord): number {
  return record.statusCode ?? (record.status === "succeeded" ? 200 : 500);
}
