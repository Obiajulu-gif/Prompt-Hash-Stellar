import { randomUUID } from "crypto";
import WebhookSubscription from "../models/WebhookSubscription";
import WebhookOutboxEvent from "../models/WebhookOutboxEvent";

export interface WebhookPayload {
  event: string;
  deliveryId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

/**
 * Enqueue a webhook event for async delivery via the outbox pattern.
 *
 * For each active subscription matching `creatorWallet` + `event`, a
 * `WebhookOutboxEvent` document is created with status `pending`. The
 * `webhookOutboxWorker` will pick it up and deliver with exponential backoff.
 *
 * Deduplicates by `deliveryId` – if the same deliveryId already exists (e.g.
 * from a concurrent dispatch) the existing event is returned instead of
 * creating a duplicate.
 */
export async function enqueueWebhookEvent(
  creatorWallet: string,
  event: string,
  data: Record<string, unknown>,
): Promise<string[]> {
  const subscriptions = await WebhookSubscription.find({
    walletAddress: creatorWallet.toLowerCase(),
    active: true,
    events: event,
  });

  if (subscriptions.length === 0) return [];

  const now = new Date();
  const deliveryIds: string[] = [];

  const operations = subscriptions.map((sub) => {
    const deliveryId = randomUUID();
    deliveryIds.push(deliveryId);

    return WebhookOutboxEvent.updateOne(
      { deliveryId },
      {
        $setOnInsert: {
          subscriptionId: sub._id,
          walletAddress: creatorWallet.toLowerCase(),
          url: sub.url,
          secret: sub.secret,
          event,
          deliveryId,
          payload: {
            event,
            deliveryId,
            timestamp: now.toISOString(),
            data,
          } satisfies WebhookPayload,
          status: "pending" as const,
          attemptCount: 0,
          maxAttempts: 8,
          lastError: null,
          lastStatusCode: null,
          nextRetryAt: now,
          deliveredAt: null,
          failedAt: null,
        },
      },
      { upsert: true },
    );
  });

  await Promise.all(operations);
  return deliveryIds;
}
