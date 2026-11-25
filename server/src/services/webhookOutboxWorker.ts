/**
 * Leased webhook outbox delivery worker (#536).
 *
 * Polls `WebhookOutboxEvent` for due rows and delivers them with canonical
 * HMAC signing, SSRF-safe HTTP, retry-with-jitter, and dead-lettering.
 * Concurrency safety mirrors the Soroban indexer's Mongo compare-and-swap
 * lease (`server/src/services/indexer.ts`): every candidate row is claimed
 * with an atomic `findOneAndUpdate` that only succeeds if no other worker
 * currently holds a valid lease on it, so two replicas racing the same row
 * never both deliver it.
 */

import os from "os";
import { createHmac } from "crypto";
import WebhookOutboxEvent from "../models/WebhookOutboxEvent";
import WebhookSubscription from "../models/WebhookSubscription";
import { postSignedWebhook, UnsafeWebhookUrlError } from "./ssrfGuard";

const POLL_INTERVAL_MS = 5_000;
const BATCH_SIZE = 20;
const LEASE_TTL_MS = 60_000;
const DELIVERY_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 8;
const MAX_FAILURES_BEFORE_DISABLE = 10;
const BASE_BACKOFF_MS = 2_000;
const MAX_BACKOFF_MS = 30 * 60 * 1000;
/** Delay between checks while a subscription is switched off (not an attempt). */
const INACTIVE_RECHECK_MS = POLL_INTERVAL_MS * 6;
/**
 * Upper bound on how long an event may wait behind an inactive subscription
 * (~24h at the recheck interval). Without this bound an inactive subscriber
 * keeps the row polling forever; after it the row is dead-lettered and can be
 * replayed once the subscriber re-enables delivery.
 */
const MAX_INACTIVE_DEFERRALS = Math.ceil((24 * 60 * 60 * 1000) / INACTIVE_RECHECK_MS);
/**
 * 4xx responses that are transient by definition (RFC 9110 408; 425 Too Early).
 * Every other 4xx is a permanent rejection and is dead-lettered immediately.
 */
const RETRYABLE_CLIENT_STATUSES: ReadonlySet<number> = new Set([408, 425]);
const REPLICA_ID = `${process.pid}@${os.hostname()}`;
const WEBHOOK_REPLAY_WINDOW_MS = 5 * 60 * 1000;

/** Exported so the retry contract is asserted against the real policy, not a copy. */
export const WEBHOOK_RETRY_POLICY = {
  maxAttempts: MAX_ATTEMPTS,
  baseBackoffMs: BASE_BACKOFF_MS,
  maxBackoffMs: MAX_BACKOFF_MS,
  maxInactiveDeferrals: MAX_INACTIVE_DEFERRALS,
  retryableClientStatuses: [...RETRYABLE_CLIENT_STATUSES],
} as const;

let tickInFlight = false;
let workerPaused = false;

export function pauseWebhookWorker(): void {
  workerPaused = true;
}

export function resumeWebhookWorker(): void {
  workerPaused = false;
}

export function isWebhookWorkerPaused(): boolean {
  return workerPaused;
}

function canonicalSignaturePayload(input: {
  body: string;
  timestamp: string;
  eventId: string;
  deliveryId: string;
}): string {
  return [input.timestamp, input.eventId, input.deliveryId, input.body].join(".");
}

export function signWebhookPayload(
  secret: string,
  input: { body: string; timestamp: string; eventId: string; deliveryId: string },
): string {
  return `sha256=${createHmac("sha256", secret).update(canonicalSignaturePayload(input)).digest("hex")}`;
}

export function verifyWebhookSignature(
  secret: string,
  signature: string,
  input: { body: string; timestamp: string; eventId: string; deliveryId: string; now?: number; replayWindowMs?: number },
): boolean {
  const issuedAt = Date.parse(input.timestamp);
  if (!Number.isFinite(issuedAt)) return false;
  const now = input.now ?? Date.now();
  const windowMs = input.replayWindowMs ?? WEBHOOK_REPLAY_WINDOW_MS;
  if (Math.abs(now - issuedAt) > windowMs) return false;
  return signWebhookPayload(secret, input) === signature;
}

/**
 * Exponential backoff with "equal jitter", capped at MAX_BACKOFF_MS.
 *
 * The delay is drawn from [cap/2, cap). The previous full-jitter form drew
 * from [0, cap), which could retry a transient blip almost immediately and
 * stack retries from many rows onto a subscriber that is already struggling.
 * Exported for tests; `random` is injectable for deterministic checks.
 */
export function computeBackoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const cap = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  const half = cap / 2;
  return Math.floor(half + random() * half);
}

/**
 * Parses a `Retry-After` header (seconds or HTTP-date) into a delay in ms.
 * The server-directed delay is honored but capped at MAX_BACKOFF_MS so a
 * hostile or misconfigured subscriber cannot park a row for days.
 */
function retryAfterMs(value: string | string[] | undefined): number | null {
  if (!value || Array.isArray(value)) return null;
  const seconds = Number(value);
  let delay: number | null = null;
  if (!Number.isNaN(seconds)) {
    delay = Math.max(0, seconds * 1000);
  } else {
    const date = Date.parse(value);
    if (!Number.isNaN(date)) delay = Math.max(0, date - Date.now());
  }
  return delay === null ? null : Math.min(MAX_BACKOFF_MS, delay);
}

/** Exported for tests — the atomic per-row claim used by the poll loop. */
export async function claimRow(now: Date) {
  if (workerPaused) {
    return null;
  }
  return WebhookOutboxEvent.findOneAndUpdate(
    {
      status: "pending",
      nextAttemptAt: { $lte: now },
      $or: [{ leaseExpiresAt: null }, { leaseExpiresAt: { $lt: now } }],
    },
    { $set: { leaseHolder: REPLICA_ID, leaseExpiresAt: new Date(now.getTime() + LEASE_TTL_MS) } },
    { new: true, sort: { subscriptionId: 1, sequence: 1, createdAt: 1 } },
  );
}

async function markDelivered(rowId: unknown, subscriptionId: unknown) {
  await Promise.all([
    WebhookOutboxEvent.findByIdAndUpdate(rowId, {
      $set: {
        status: "delivered",
        deliveredAt: new Date(),
        leaseHolder: null,
        leaseExpiresAt: null,
      },
    }),
    WebhookSubscription.findByIdAndUpdate(subscriptionId, {
      $set: { lastDeliveredAt: new Date(), failureCount: 0 },
    }),
  ]);
}

async function markDeadLetter(rowId: unknown, subscriptionId: unknown, reason: string) {
  // Operators can inspect dead letters via GET /api/webhooks/dead-letters and
  // replay them via POST /api/webhooks/dead-letters/:id/replay. The log line
  // carries no payload and no secret — only identifiers and the reason.
  console.warn("[webhook-outbox] Event dead-lettered.", {
    rowId: String(rowId),
    subscriptionId: String(subscriptionId),
    reason,
  });
  await WebhookOutboxEvent.findByIdAndUpdate(rowId, {
    $set: {
      status: "dead_letter",
      deadLetteredAt: new Date(),
      lastError: reason,
      leaseHolder: null,
      leaseExpiresAt: null,
    },
  });

  const sub = await WebhookSubscription.findByIdAndUpdate(
    subscriptionId,
    { $inc: { failureCount: 1 } },
    { new: true },
  );
  if (sub && sub.failureCount >= MAX_FAILURES_BEFORE_DISABLE) {
    await WebhookSubscription.findByIdAndUpdate(subscriptionId, { active: false });
  }
}

async function scheduleRetry(
  rowId: unknown,
  attempts: number,
  delayMs: number,
  reason: string,
  extra: Record<string, unknown> = {},
) {
  await WebhookOutboxEvent.findByIdAndUpdate(rowId, {
    $set: {
      attempts,
      nextAttemptAt: new Date(Date.now() + delayMs),
      lastError: reason,
      leaseHolder: null,
      leaseExpiresAt: null,
      ...extra,
    },
  });
}

/** Exported for tests — delivers one already-claimed row. */
export async function deliverRow(row: InstanceType<typeof WebhookOutboxEvent>): Promise<void> {
  if (row.status === "delivered") return;
  if (row.deliveryCheckpoint === "acknowledged") {
    await markDelivered(row._id, row.subscriptionId);
    return;
  }
  const sub = await WebhookSubscription.findById(row.subscriptionId);
  if (!sub) {
    await markDeadLetter(row._id, row.subscriptionId, "Subscription no longer exists.");
    return;
  }
  if (!sub.active) {
    // Not the subscriber's fault and not an attempt against the retry budget:
    // check back later without consuming `attempts`. The deferral counter is
    // bounded so a subscription that stays off forever cannot keep this row
    // polling indefinitely; the row is dead-lettered and can be replayed.
    const deferrals = (row.inactiveDeferrals ?? 0) + 1;
    if (deferrals >= MAX_INACTIVE_DEFERRALS) {
      await markDeadLetter(
        row._id,
        row.subscriptionId,
        `Subscription stayed inactive for more than ${MAX_INACTIVE_DEFERRALS} checks; replay after re-enabling delivery.`,
      );
      return;
    }
    await scheduleRetry(row._id, row.attempts, INACTIVE_RECHECK_MS, "Subscription is inactive.", {
      inactiveDeferrals: deferrals,
    });
    return;
  }
  if (row.sequence > 1) {
    // Only a PENDING earlier row holds back later sequences. A dead-lettered
    // earlier row is terminal: treating it as "undelivered" previously blocked
    // every later event for that subscriber forever. Sequence gaps are already
    // part of the contract (see enqueue), so later events proceed and the
    // gap is visible to subscribers through X-PromptHash-Sequence.
    const earlierPending = await WebhookOutboxEvent.findOne({
      subscriptionId: row.subscriptionId,
      sequence: { $lt: row.sequence },
      status: "pending",
    });
    if (earlierPending) {
      await scheduleRetry(
        row._id,
        row.attempts,
        POLL_INTERVAL_MS,
        "Waiting for earlier subscription delivery sequence.",
      );
      return;
    }
  }

  if (row.attempts >= MAX_ATTEMPTS) {
    await markDeadLetter(row._id, row.subscriptionId, "Attempt budget exhausted; reconcile ambiguous delivery before replay.");
    return;
  }
  const attempt = row.attempts + 1;
  const timestamp = new Date().toISOString();
  const eventId = row.eventId ?? row.dedupeKey;
  const deliveryId = row.deliveryId ?? String(row._id);
  const schemaVersion = row.schemaVersion ?? 1;
  const body = JSON.stringify({
    schemaVersion,
    event: row.event,
    eventId,
    deliveryId,
    sequence: row.sequence,
    payloadHash: row.payloadHash,
    timestamp,
    data: row.payload,
  });
  const headers = {
    "Content-Type": "application/json",
    "X-PromptHash-Signature": signWebhookPayload(sub.secret, { body, timestamp, eventId, deliveryId }),
    "X-PromptHash-Delivery": deliveryId,
    "X-PromptHash-Event-Id": eventId,
    "X-PromptHash-Event-Version": String(schemaVersion),
    "X-PromptHash-Timestamp": timestamp,
    "X-PromptHash-Sequence": String(row.sequence),
    "X-PromptHash-Payload-Hash": row.payloadHash,
    "X-PromptHash-Event": row.event,
  };

  // Persist intent and consume an attempt BEFORE crossing the network boundary.
  // A lost response remains ambiguous; retries keep the same deliveryId.
  await WebhookOutboxEvent.findByIdAndUpdate(row._id, {
    $set: { deliveryCheckpoint: "prepared", attempts: attempt },
  });
  try {
    const result = await postSignedWebhook(sub.url, headers, body, DELIVERY_TIMEOUT_MS);

    if (result.status >= 200 && result.status < 300) {
      await WebhookOutboxEvent.findByIdAndUpdate(row._id, {
        $set: { deliveryCheckpoint: "acknowledged", responseStatus: result.status },
      });
      await markDelivered(row._id, row.subscriptionId);
      return;
    }

    if (result.status === 429) {
      const delay = retryAfterMs(result.headers["retry-after"]) ?? computeBackoffDelayMs(attempt);
      if (attempt >= MAX_ATTEMPTS) {
        await markDeadLetter(row._id, row.subscriptionId, `Rate limited (429) after ${attempt} attempts.`);
      } else {
        await scheduleRetry(row._id, attempt, delay, `Rate limited (429), attempt ${attempt}.`);
      }
      return;
    }

    if (result.status >= 500 || RETRYABLE_CLIENT_STATUSES.has(result.status)) {
      if (attempt >= MAX_ATTEMPTS) {
        await markDeadLetter(row._id, row.subscriptionId, `Server error ${result.status} after ${attempt} attempts.`);
      } else {
        await scheduleRetry(
          row._id,
          attempt,
          computeBackoffDelayMs(attempt),
          `Transient status ${result.status}, attempt ${attempt}.`,
        );
      }
      return;
    }

    // Any other non-2xx (400-407, 409-424, 426-499): a permanent client-side
    // rejection that won't resolve itself on retry.
    await markDeadLetter(row._id, row.subscriptionId, `Rejected with status ${result.status}.`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (err instanceof UnsafeWebhookUrlError) {
      // Never retry an SSRF-unsafe target — it's not going to become safe.
      await markDeadLetter(row._id, row.subscriptionId, `Blocked unsafe URL: ${message}`);
      return;
    }
    if (attempt >= MAX_ATTEMPTS) {
      await markDeadLetter(row._id, row.subscriptionId, `${message} (after ${attempt} attempts)`);
    } else {
      await scheduleRetry(row._id, attempt, computeBackoffDelayMs(attempt), message);
    }
  }
}

/**
 * Starts the background outbox delivery loop. Safe to call unconditionally
 * — each tick is a no-op when there's nothing due.
 */
export function startWebhookOutboxWorker(): void {
  console.log("[webhook-outbox] Delivery worker started.", { replicaId: REPLICA_ID });

  setInterval(async () => {
    if (tickInFlight) return;
    tickInFlight = true;
    try {
      const now = new Date();
      for (let i = 0; i < BATCH_SIZE; i++) {
        const row = await claimRow(now);
        if (!row) break; // nothing else due right now
        await deliverRow(row).catch((err) => {
          console.error("[webhook-outbox] Unexpected delivery error:", err);
        });
      }
    } catch (err) {
      console.error("[webhook-outbox] Tick error:", err);
    } finally {
      tickInFlight = false;
    }
  }, POLL_INTERVAL_MS);
}
