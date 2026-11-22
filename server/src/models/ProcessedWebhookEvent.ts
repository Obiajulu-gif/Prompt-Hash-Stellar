/**
 * Processed Webhook Event Model
 *
 * Durable deduplication ledger for inbound webhook deliveries (#1180).
 *
 * The stored `eventId` is the *scoped* dedupe key
 * (`webhook:<source>:<externalEventId>`) so two providers that happen to reuse
 * an event id never suppress each other. The provider's raw id is kept in
 * `externalEventId` for support and replay tooling.
 *
 * Lifecycle (`status`):
 *   in_flight  — one processor holds the reservation and is running side effects
 *   processed  — side effects completed; later duplicates are acknowledged without re-running
 *   failed     — processing failed; the next provider retry may re-acquire immediately
 *
 * Records expire via the TTL index on `expiresAt` (24h after completion or
 * failure by default). Rows are never deleted while `in_flight`; a stale
 * lease (`leaseExpiresAt`) is re-acquirable by a later retry, which recovers
 * a processor that crashed mid-delivery.
 *
 * Legacy rows written before #1180 have an unscoped `eventId`, no `status`
 * (the default applies) and no `externalEventId`. They remain readable and
 * expire on their existing schedule; see
 * `docs/operations/notification-and-webhook-deduplication.md`.
 */

import mongoose, { Schema, Document } from "mongoose";

export type ProcessedWebhookEventStatus = "in_flight" | "processed" | "failed";

export interface IProcessedWebhookEvent extends Document {
  /** Scoped dedupe key — unique across the collection. */
  eventId: string;
  /** Provider-supplied event id, retained for diagnostics. */
  externalEventId?: string | null;
  /** Deduplication scope, normally the normalized source name. */
  scope: string;
  status: ProcessedWebhookEventStatus;
  attempts: number;
  leaseExpiresAt: Date | null;
  lastError: string | null;
  processedAt: Date;
  expiresAt: Date;
  eventType?: string | null;
  source?: string;
}

const ProcessedWebhookEventSchema = new Schema<IProcessedWebhookEvent>(
  {
    eventId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    externalEventId: {
      type: String,
      default: null,
    },
    scope: {
      type: String,
      default: "default",
      index: true,
    },
    status: {
      type: String,
      enum: ["in_flight", "processed", "failed"],
      default: "in_flight",
      index: true,
    },
    attempts: {
      type: Number,
      default: 1,
      min: 1,
    },
    leaseExpiresAt: {
      type: Date,
      default: null,
    },
    lastError: {
      type: String,
      default: null,
    },
    processedAt: {
      type: Date,
      required: true,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    eventType: {
      type: String,
      default: null,
    },
    source: {
      type: String,
    },
  },
  {
    timestamps: false,
  },
);

// TTL index - MongoDB will automatically delete expired documents.
ProcessedWebhookEventSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
// Admin recovery queries: "show me deliveries stuck in flight or failed".
ProcessedWebhookEventSchema.index({ status: 1, leaseExpiresAt: 1 });

const ProcessedWebhookEvent =
  mongoose.models.ProcessedWebhookEvent ||
  mongoose.model<IProcessedWebhookEvent>(
    "ProcessedWebhookEvent",
    ProcessedWebhookEventSchema,
  );

export default ProcessedWebhookEvent;
