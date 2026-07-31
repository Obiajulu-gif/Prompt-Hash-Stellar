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

import { randomBytes } from "crypto";
import WebhookSubscription from "../models/WebhookSubscription";
import WebhookOutboxEvent, { WebhookOutboxStatus } from "../models/WebhookOutboxEvent";

const SECRET_ROTATION_GRACE_MS = 24 * 60 * 60 * 1000; // 24h for a subscriber to switch over.

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

  const subscriptions = await WebhookSubscription.find({
    walletAddress: walletAddress.toLowerCase(),
    active: true,
    events: event,
  });

  await Promise.all(
    subscriptions.map(async (sub) => {
      try {
        await WebhookOutboxEvent.create({
          subscriptionId: sub._id,
          dedupeKey,
          event,
          payload: data,
        });
      } catch (err: unknown) {
        if ((err as { code?: number }).code === 11000) return; // already enqueued
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
