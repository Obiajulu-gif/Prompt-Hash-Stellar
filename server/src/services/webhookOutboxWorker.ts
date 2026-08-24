import { createHmac } from "crypto";
import WebhookOutboxEvent, {
  type IWebhookOutboxEvent,
  type WebhookDeliveryStatus,
} from "../models/WebhookOutboxEvent";
import WebhookSubscription from "../models/WebhookSubscription";
import { validateWebhookUrl } from "./ssrfGuard";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

/** Base delay in ms for exponential backoff (first retry = BASE_DELAY_MS). */
const BASE_DELAY_MS = 1_000;

/** Maximum delay cap in ms to prevent absurdly long waits. */
const MAX_DELAY_MS = 5 * 60 * 1_000; // 5 minutes

/** Jitter range: add random 0-40% of the computed delay. */
const JITTER_FACTOR = 0.4;

/** Number of events to poll per worker tick. */
const BATCH_SIZE = 20;

/** How often the worker polls for new events (ms). */
const POLL_INTERVAL_MS = 2_000;

/** HTTP request timeout per attempt (ms). */
const REQUEST_TIMEOUT_MS = 10_000;

/** Max consecutive failures before a subscription is auto-disabled. */
const MAX_SUBSCRIPTION_FAILURES = 10;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function signPayload(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

/**
 * Compute the delay in ms for the given attempt number using exponential
 * backoff with full jitter.
 *
 * attempt 0 → 1 000 – 1 400 ms
 * attempt 1 → 2 000 – 2 800 ms
 * attempt 2 → 4 000 – 5 600 ms
 * …capped at MAX_DELAY_MS
 */
export function computeRetryDelay(attempt: number): number {
  const exponential = Math.min(BASE_DELAY_MS * 2 ** attempt, MAX_DELAY_MS);
  const jitter = exponential * JITTER_FACTOR * Math.random();
  return Math.floor(exponential + jitter);
}

/**
 * Classify an HTTP status code into a retry decision.
 *
 * - 2xx → success (no retry)
 * - 4xx (except 408, 429) → permanent failure → dead-letter immediately
 * - 408, 429, 5xx, network errors → transient → retry
 */
function isPermanentFailure(statusCode: number): boolean {
  return statusCode >= 400 && statusCode < 500 && statusCode !== 408 && statusCode !== 429;
}

// ---------------------------------------------------------------------------
// Delivery
// ---------------------------------------------------------------------------

export interface DeliveryResult {
  success: boolean;
  statusCode: number | null;
  error: string | null;
}

async function deliverOnce(url: string, secret: string, payload: object): Promise<DeliveryResult> {
  const body = JSON.stringify(payload);
  const signature = signPayload(secret, body);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-PromptHash-Signature": signature,
      },
      body,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (res.ok) {
      return { success: true, statusCode: res.status, error: null };
    }

    return { success: false, statusCode: res.status, error: `HTTP ${res.status}` };
  } catch (err) {
    return {
      success: false,
      statusCode: null,
      error: err instanceof Error ? err.message : "Unknown delivery error",
    };
  }
}

// ---------------------------------------------------------------------------
// Worker core
// ---------------------------------------------------------------------------

/**
 * Process a single outbox event: attempt delivery with retry logic.
 *
 * On success  → status = "delivered", deliveredAt = now
 * On exhaustion → status = "failed", failedAt = now  (dead-letter)
 * On permanent 4xx → dead-letter immediately (skip remaining retries)
 */
async function processEvent(event: IWebhookOutboxEvent): Promise<void> {
  // SSRF check on every attempt (URL could have been added to blocklist)
  const ssrfError = await validateWebhookUrl(event.url);
  if (ssrfError) {
    await WebhookOutboxEvent.findByIdAndUpdate(event._id, {
      status: "failed" as WebhookDeliveryStatus,
      lastError: `SSRF blocked: ${ssrfError}`,
      failedAt: new Date(),
    });
    return;
  }

  const result = await deliverOnce(event.url, event.secret, event.payload);
  const nextAttempt = event.attemptCount + 1;

  if (result.success) {
    // ── Success ──────────────────────────────────────────────────────
    await WebhookOutboxEvent.findByIdAndUpdate(event._id, {
      status: "delivered" as WebhookDeliveryStatus,
      attemptCount: nextAttempt,
      deliveredAt: new Date(),
    });

    // Reset subscription failure counter on success.
    await WebhookSubscription.findByIdAndUpdate(event.subscriptionId, {
      $set: { failureCount: 0, lastDeliveredAt: new Date() },
    });
    return;
  }

  // ── Failure ─────────────────────────────────────────────────────────
  const isPermanent = result.statusCode !== null && isPermanentFailure(result.statusCode);
  const isExhausted = nextAttempt >= event.maxAttempts;

  if (isPermanent || isExhausted) {
    // Dead-letter the event.
    await WebhookOutboxEvent.findByIdAndUpdate(event._id, {
      status: "failed" as WebhookDeliveryStatus,
      attemptCount: nextAttempt,
      lastError: result.error,
      lastStatusCode: result.statusCode,
      failedAt: new Date(),
    });

    // Bump subscription failure count; disable if too many consecutive failures.
    const updated = await WebhookSubscription.findByIdAndUpdate(
      event.subscriptionId,
      { $inc: { failureCount: 1 } },
      { new: true },
    );
    if (updated && updated.failureCount >= MAX_SUBSCRIPTION_FAILURES) {
      await WebhookSubscription.findByIdAndUpdate(event.subscriptionId, { active: false });
    }
    return;
  }

  // Transient failure – schedule retry with exponential backoff + jitter.
  const delayMs = computeRetryDelay(event.attemptCount);
  const nextRetryAt = new Date(Date.now() + delayMs);

  await WebhookOutboxEvent.findByIdAndUpdate(event._id, {
    attemptCount: nextAttempt,
    lastError: result.error,
    lastStatusCode: result.statusCode,
    nextRetryAt,
    status: "pending" as WebhookDeliveryStatus,
  });
}

/**
 * Poll for pending events that are due and process them.
 * Returns the number of events processed in this tick.
 */
export async function processBatch(): Promise<number> {
  const now = new Date();

  // Atomically claim a batch of pending events whose retry time has arrived.
  const events = await WebhookOutboxEvent.find({
    status: "pending",
    nextRetryAt: { $lte: now },
  })
    .sort({ nextRetryAt: 1 })
    .limit(BATCH_SIZE);

  if (events.length === 0) return 0;

  // Mark them as processing so other worker instances don't pick them up.
  const ids = events.map((e) => e._id);
  await WebhookOutboxEvent.updateMany(
    { _id: { $in: ids } },
    { $set: { status: "processing" as WebhookDeliveryStatus } },
  );

  // Process concurrently (bounded by BATCH_SIZE).
  await Promise.allSettled(events.map((e) => processEvent(e)));

  return events.length;
}

/**
 * Start the outbox worker loop. Call this once at server startup.
 * Returns a stop function to shut down the loop gracefully.
 */
export function startWebhookWorker(): { stop: () => void } {
  let running = true;

  async function loop(): Promise<void> {
    while (running) {
      try {
        await processBatch();
      } catch (err) {
        console.error("[webhookOutboxWorker] batch error:", err);
      }
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  void loop();

  return {
    stop() {
      running = false;
    },
  };
}
