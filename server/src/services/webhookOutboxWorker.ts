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
 *
 * Failure-injection hooks: `setWebhookFailureInjector` lets end-to-end tests
 * force network errors, HTTP statuses, or crashes at the exact points where
 * real failures occur (before/after the network boundary, during claim, and
 * during ack persistence). In production the injector is never set and every
 * hook is a no-op.
 *
 * Recovery / rollback behavior:
 * - A crash after the `prepared` checkpoint but before `acknowledged` leaves
 * the row in `prepared`; on the next claim the row is re-sent with the same
 * deliveryId (at-least-once, receivers dedupe on X-PromptHash-Delivery).
 * - A row whose lease expires (worker crashed mid-claim) becomes claimable
 * again once `leaseExpiresAt < now`.
 * - Exhausted attempts, SSRF-unsafe URLs, and 4xx rejections dead-letter the
 * row and increment the subscription failure counter; repeated failures
 * deactivate the subscription. Dead letters are never auto-replayed.
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
const WEBHOOK_REPLAY_WINDOW_MS = 5 * 60 * 1000;

/** Points at which a test may inject a failure. */
export type WebhookFailurePoint =
  | "claim"
  | "before_network"
  | "network"
  | "ack_persist";

/**
 * Injected failure: a thrown Error simulates a crash/network failure at that
 * point; a `{ status, headers? }` object simulates an HTTP response at the
 * "network" point (ignored elsewhere).
 */
export type WebhookFailureInjection =
  | Error
  | { status: number; headers?: Record<string, string | string[] | undefined> };

export type WebhookFailureInjector = (
  point: WebhookFailurePoint,
  context: { rowId?: unknown; attempt?: number },
) => WebhookFailureInjection | undefined | Promise<WebhookFailureInjection | undefined>;

let failureInjector: WebhookFailureInjector | null = null;

/** Test-only: install or clear the failure injector. */
export function setWebhookFailureInjector(injector: WebhookFailureInjector | null): void {
  failureInjector = injector;
}

async function maybeInject(
  point: WebhookFailurePoint,
  context: { rowId?: unknown; attempt?: number } = {},
): Promise<WebhookFailureInjection | undefined> {
  if (!failureInjector) return undefined;
  return failureInjector(point, context);
}

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
  if (workerPaused) {
    return null;
  }
  const injected = await maybeInject("claim");
  if (injected instanceof Error) throw injected;
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
    const beforeNetwork = await maybeInject("before_network", { rowId: row._id, attempt });
    if (beforeNetwork instanceof Error) throw beforeNetwork;

    const injectedNetwork = await maybeInject("network", { rowId: row._id, attempt });
    if (injectedNetwork instanceof Error) throw injectedNetwork;
    const result =
      injectedNetwork && !(injectedNetwork instanceof Error)
        ? { status: injectedNetwork.status, headers: injectedNetwork.headers ?? {} }
        : await postSignedWebhook(sub.url, headers, body, DELIVERY_TIMEOUT_MS);

    if (result.status >= 200 && result.status < 300) {
      const ackFailure = await maybeInject("ack_persist", { rowId: row._id, attempt });
      if (ackFailure instanceof Error) throw ackFailure;
      await WebhookOutboxEvent.findByIdAndUpdate(row._id, {
        $set: { deliveryCheckpoint: "acknowledged", responseStatus: result.status },
      });
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
