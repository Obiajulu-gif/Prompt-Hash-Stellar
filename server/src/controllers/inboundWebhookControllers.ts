/*
 * Inbound webhook controllers — durable, idempotent event intake
 * and admin retry tooling (#idempotent-webhooks).
 *
 * POST /api/webhooks/inbound
 *   Public endpoint that receives webhook deliveries from external sources
 *   (e.g. payment providers). Persists the raw event, verifies the HMC
 *   signature, then dispatches business logic — all idempotently.
 *
 * GET /api/webhooks/inbound/failed        (admin)
 *   Paginated list of failed inbound events for the retry queue.
 *
 * POST  /api/webhooks/inbound/:id/retry     (admin)
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

/**
 * Headers that carry credentials or signed payload material and must never
 * appear in logs, even if somehow present in the retained set.
 */
const SECRET_HEADER_KEYS = new Set([
  "authorization",
  "proxy-authorization",
  "cookie",
  "set-cookie",
  "x-api-key",
  "x-auth-token",
  "x-prompthash-signature",
]);

function extractSafeHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
  const safe: Record<string, string> = {};
  for (const key of SAFE_HEADER_KEYS) {
    if (SECRET_HEADER_KEYS.has(key)) continue;
    const val = headers[key];
    if (val !== undefined) safe[key] = Array.isArray(val) ? val[0] : val;
  }
  return safe;
}

/**
 * Returns a stable, non-reversible fingerprint of a value for correlation
 * in logs without exposing the underlying secret. Uses only the last four
 * characters of a hash so it cannot be reversed to the original value.
 */
const fingerprint = (value: string | undefined | null): string | undefined => {
  if (!value) return undefined;
  // Lazy import to avoid a cycle and keep the hash implementation centralised.
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { createHash } = require("crypto") as typeof import("crypto");
  return createHash("sha256").update(value).digest("hex").slice(-8);
};

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
      outcome: "not_configured",
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
    logger.warn("Inbound webhook rejected: missing idempotency header", {
      action: "inboundWebhook",
      outcome: "missing_idempotency_key",
    });
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

  // Structured context for logs: only permitted identifiers and non-secret
  // metadata. Signature values and raw body content are never logged.
  const logContext = {
    action: "inboundWebhook",
    eventType,
    idempotencyKey,
    idempotencyKeyFingerprint: fingerprint(idempotencyKey),
    signaturePresent: signature.length > 0,
    timestampPresent: timestamp.length > 0,
    bodyBytes: Buffer.byteLength(rawBody, "utf8"),
    source: (headers["user-agent"] as string) || "unknown",
  };

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
      ...logContext,
      outcome: "processing_error",
      error : err,
    });
    return null;
  });

  if (!result) {
    return res.status(500).json({ error: "Internal processing error." });
  }

  if (result.status === "verification_failed") {
    logger.warn("Inbound webhook signature verification failed", {
      ...logContext,
      outcome: "verification_failed",
      eventId: result.eventId,
    });
    return res.status(401).json({ error: result.errorMessage });
  }

  if (result.alreadyProcessed) {
    logger.info("Inbound webhook replay detected", {
      ...logContext,
      outcome: "idempotent_replay",
      eventId: result.eventId,
      status: result.status,
    });
    return res.status(202).json({
      message: "Event already processed.",
      eventId: result.eventId,
      status: result.status,
    });
  }

  logger.info("Inbound webhook received and processed", {
    ...logContext,
    outcome: "processed",
    eventId: result.eventId,
    status: result.status,
  });

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
    logger.error("Failed to list failed inbound webhook events", {
      action: "inboundWebhookListFailed",
      outcome: "error",
      error: err,
    });
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
      logger.warn("Inbound webhook retry target not found", {
        action: "inboundWebhookRetry",
        outcome: "not_found",
        eventId: req.params.id,
      });
      return res.status(404).json({
        error: "No failed inbound event found with that id.",
      });
    }
    logger.info("Inbound webhook reset to pending for reprocessing", {
      action: "inboundWebhookRetry",
      outcome: "reset_to_pending",
      eventId: req.params.id,
    });
    return res.status(200).json({ message: "Event reset to pending for reprocessing." });
  } catch (err) {
    logger.error("Failed to reset inbound webhook event for retry", {
      action: "inboundWebhookRetry",
      outcome: "error",
      eventId: req.params.id,
      error: err,
    });
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
      logger.warn("Inbound webhook event not found", {
        action: "inboundWebhookGet",
        outcome: "not_found",
        eventId: req.params.id,
      });
      return res.status(404).json({ error: "Inbound event not found." });
    }
    return res.status(200).json(event);
  } catch (err) {
    logger.error("Failed to fetch inbound webhook event", {
      action: "inboundWebhookGet",
      outcome: "error",
      eventId: req.params.id,
      error: err,
    });
    return res.status(500).json({ error: (err as Error).message });
  }
};
