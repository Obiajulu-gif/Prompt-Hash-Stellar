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
const REPLICA_ID = `${process.pid}@${os.hostname()}`;

let tickInFlight = false;

function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/** Exponential backoff with full jitter, capped at MAX_BACKOFF_MS. */
function backoffDelayMs(attempt: number): number {
  const cap = Math.min(MAX_BACKOFF_MS, BASE_BACKOFF_MS * 2 ** attempt);
  return Math.floor(Math.random() * cap);
}

/** Parses a `Retry-After` header (seconds or HTTP-date) into a delay in ms. */
function retryAfterMs(value: string | string[] | undefined): number | null {
  if (!value || Array.isArray(value)) return null;
  const seconds = Number(value);
  if (!Number.isNaN(seconds)) return Math.max(0, seconds * 1000);
  const date = Date.parse(value);
  if (!Number.isNaN(date)) return Math.max(0, date - Date.now());
  return null;
}

/** Exported for tests — the atomic per-row claim used by the poll loop. */
export async function claimRow(now: Date) {
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

async function scheduleRetry(rowId: unknown, attempts: number, delayMs: number, reason: string) {
  await WebhookOutboxEvent.findByIdAndUpdate(rowId, {
    $set: {
      attempts,
      nextAttemptAt: new Date(Date.now() + delayMs),
      lastError: reason,
      leaseHolder: null,
      leaseExpiresAt: null,
    },
  });
}

/** Exported for tests — delivers one already-claimed row. */
export async function deliverRow(row: InstanceType<typeof WebhookOutboxEvent>): Promise<void> {
  const sub = await WebhookSubscription.findById(row.subscriptionId);
  if (!sub) {
    await markDeadLetter(row._id, row.subscriptionId, "Subscription no longer exists.");
    return;
  }
  if (!sub.active) {
    // Not the subscriber's fault and not permanent — check back later
    // without burning a retry attempt.
    await scheduleRetry(row._id, row.attempts, POLL_INTERVAL_MS * 6, "Subscription is inactive.");
    return;
  }
  if (row.sequence > 1) {
    const earlierUndelivered = await WebhookOutboxEvent.findOne({
      subscriptionId: row.subscriptionId,
      sequence: { $lt: row.sequence },
      status: { $ne: "delivered" },
    });
    if (earlierUndelivered) {
      await scheduleRetry(
        row._id,
        row.attempts,
        POLL_INTERVAL_MS,
        "Waiting for earlier subscription delivery sequence.",
      );
      return;
    }
  }

  const attempt = row.attempts + 1;
  const body = JSON.stringify({
    event: row.event,
    eventId: row.eventId ?? row.dedupeKey,
    deliveryId: row.deliveryId ?? String(row._id),
    sequence: row.sequence,
    payloadHash: row.payloadHash,
    timestamp: new Date().toISOString(),
    data: row.payload,
  });
  const headers = {
    "Content-Type": "application/json",
    "X-PromptHash-Signature": signPayload(sub.secret, body),
    "X-PromptHash-Delivery": row.deliveryId ?? String(row._id),
    "X-PromptHash-Event-Id": row.eventId ?? row.dedupeKey,
    "X-PromptHash-Sequence": String(row.sequence),
    "X-PromptHash-Payload-Hash": row.payloadHash,
    "X-PromptHash-Event": row.event,
  };

  try {
    const result = await postSignedWebhook(sub.url, headers, body, DELIVERY_TIMEOUT_MS);

    if (result.status >= 200 && result.status < 300) {
      await markDelivered(row._id, row.subscriptionId);
      return;
    }

    if (result.status === 429) {
      const delay = retryAfterMs(result.headers["retry-after"]) ?? backoffDelayMs(attempt);
      if (attempt >= MAX_ATTEMPTS) {
        await markDeadLetter(row._id, row.subscriptionId, `Rate limited (429) after ${attempt} attempts.`);
      } else {
        await scheduleRetry(row._id, attempt, delay, `Rate limited (429), attempt ${attempt}.`);
      }
      return;
    }

    if (result.status >= 500) {
      if (attempt >= MAX_ATTEMPTS) {
        await markDeadLetter(row._id, row.subscriptionId, `Server error ${result.status} after ${attempt} attempts.`);
      } else {
        await scheduleRetry(row._id, attempt, backoffDelayMs(attempt), `Server error ${result.status}, attempt ${attempt}.`);
      }
      return;
    }

    // Any other non-2xx (400-428, 430-499): a client-side rejection that
    // won't resolve itself on retry.
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
      await scheduleRetry(row._id, attempt, backoffDelayMs(attempt), message);
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
