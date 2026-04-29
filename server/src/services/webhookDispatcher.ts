import { createHmac, randomUUID } from "crypto";
import WebhookSubscription from "../models/WebhookSubscription";

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
    } catch (err) {
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

export async function dispatchEvent(
  creatorWallet: string,
  event: string,
  data: Record<string, unknown>,
): Promise<void> {
  const subscriptions = await WebhookSubscription.find({
    walletAddress: creatorWallet.toLowerCase(),
    active: true,
    events: event,
  });

  const payload: WebhookPayload = {
    event,
    deliveryId: randomUUID(),
    timestamp: new Date().toISOString(),
    data,
  };

  await Promise.allSettled(
    subscriptions.map((sub) =>
      deliverWithRetry(String(sub._id), sub.url, sub.secret, payload),
    ),
  );
}
