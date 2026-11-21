/**
 * Deduplication classification for notifications and webhooks (#1223).
 *
 * The repository already guarantees "deliver once" with unique indexes:
 * `Notification.(recipientWallet, type, dedupeKey)`,
 * `InboundWebhookEvent.idempotencyKey` and
 * `WebhookOutboxEvent.(subscriptionId, dedupeKey)`. Those indexes answer
 * "have I seen this key?" but not "is this the same event?".
 *
 * This module adds the missing half: a content fingerprint and a pure
 * classification of a repeated delivery. A repeat with the same fingerprint is
 * a benign duplicate. A repeat that reuses the key with different content is a
 * *conflict* — silently swallowing it hides a producer bug or a replay attack,
 * so the caller refuses it and records the conflict. Failed deliveries remain
 * retryable until their attempt budget is spent.
 *
 * The fingerprint is a SHA-256 over a canonicalized, key-ordered JSON
 * projection. Volatile fields (timestamps, attempt counters, leases) are never
 * part of it, so retries fingerprint identically while genuinely different
 * payloads do not.
 */

import { createHash } from "crypto";

export type DeduplicationMode = "notification" | "webhook";

export type DeduplicationStatus =
  | "new"
  | "duplicate"
  | "conflict"
  | "retry"
  | "permanent_failure";

export interface DeduplicationVerdict {
  status: DeduplicationStatus;
  /** Human-readable, log-safe explanation. Never includes payload content. */
  reason: string;
  /** True only when a caller may safely try the delivery again. */
  retryable: boolean;
}

export interface ExistingDeduplicationRecord {
  /** Fingerprint of the first delivery, when it was recorded. */
  fingerprint?: string | null;
  /** Existing lifecycle status: processed/delivered/failed/pending/... */
  status?: string | null;
  attempts?: number | null;
  /** Start of the current in-flight attempt, for lease recovery. */
  lastAttemptAt?: Date | number | null;
}

export interface ClassifyDeduplicationInput {
  fingerprint: string;
  now?: number;
  /** In-flight attempts older than this are considered abandoned. */
  inFlightTtlMs?: number;
  /** Attempt budget for a failed delivery. */
  maxAttempts?: number;
}

export const DEDUPE_IN_FLIGHT_TTL_MS = 5 * 60 * 1000;
export const DEDUPE_MAX_ATTEMPTS = 8;

/**
 * Canonical JSON: object keys sorted recursively, arrays preserved. Values
 * must be JSON-serializable; `undefined` members are dropped like JSON does.
 */
function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort();
  return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(",")}}`;
}

/** Stable SHA-256 fingerprint of the fields that identify one logical event. */
export function fingerprintDeduplicationPayload(parts: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(parts), "utf8").digest("hex");
}

/** Scoped key for an in-app notification. Lower-cases the recipient wallet. */
export function buildNotificationDedupeKey(input: {
  recipientWallet: string;
  type: string;
  dedupeKey: string;
}): string {
  return [
    "notification",
    input.recipientWallet.trim().toLowerCase(),
    input.type.trim(),
    input.dedupeKey.trim(),
  ].join(":");
}

/** Scoped key for one inbound webhook delivery. */
export function buildWebhookDedupeKey(input: {
  source: string;
  eventType: string;
  idempotencyKey: string;
}): string {
  return [
    "webhook",
    input.source.trim().toLowerCase(),
    input.eventType.trim(),
    input.idempotencyKey.trim(),
  ].join(":");
}

/**
 * Fingerprint a notification's user-visible content. Delivery metadata (read
 * flag, channels, leases) is excluded so a redelivery of the same content is a
 * duplicate rather than a conflict.
 */
export function fingerprintNotification(input: {
  type: string;
  message: string;
  promptId?: string | null;
  promptTitle?: string | null;
  versionIndex?: number | null;
}): string {
  return fingerprintDeduplicationPayload({
    kind: "notification",
    type: input.type,
    message: input.message,
    promptId: input.promptId ?? "",
    promptTitle: input.promptTitle ?? "",
    versionIndex: input.versionIndex ?? 0,
  });
}

/** Fingerprint an inbound webhook from the exact bytes the producer signed. */
export function fingerprintInboundWebhook(input: {
  eventType: string;
  source: string;
  rawBody: string;
}): string {
  return fingerprintDeduplicationPayload({
    kind: "webhook",
    eventType: input.eventType,
    source: input.source,
    body: input.rawBody,
  });
}

function isTerminalStatus(status: string | null | undefined): boolean {
  return status === "processed" || status === "delivered" || status === "skipped";
}

function isFailedStatus(status: string | null | undefined): boolean {
  return status === "failed" || status === "dead_letter";
}

/**
 * Classify a repeated delivery against the record of the first one.
 *
 * Decision order:
 *   1. no existing record              → new
 *   2. different fingerprint           → conflict (never retry)
 *   3. terminal status                 → duplicate
 *   4. failed with budget left         → retry
 *   5. failed with budget exhausted    → permanent_failure
 *   6. in-flight within its lease      → duplicate
 *   7. in-flight lease expired         → retry
 *
 * A legacy record without a fingerprint is treated as a duplicate when it is
 * terminal (preserving pre-existing behaviour) and retryable when failed.
 */
export function classifyDeduplication(
  existing: ExistingDeduplicationRecord | null | undefined,
  input: ClassifyDeduplicationInput,
): DeduplicationVerdict {
  if (!existing) {
    return { status: "new", reason: "No prior delivery for this key.", retryable: true };
  }

  if (
    typeof existing.fingerprint === "string" &&
    existing.fingerprint.length > 0 &&
    existing.fingerprint !== input.fingerprint
  ) {
    return {
      status: "conflict",
      reason:
        "The idempotency key was already used with a different payload. Treat this as a producer bug or a replay attempt.",
      retryable: false,
    };
  }

  if (isTerminalStatus(existing.status)) {
    return {
      status: "duplicate",
      reason: "The delivery already completed for this key.",
      retryable: false,
    };
  }

  const attempts = Number.isFinite(existing.attempts) ? Number(existing.attempts) : 0;
  const maxAttempts = input.maxAttempts ?? DEDUPE_MAX_ATTEMPTS;

  if (isFailedStatus(existing.status)) {
    if (attempts >= maxAttempts) {
      return {
        status: "permanent_failure",
        reason: `The delivery failed ${attempts} time(s), reaching the attempt budget.`,
        retryable: false,
      };
    }
    return {
      status: "retry",
      reason: "The previous attempt failed and the attempt budget is not spent.",
      retryable: true,
    };
  }

  const now = input.now ?? Date.now();
  const lastAttemptAt =
    existing.lastAttemptAt instanceof Date
      ? existing.lastAttemptAt.getTime()
      : typeof existing.lastAttemptAt === "number"
        ? existing.lastAttemptAt
        : null;
  const inFlightTtlMs = input.inFlightTtlMs ?? DEDUPE_IN_FLIGHT_TTL_MS;

  if (lastAttemptAt !== null && now - lastAttemptAt > inFlightTtlMs) {
    return {
      status: "retry",
      reason: "The previous attempt appears abandoned; its in-flight lease has expired.",
      retryable: true,
    };
  }

  return {
    status: "duplicate",
    reason: "An attempt for this key is already in flight.",
    retryable: false,
  };
}

/** Result of the notification-specific duplicate check. */
export interface NotificationDuplicateVerdict {
  duplicate: boolean;
  conflict: boolean;
  reason: string;
}

/**
 * Decide how to treat a notification that collided on its unique dedupe key.
 * `existing` is the stored row; only a non-empty stored message is comparable,
 * so legacy rows without content are treated as ordinary duplicates.
 */
export function classifyNotificationCollision(input: {
  incoming: {
    recipientWallet: string;
    type: string;
    message: string;
    promptId?: string | null;
    promptTitle?: string | null;
    versionIndex?: number | null;
  };
  existing:
    | {
        message?: string | null;
        promptId?: string | null;
        promptTitle?: string | null;
        versionIndex?: number | null;
      }
    | null
    | undefined;
}): NotificationDuplicateVerdict {
  if (!input.existing || typeof input.existing.message !== "string" || !input.existing.message) {
    return {
      duplicate: true,
      conflict: false,
      reason: "A stored notification already owns this dedupe key.",
    };
  }

  const incomingFingerprint = fingerprintNotification(input.incoming);
  const existingFingerprint = fingerprintNotification({
    type: input.incoming.type,
    message: input.existing.message,
    promptId: input.existing.promptId,
    promptTitle: input.existing.promptTitle,
    versionIndex: input.existing.versionIndex,
  });

  if (incomingFingerprint !== existingFingerprint) {
    return {
      duplicate: true,
      conflict: true,
      reason: "The dedupe key was reused with different notification content.",
    };
  }

  return {
    duplicate: true,
    conflict: false,
    reason: "The identical notification was already delivered.",
  };
}

/** Explains a verdict to an operator without exposing payload content. */
export function deduplicationRemedy(status: DeduplicationStatus): string {
  switch (status) {
    case "new":
      return "Proceed with delivery.";
    case "duplicate":
      return "No action: the logical event was already delivered. Do not resend.";
    case "conflict":
      return "Reject the delivery and investigate the producer: the idempotency key was reused with different content.";
    case "retry":
      return "Retry with the same idempotency key; the original attempt did not complete.";
    case "permanent_failure":
      return "Reconcile the failed delivery, then replay it from the dead-letter queue with a new attempt budget.";
  }
}
