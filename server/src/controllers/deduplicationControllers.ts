/**
 * Deduplication observability controllers (#1223).
 *
 * Operators need to answer "was this event delivered once, and was the second
 * copy the same content?" without opening the database. These admin-only
 * endpoints return metadata and content fingerprints only; message bodies and
 * raw webhook payloads are never returned.
 *
 * Authorization is enforced by `requireAdminScope("deduplication:read")` in
 * the router.
 */

import type { Request, Response } from "express";
import Notification from "../models/Notification";
import InboundWebhookEvent from "../models/InboundWebhookEvent";
import WebhookOutboxEvent from "../models/WebhookOutboxEvent";
import {
  classifyDeduplication,
  deduplicationRemedy,
  fingerprintInboundWebhook,
  fingerprintNotification,
} from "../services/deduplication";

const MAX_KEY_LENGTH = 256;

function normalizeKind(value: string): "notification" | "webhook" | null {
  if (value === "notification" || value === "webhook") return value;
  return null;
}

/**
 * GET /api/admin/deduplication/:kind/:key
 * `key` is a Notification `dedupeKey` or an inbound webhook `idempotencyKey`.
 */
export const GetDeduplicationStatus = async (
  req: Request,
  res: Response,
): Promise<Response> => {
  const kind = normalizeKind(String(req.params.kind ?? ""));
  if (!kind) {
    return res.status(400).json({
      error: "kind must be `notification` or `webhook`.",
      code: "INVALID_DEDUPE_KIND",
    });
  }

  const key = String(req.params.key ?? "").trim();
  if (!key || key.length > MAX_KEY_LENGTH) {
    return res.status(400).json({
      error: `key must be between 1 and ${MAX_KEY_LENGTH} characters.`,
      code: "INVALID_DEDUPE_KEY",
    });
  }

  try {
    if (kind === "notification") {
      const record = await Notification.findOne({ dedupeKey: key }).lean();
      if (!record) {
        return res.status(200).json({
          kind,
          key,
          found: false,
          remedy: deduplicationRemedy("new"),
        });
      }
      const stored = record as {
        type: string;
        message: string;
        promptId?: string | null;
        promptTitle?: string | null;
        versionIndex?: number | null;
        createdAt?: Date;
      };
      return res.status(200).json({
        kind,
        key,
        found: true,
        fingerprint: fingerprintNotification(stored),
        status: "delivered",
        type: stored.type,
        createdAt: stored.createdAt ?? null,
        remedy: deduplicationRemedy("duplicate"),
      });
    }

    const record = await InboundWebhookEvent.findOne({ idempotencyKey: key }).lean();
    if (!record) {
      return res.status(200).json({
        kind,
        key,
        found: false,
        remedy: deduplicationRemedy("new"),
      });
    }

    const stored = record as {
      eventType: string;
      source: string;
      rawBody?: string;
      processingStatus?: string;
      attemptCount?: number;
      lastAttemptAt?: Date | null;
    };
    const fingerprint = stored.rawBody
      ? fingerprintInboundWebhook({
          eventType: stored.eventType,
          source: stored.source,
          rawBody: stored.rawBody,
        })
      : null;
    const verdict = classifyDeduplication(
      {
        fingerprint,
        status: stored.processingStatus,
        attempts: stored.attemptCount,
        lastAttemptAt: stored.lastAttemptAt,
      },
      { fingerprint: fingerprint ?? "" },
    );

    return res.status(200).json({
      kind,
      key,
      found: true,
      fingerprint,
      status: stored.processingStatus ?? "unknown",
      verificationStatus: (record as { verificationStatus?: string }).verificationStatus ?? null,
      attempts: stored.attemptCount ?? 0,
      lastAttemptAt: stored.lastAttemptAt ?? null,
      retryable: verdict.retryable,
      remedy: deduplicationRemedy(verdict.status),
    });
  } catch {
    return res.status(500).json({ error: "Failed to read deduplication state." });
  }
};

/**
 * GET /api/admin/deduplication/summary
 * Aggregate counters across the three deduplicated delivery surfaces.
 */
export const GetDeduplicationSummary = async (
  _req: Request,
  res: Response,
): Promise<Response> => {
  try {
    const [
      notificationsKeyed,
      inboundProcessed,
      inboundFailed,
      inboundSkipped,
      outboxPending,
      outboxDelivered,
      outboxDeadLetter,
    ] = await Promise.all([
      Notification.countDocuments({ dedupeKey: { $type: "string" } }),
      InboundWebhookEvent.countDocuments({ processingStatus: "processed" }),
      InboundWebhookEvent.countDocuments({ processingStatus: "failed" }),
      InboundWebhookEvent.countDocuments({ processingStatus: "skipped" }),
      WebhookOutboxEvent.countDocuments({ status: "pending" }),
      WebhookOutboxEvent.countDocuments({ status: "delivered" }),
      WebhookOutboxEvent.countDocuments({ status: "dead_letter" }),
    ]);

    return res.status(200).json({
      notifications: { keyed: notificationsKeyed },
      inboundWebhooks: {
        processed: inboundProcessed,
        failed: inboundFailed,
        skipped: inboundSkipped,
      },
      outboundWebhooks: {
        pending: outboxPending,
        delivered: outboxDelivered,
        deadLetter: outboxDeadLetter,
      },
    });
  } catch {
    return res.status(500).json({ error: "Failed to summarize deduplication state." });
  }
};
