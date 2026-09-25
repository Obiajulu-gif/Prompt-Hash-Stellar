/**
 * Inbound webhook controllers — durable, idempotent event intake
 * and admin retry tooling (#idempotent-webhooks).
 *
 * POST /api/webhooks/inbound
 *   Public endpoint that receives webhook deliveries from external sources
 *   (e.g. payment providers). Persists the raw event, verifies the HMAC
 *   signature, then dispatches business logic — all idempotently.
 *
 * GET  /api/webhooks/inbound/failed        (admin)
 *   Paginated list of failed inbound events for the retry queue.
 *
 * POST /api/webhooks/inbound/:id/retry     (admin)
 *   Resets a single failed event back to pending for reprocessing.
 *
 * GET  /api/webhooks/inbound/:id           (admin)
 *   Inspect a single inbound event record.
 */

import { Request, Response } from "express";
import connectDb from "../db/connectDb";
import InboundWebhookEvent from "../models/InboundWebhookEvent";
import {
  verifyAndProcess,
  retryFailedEvent,
  listFailedEvents,
} from "../services/inboundWebhookProcessor";
import { logger } from "../services/structuredLogger";

/** Safe headers to retain — never include Authorization, Cookie, or secrets. */
const SAFE_HEADER_KEYS = [
  "x-prompthash-signature",
  "x-prompthash-delivery",
  "x-prompthash-event-id",
  "x-prompthash-event-version",
  "x-prompthash-timestamp",
  "x-prompthash-sequence",
  "x-prompthash-payload-hash",
  "x-prompthash-event",
  "content-type",
  "user-agent",
];

function extractSafeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of SAFE_HEADER_KEYS) {
    const val = headers[key];
    if (val !== undefined) safe[key] = Array.isArray(val) ? val[0] : val;
  }
  return safe;
}

/**
 * POST /api/webhooks/inbound
 *
 * Accepts raw webhook deliveries. The signing secret is loaded from the
 * INBOUND_WEBHOOK_SECRET environment variable; if not configured the
 * endpoint is disabled (503) to avoid accepting unverified events.
 *
 * Returns 200 on success, 202 on idempotent replay, 400 on bad input,
 * 401 on signature failure, 503 when unconfigured.
 */
export const ReceiveInboundWebhook = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  await connectDb();

  const signingSecret = process.env.INBOUND_WEBHOOK_SECRET;
  if (!signingSecret) {
    logger.warn("INBOUND_WEBHOOK_SECRET not configured; rejecting inbound webhook", {
      action: "inboundWebhook",
    });
    return res.status(503).json({ error: "Inbound webhook intake is not configured." });
  }

  // `idempotencyKey` is the value of X-PromptHash-Event-Id, falling back to
  // X-PromptHash-Delivery, and finally to a combination of event type + body
  // hash so there is always a stable key even for non-PromptHash senders.
  const headers = req.headers as Record<string, string | string[] | undefined>;
  const idempotencyKey =
    (headers["x-prompthash-event-id"] as string) ||
    (headers["x-prompthash-delivery"] as string) ||
    null;

  if (!idempotencyKey) {
    return res.status(400).json({
      error: "Missing X-PromptHash-Event-Id or X-PromptHash-Delivery header.",
    });
  }

  const eventType =
    (headers["x-prompthash-event"] as string) || "unknown";
  const signature =
    (headers["x-prompthash-signature"] as string) || "";
  const timestamp =
    (headers["x-prompthash-timestamp"] as string) || "";

  // Raw body must be a string; Express json() middleware has already parsed it,
  // so we re-serialise. For signature verification to work correctly, callers
  // should send `express.raw()` or re-use `req.rawBody` if available.
  const rawBody =
    typeof req.body === "string"
      ? req.body
      : JSON.stringify(req.body ?? {});

  const result = await verifyAndProcess(
    {
      idempotencyKey,
      eventType,
      source: (headers["user-agent"] as string) || "unknown",
      safeHeaders: extractSafeHeaders(headers),
      rawBody,
      signature,
      timestamp,
    },
    signingSecret,
  ).catch((err) => {
    logger.error("Inbound webhook processing error", {
      action: "inboundWebhook",
      idempotencyKey,
      error: err,
    });
    return null;
  });

  if (!result) {
    return res.status(500).json({ error: "Internal processing error." });
  }

  if (result.status === "verification_failed") {
    return res.status(401).json({ error: result.errorMessage });
  }

  if (result.alreadyProcessed) {
    return res.status(202).json({
      message: "Event already processed.",
      eventId: result.eventId,
      status: result.status,
    });
  }

  return res.status(200).json({
    message: "Event received and processed.",
    eventId: result.eventId,
    status: result.status,
  });
};

/**
 * GET /api/webhooks/inbound/failed
 * Admin: paginated list of failed inbound events.
 */
export const ListFailedInboundEvents = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const { source, eventType, limit, skip } = req.query;
    const result = await listFailedEvents({
      source: source ? String(source) : undefined,
      eventType: eventType ? String(eventType) : undefined,
      limit: limit ? Number(limit) : undefined,
      skip: skip ? Number(skip) : undefined,
    });
    return res.status(200).json(result);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

/**
 * POST /api/webhooks/inbound/:id/retry
 * Admin: reset a failed event to pending for reprocessing.
 */
export const RetryFailedInboundEvent = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const reset = await retryFailedEvent(req.params.id);
    if (!reset) {
      return res.status(404).json({
        error: "No failed inbound event found with that id.",
      });
    }
    return res.status(200).json({ message: "Event reset to pending for reprocessing." });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

/**
 * GET /api/webhooks/inbound/:id
 * Admin: inspect a single inbound event record.
 */
export const GetInboundEvent = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  try {
    await connectDb();
    const event = await InboundWebhookEvent.findById(req.params.id).lean();
    if (!event) {
      return res.status(404).json({ error: "Inbound event not found." });
    }
    return res.status(200).json(event);
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};
