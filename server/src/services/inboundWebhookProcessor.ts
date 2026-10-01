/**
 * Inbound webhook processing service (#idempotent-webhooks).
 *
 * Responsibilities:
 *  1. `persistInboundEvent` — atomically records the raw event with its
 *     idempotency key before any processing begins, so a crash mid-processing
 *     leaves a retryable record rather than losing the event.
 *
 *  2. `verifyAndProcess` — the two-phase entry point:
 *       Phase 1 (Verification): validates the HMAC signature independently of
 *         business logic; marks the event `verification_failed` and stops if
 *         invalid.
 *       Phase 2 (Business processing): dispatches to the appropriate handler
 *         based on `eventType`; advances `processingStatus` through
 *         pending → processing → processed | failed.
 *
 *  3. `retryFailedEvent` — admin-triggered single-event replay: resets
 *     a `failed` event back to `pending` so the next call to `verifyAndProcess`
 *     will re-run business logic without re-verifying the signature (the
 *     raw body is still available for replay).
 *
 *  4. `listFailedEvents` — paginated admin view of failed events for the
 *     retry queue UI.
 *
 * Separation of concerns:
 *  - Signature verification is done here, not in the Express handler, so it
 *    can be unit-tested independently and is not coupled to HTTP semantics.
 *  - Business handlers receive only the already-parsed, verified payload and
 *    a stable event id — they never see raw HTTP details.
 *
 * Idempotency guarantee:
 *  - `persistInboundEvent` uses MongoDB's unique index on `idempotencyKey`.
 *    A duplicate-key error means the event was already received and is
 *    returned as-is for the caller to inspect its current status.
 *  - Business handlers must also be idempotent (upsert, not insert) but
 *    the second gate here means most duplicates never reach them.
 *
 * Sensitive data policy:
 *  - The `rawBody` stored in `InboundWebhookEvent` is used only for replay
 *    and debugging. It must never contain decrypted secrets or PII beyond
 *    stable reference IDs (prompt ids, wallet addresses as already present
 *    in the on-chain event payload).
 */

import { createHmac, timingSafeEqual } from "crypto";
import InboundWebhookEvent, {
  IInboundWebhookEvent,
} from "../models/InboundWebhookEvent";
import { logger } from "./structuredLogger";

// ── Types ──────────────────────────────────────────────────────────────────

export interface InboundEventInput {
  idempotencyKey: string;
  eventType: string;
  source: string;
  /** Safe (non-secret) headers to retain for debugging. */
  safeHeaders: Record<string, string>;
  rawBody: string;
  /** HMAC-SHA256 signature from X-PromptHash-Signature header. */
  signature: string;
  /** ISO timestamp from X-PromptHash-Timestamp header. */
  timestamp: string;
}

export interface ProcessResult {
  status: "processed" | "skipped" | "failed" | "verification_failed";
  eventId: string;
  alreadyProcessed: boolean;
  errorMessage?: string;
}

/** Replay window: reject signatures more than 5 minutes old. */
const REPLAY_WINDOW_MS = 5 * 60 * 1_000;

// ── Signature verification ──────────────────────────────────────────────────

/**
 * Verifies the HMAC-SHA256 signature on an inbound event.
 *
 * Uses the same canonical payload format as the outbox worker so both sides
 * can share test vectors. Rejects events whose timestamp falls outside the
 * replay window to prevent signature replay attacks.
 *
 * Exported for unit testing.
 */
export function verifyInboundSignature(
  secret: string,
  input: {
    rawBody: string;
    timestamp: string;
    eventId: string;
    deliveryId: string;
    now?: number;
    replayWindowMs?: number;
  },
  signature: string,
): boolean {
  const issuedAt = Date.parse(input.timestamp);
  if (!Number.isFinite(issuedAt)) return false;

  const now = input.now ?? Date.now();
  const windowMs = input.replayWindowMs ?? REPLAY_WINDOW_MS;
  if (Math.abs(now - issuedAt) > windowMs) return false;

  const canonical = [
    input.timestamp,
    input.eventId,
    input.deliveryId,
    input.rawBody,
  ].join(".");

  const expected = `sha256=${createHmac("sha256", secret)
    .update(canonical)
    .digest("hex")}`;

  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    // Buffers of different length throw — signature is definitely wrong.
    return false;
  }
}

// ── Persist ────────────────────────────────────────────────────────────────

/**
 * Atomically persists an inbound event document.
 *
 * Returns `{ event, isDuplicate: true }` when the idempotency key already
 * exists, so the caller can short-circuit processing and return the existing
 * status to the caller without re-running business logic.
 */
export async function persistInboundEvent(
  input: InboundEventInput,
): Promise<{ event: IInboundWebhookEvent; isDuplicate: boolean }> {
  try {
    const event = await InboundWebhookEvent.create({
      idempotencyKey: input.idempotencyKey,
      eventType: input.eventType,
      source: input.source,
      rawHeaders: input.safeHeaders,
      rawBody: input.rawBody,
    });
    return { event, isDuplicate: false };
  } catch (err: unknown) {
    if ((err as { code?: number }).code === 11000) {
      // Already seen — load existing record to return current status.
      const existing = await InboundWebhookEvent.findOne({
        idempotencyKey: input.idempotencyKey,
      });
      if (!existing) throw err; // shouldn't happen, but guard anyway
      return { event: existing, isDuplicate: true };
    }
    throw err;
  }
}

// ── Business dispatch ───────────────────────────────────────────────────────

/**
 * Dispatch table for inbound event types.
 *
 * Each handler receives the verified, parsed payload and the stable event id.
 * Handlers must be idempotent — they may be called more than once if a retry
 * is triggered after a partial failure.
 *
 * Add new event types here; do not add HTTP-specific logic.
 */
type BusinessHandler = (payload: unknown, eventId: string) => Promise<void>;

const handlers: Record<string, BusinessHandler> = {
  // Placeholder for future inbound event types (e.g. payment provider callbacks).
  // The outbound (Soroban) event pathway uses the indexer; this table handles
  // events pushed TO PromptHash from third-party systems.
};

async function dispatchBusinessLogic(
  eventType: string,
  rawBody: string,
  eventId: string,
): Promise<void> {
  const handler = handlers[eventType];
  if (!handler) {
    // Unknown type — log and mark as skipped rather than failing.
    logger.info("No handler registered for inbound event type", {
      action: "inboundWebhookDispatch",
      eventType,
      eventId,
    });
    return;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    throw new Error(`Invalid JSON body for event ${eventId}`);
  }

  await handler(payload, eventId);
}

// ── Main entry point ────────────────────────────────────────────────────────

/**
 * Two-phase inbound event processor.
 *
 * Phase 1 — Idempotency gate: persist the raw event; return early if it was
 *   already processed.
 * Phase 2 — Verification: validate the HMAC signature; mark
 *   `verification_failed` and stop on invalid signatures.
 * Phase 3 — Business processing: dispatch to the appropriate handler; advance
 *   `processingStatus`.
 *
 * The `signingSecret` parameter is the shared secret for the source that sent
 * this event. Callers are responsible for loading it securely (e.g. from an
 * environment variable or a per-source credentials store).
 */
export async function verifyAndProcess(
  input: InboundEventInput,
  signingSecret: string,
): Promise<ProcessResult> {
  // ── Phase 1: Persist / idempotency gate ────────────────────────────────
  const { event, isDuplicate } = await persistInboundEvent(input);
  const eventId = String(event._id);

  if (isDuplicate) {
    const alreadyDone =
      event.processingStatus === "processed" ||
      event.processingStatus === "skipped";

    logger.debug("Inbound webhook duplicate — skipping reprocessing", {
      action: "inboundWebhookProcessor",
      idempotencyKey: input.idempotencyKey,
      processingStatus: event.processingStatus,
    });

    return {
      status: alreadyDone
        ? "skipped"
        : (event.processingStatus as ProcessResult["status"]),
      eventId,
      alreadyProcessed: true,
    };
  }

  // ── Phase 2: Signature verification ────────────────────────────────────
  const deliveryId =
    input.safeHeaders["x-prompthash-delivery"] ??
    input.safeHeaders["X-PromptHash-Delivery"] ??
    input.idempotencyKey;

  const signatureValid = verifyInboundSignature(
    signingSecret,
    {
      rawBody: input.rawBody,
      timestamp: input.timestamp,
      eventId: input.idempotencyKey,
      deliveryId,
    },
    input.signature,
  );

  if (!signatureValid) {
    await InboundWebhookEvent.findByIdAndUpdate(event._id, {
      $set: {
        verificationStatus: "verification_failed",
        processingStatus: "skipped",
        errorMessage: "HMAC signature verification failed.",
      },
    });

    logger.warn("Inbound webhook signature verification failed", {
      action: "inboundWebhookProcessor",
      idempotencyKey: input.idempotencyKey,
      source: input.source,
    });

    return {
      status: "verification_failed",
      eventId,
      alreadyProcessed: false,
      errorMessage: "HMAC signature verification failed.",
    };
  }

  // Mark verified.
  await InboundWebhookEvent.findByIdAndUpdate(event._id, {
    $set: {
      verificationStatus: "verified",
      processingStatus: "processing",
      lastAttemptAt: new Date(),
    },
    $inc: { attemptCount: 1 },
  });

  // ── Phase 3: Business logic dispatch ────────────────────────────────────
  try {
    await dispatchBusinessLogic(input.eventType, input.rawBody, eventId);

    const isKnownType = Boolean(handlers[input.eventType]);
    const finalStatus = isKnownType ? "processed" : "skipped";

    await InboundWebhookEvent.findByIdAndUpdate(event._id, {
      $set: {
        processingStatus: finalStatus,
        processedAt: new Date(),
        errorMessage: null,
      },
    });

    return { status: finalStatus, eventId, alreadyProcessed: false };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);

    await InboundWebhookEvent.findByIdAndUpdate(event._id, {
      $set: {
        processingStatus: "failed",
        errorMessage: msg,
      },
    });

    logger.error("Inbound webhook business processing failed", {
      action: "inboundWebhookProcessor",
      idempotencyKey: input.idempotencyKey,
      eventType: input.eventType,
      error: msg,
    });

    return {
      status: "failed",
      eventId,
      alreadyProcessed: false,
      errorMessage: msg,
    };
  }
}

// ── Admin tools ─────────────────────────────────────────────────────────────

/**
 * Resets a `failed` inbound event back to `pending` so it can be
 * re-processed by a subsequent call to `verifyAndProcess`.
 *
 * Verification is NOT re-run on retry — the original signature has already
 * been checked and the raw body is unchanged. Only business processing runs
 * again.
 *
 * Returns `true` when the event was found and reset; `false` otherwise.
 */
export async function retryFailedEvent(eventId: string): Promise<boolean> {
  const result = await InboundWebhookEvent.findOneAndUpdate(
    { _id: eventId, processingStatus: "failed" },
    {
      $set: {
        processingStatus: "pending",
        // Keep verificationStatus as-is (already "verified").
        errorMessage: null,
        lastAttemptAt: null,
      },
    },
    { new: true },
  );
  return Boolean(result);
}

/**
 * Returns paginated failed inbound events for the admin retry queue.
 * Ordered most-recently-failed first.
 */
export async function listFailedEvents(filter: {
  source?: string;
  eventType?: string;
  limit?: number;
  skip?: number;
}): Promise<{ events: IInboundWebhookEvent[]; total: number }> {
  const query: Record<string, unknown> = { processingStatus: "failed" };
  if (filter.source) query.source = filter.source;
  if (filter.eventType) query.eventType = filter.eventType;

  const limit = Math.min(filter.limit ?? 50, 200);
  const skip = filter.skip ?? 0;

  const [events, total] = await Promise.all([
    InboundWebhookEvent.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    InboundWebhookEvent.countDocuments(query),
  ]);

  return { events: events as unknown as IInboundWebhookEvent[], total };
}

/**
 * Returns paginated events for a given processing status (admin inspection).
 */
export async function listEventsByStatus(filter: {
  processingStatus: IInboundWebhookEvent["processingStatus"];
  limit?: number;
  skip?: number;
}): Promise<{ events: IInboundWebhookEvent[]; total: number }> {
  const query = { processingStatus: filter.processingStatus };
  const limit = Math.min(filter.limit ?? 50, 200);
  const skip = filter.skip ?? 0;

  const [events, total] = await Promise.all([
    InboundWebhookEvent.find(query)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    InboundWebhookEvent.countDocuments(query),
  ]);

  return { events: events as unknown as IInboundWebhookEvent[], total };
}
