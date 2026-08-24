import { createHmac, randomUUID } from "crypto";
import WebhookSubscription from "../models/WebhookSubscription";
import { enqueueWebhookEvent } from "./webhookOutbox";

const MAX_RETRIES = 3;
const RETRY_DELAYS_MS = [2_000, 10_000, 30_000];
const MAX_FAILURES_BEFORE_DISABLE = 10;

export interface WebhookPayload {
  event: string;
  deliveryId: string;
  timestamp: string;
  data: Record<string, unknown>;
}

function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

async function deliverOnce(url: string, secret: string, payload: WebhookPayload): Promise<void> {
  const body = JSON.stringify(payload);
  const signature = signPayload(secret, body);

  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-PromptHash-Signature": signature,
      "X-PromptHash-Delivery": payload.deliveryId,
      "X-PromptHash-Event": payload.event,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error(`Webhook delivery failed with status ${res.status}`);
}

async function deliverWithRetry(
  subscriptionId: string,
  url: string,
  secret: string,
  payload: WebhookPayload,
): Promise<void> {
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await deliverOnce(url, secret, payload);
      await WebhookSubscription.findByIdAndUpdate(subscriptionId, {
        lastDeliveredAt: new Date(),
        $set: { failureCount: 0 },
      });
      return;
    } catch {
      const isLastAttempt = attempt === MAX_RETRIES;
      if (!isLastAttempt) {
        await new Promise((r) => setTimeout(r, RETRY_DELAYS_MS[attempt]));
        continue;
      }

      const updated = await WebhookSubscription.findByIdAndUpdate(
        subscriptionId,
        { $inc: { failureCount: 1 } },
        { new: true },
      );

      if (updated && updated.failureCount >= MAX_FAILURES_BEFORE_DISABLE) {
        await WebhookSubscription.findByIdAndUpdate(subscriptionId, { active: false });
      }
    }
  }
}

/**
 * Dispatch a webhook event to all active subscribers for the given wallet.
 *
 * Uses the outbox pattern (#606): events are persisted to WebhookOutboxEvent
 * and delivered asynchronously by the webhookOutboxWorker with exponential
 * backoff, jitter, and dead-letter handling. This guarantees at-least-once
 * delivery even if the server crashes mid-retry.
 */
export async function dispatchEvent(
  creatorWallet: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  // Enqueue to the outbox for reliable async delivery.
  await enqueueWebhookEvent(creatorWallet, event, data);
}
