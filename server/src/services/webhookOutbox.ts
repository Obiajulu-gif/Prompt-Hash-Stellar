/**
 * Durable webhook outbox (#536).
 *
 * Replaces the previous synchronous, in-memory dispatch path
 * (`webhookDispatcher.ts`, now removed) with a durable queue: projecting
 * code calls {@link enqueue} to persist one delivery row per active
 * subscriber, and `webhookOutboxWorker.ts` leases and delivers those rows
 * out-of-band with retry, signing, and dead-lettering. A crash between
 * `enqueue` and delivery loses nothing — the row is still there for the
 * worker to pick up on restart.
 */

import { createHash, randomBytes, randomUUID } from "crypto";
import WebhookSubscription from "../models/WebhookSubscription";
import WebhookOutboxEvent, { WebhookOutboxStatus } from "../models/WebhookOutboxEvent";
import { redactSensitiveFields } from "./sensitiveContent";
import { canonicalJson } from "./canonicalSerialization";

const SECRET_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000; // 24h for a subscriber to switch over.

function payloadHash(value: Record<string, unknown>): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

/**
 * Persists one outbox row per active subscriber for `event`. `dedupeKey`
 * must be a stable identity for the underlying marketplace event (e.g. the
 * Soroban event id) — combined with the subscription id, it's the unique
 * key that gives a committed event exactly one durable delivery per
 * subscriber even if the caller (or two independent projections of the
 * same event) calls `enqueue` more than once.
 */
export async function enqueue(
  walletAddress: string,
  event: string,
  data: Record<string, unknown>,
  dedupeKey: string,
): Promise<void> {
  if (!walletAddress || !dedupeKey) return;

  // Sensitive-content boundary: redact deny-listed fields (secrets, keys,
  // plaintext/ciphertext, prompt content) before the payload is hashed or
  // persisted, so neither the outbox row nor the delivered body can leak
  // private marketplace data. The hash is computed over the redacted payload
  // so subscribers can still verify hash(body) == header.
  const safeData = redactSensitiveFields(data);

  const subscriptions = await WebhookSubscription.find({
    walletAddress: walletAddress.toLowerCase(),
    active: true,
    events: event,
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        const existing = await WebhookOutboxEvent.findOne({
          subscriptionId: sub._id,
          dedupeKey,
        });
        if (existing) return;
        const sequencedSub = await WebhookSubscription.findByIdAndUpdate(
          sub._id,
          { $inc: { nextDeliverySequence: 1 } },
          { new: false },
        );
        const sequence = sequencedSub?.nextDeliverySequence ?? sub.nextDeliverySequence ?? 1;
        await WebhookOutboxEvent.create({
          subscriptionId: sub._id,
          dedupeKey,
          eventId: dedupeKey,
          deliveryId: randomUUID(),
          sequence,
          payloadHash: payloadHash(safeData),
          schemaVersion: 1,
          event,
          payload: safeData,
        });
      } catch (err: unknown) {
        if ((err as { code?: number }).code === 11000) {
          // Never decrement an allocated sequence: another event may already
          // have consumed the next value. Gaps are valid; reuse is unsafe.
          const winner = await WebhookOutboxEvent.findOne({ subscriptionId: sub._id, dedupeKey });
          if (!winner) throw err;
          return; // already enqueued
        }
        throw err;
      }
    }),
  );
}

export async function listDeadLetters(filter: {
  subscriptionId?: string;
  limit?: number;
} = {}) {
  const query: Record<string, unknown> = { status: "dead_letter" as WebhookOutboxStatus };
  if (filter.subscriptionId) query.subscriptionId = filter.subscriptionId;
  return WebhookOutboxEvent.find(query)
    .sort({ deadLetteredAt: -1 })
    .limit(Math.min(filter.limit ?? 100, 500));
}

/** Resets a dead-lettered row back to pending for immediate redelivery. */
export async function replayDeadLetter(outboxId: string): Promise<boolean> {
  const result = await WebhookOutboxEvent.findOneAndUpdate(
    { _id: outboxId, status: "dead_letter" },
    {
      $set: {
        status: "pending",
        attempts: 0,
        nextAttemptAt: new Date(),
        lastError: null,
        leaseHolder: null,
        leaseExpiresAt: null,
      },
    },
  );
  return Boolean(result);
}

/** Immediately isolates an unprocessable poison message to dead-letter with audit reason. */
export async function quarantineWebhookEvent(outboxId: string, reason: string): Promise<boolean> {
  const result = await WebhookOutboxEvent.findByIdAndUpdate(outboxId, {
    $set: {
      status: "dead_letter",
      deadLetteredAt: new Date(),
      lastError: `Quarantined: ${reason}`,
      leaseHolder: null,
      leaseExpiresAt: null,
    },
  });
  return Boolean(result);
}

/** Replays all dead-lettered events matching the optional subscription filter. */
export async function replayAllDeadLetters(filter: { subscriptionId?: string } = {}): Promise<number> {
  const query: Record<string, unknown> = { status: "dead_letter" as WebhookOutboxStatus };
  if (filter.subscriptionId) query.subscriptionId = filter.subscriptionId;

  const result = await WebhookOutboxEvent.updateMany(query, {
    $set: {
      status: "pending",
      nextAttemptAt: new Date(),
      attempts: 0,
      lastError: null,
      leaseHolder: null,
      leaseExpiresAt: null,
    },
  });
  return result.modifiedCount || 0;
}

export interface WebhookOperationalMetrics {
  pendingCount: number;
  deadLetterCount: number;
  deliveredCount: number;
  totalOutboxCount: number;
}

/** Queries operational health metrics for the webhook outbox. */
export async function getWebhookOperationalMetrics(): Promise<WebhookOperationalMetrics> {
  const [pendingCount, deadLetterCount, deliveredCount, totalOutboxCount] = await Promise.all([
    WebhookOutboxEvent.countDocuments({ status: "pending" }),
    WebhookOutboxEvent.countDocuments({ status: "dead_letter" }),
    WebhookOutboxEvent.countDocuments({ status: "delivered" }),
    WebhookOutboxEvent.countDocuments({}),
  ]);

  return {
    pendingCount,
    deadLetterCount,
    deliveredCount,
    totalOutboxCount,
  };
}

/**
 * Rotates a subscription's signing secret. The old secret keeps verifying
 * for {@link SECRET_ROTATION_GRACE_MS} (surfaced as `previousSecret` to the
 * subscriber) so a rotation doesn't break in-flight verification on their
 * end; new deliveries always sign with the freshly generated secret.
 */
export async function rotateSigningKey(subscriptionId: string): Promise<string | null> {
  const sub = await WebhookSubscription.findById(subscriptionId);
  if (!sub) return null;

  const newSecret = randomBytes(32).toString("hex");
  sub.previousSecret = sub.secret;
  sub.previousSecretExpiresAt = new Date(Date.now() + SECRET_ROTATION_GRACE_MS);
  sub.secret = newSecret;
  await sub.save();
  return newSecret;
}
