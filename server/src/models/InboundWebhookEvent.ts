/**
 * InboundWebhookEvent — persists raw inbound webhook events for durable,
 * idempotent processing (#idempotent-webhooks).
 *
 * Design decisions:
 *
 *  Idempotency
 *  -----------
 *  `idempotencyKey` is supplied by the caller (typically the
 *  `X-PromptHash-Event-Id` header from an inbound delivery). A unique index
 *  on this field means a second attempt with the same key is rejected with a
 *  duplicate-key error, which the processing service maps to a no-op replay.
 *
 *  Separation of concerns
 *  ----------------------
 *  Verification (HMAC signature check) and business processing are tracked
 *  separately: `verificationStatus` is set immediately on receipt;
 *  `processingStatus` advances as business logic runs. A failed verification
 *  short-circuits to `verification_failed` without touching processing state.
 *
 *  Safe metadata storage
 *  ---------------------
 *  `rawHeaders` stores only non-sensitive headers (signature, delivery id,
 *  event type, timestamp). `rawBody` stores the payload as received for
 *  debugging/replay purposes. It must never contain decrypted secrets or PII.
 *
 *  Retention
 *  ---------
 *  Processed raw payloads are scrubbed by the retention worker after 30 days.
 *  Stable idempotency metadata remains, and held or unresolved events are never
 *  archived automatically.
 */

import mongoose, { Document, Schema } from "mongoose";

export type InboundWebhookVerificationStatus =
  | "pending"
  | "verified"
  | "verification_failed";

export type InboundWebhookProcessingStatus =
  | "pending"
  | "processing"
  | "processed"
  | "failed"
  | "skipped"; // duplicate / intentionally ignored

export interface IInboundWebhookEvent extends Document {
  /** Stable caller-supplied key, typically X-PromptHash-Event-Id header value. */
  idempotencyKey: string;
  /** Event type label, e.g. "PromptPurchased". */
  eventType: string;
  /** Source identifier — e.g. "stellar-soroban" or a registered source name. */
  source: string;
  verificationStatus: InboundWebhookVerificationStatus;
  processingStatus: InboundWebhookProcessingStatus;
  /**
   * Non-sensitive header subset retained for debugging.
   * Never store Authorization, Cookie, or any secret-bearing header here.
   */
  rawHeaders: Record<string, string>;
  /**
   * Raw request body stored as a string for replay and debugging.
   * Must not contain decrypted secrets or PII beyond stable reference IDs.
   */
  rawBody: string;
  /** Human-readable reason when verification or processing fails. */
  errorMessage: string | null;
  /** How many times processing has been attempted (including the first). */
  attemptCount: number;
  /** Wall-clock time when the last processing attempt started. */
  lastAttemptAt: Date | null;
  /** Wall-clock time when processing completed successfully. */
  processedAt: Date | null;
  archivedAt: Date | null;
  retentionHold: boolean;
  retentionHoldReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const inboundWebhookEventSchema = new Schema<IInboundWebhookEvent>(
  {
    idempotencyKey: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    eventType: {
      type: String,
      required: true,
      index: true,
    },
    source: {
      type: String,
      required: true,
      default: "unknown",
      index: true,
    },
    verificationStatus: {
      type: String,
      enum: ["pending", "verified", "verification_failed"],
      default: "pending",
      index: true,
    },
    processingStatus: {
      type: String,
      enum: ["pending", "processing", "processed", "failed", "skipped"],
      default: "pending",
      index: true,
    },
    rawHeaders: {
      type: Schema.Types.Mixed,
      default: {},
    },
    rawBody: {
      type: String,
      default: "",
    },
    errorMessage: {
      type: String,
      default: null,
    },
    attemptCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    lastAttemptAt: {
      type: Date,
      default: null,
    },
    processedAt: {
      type: Date,
      default: null,
    },
    archivedAt: {
      type: Date,
      default: null,
      index: true,
    },
    retentionHold: {
      type: Boolean,
      default: false,
      index: true,
    },
    retentionHoldReason: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

// Compound indexes for admin queue queries.
inboundWebhookEventSchema.index({ processingStatus: 1, createdAt: -1 });
inboundWebhookEventSchema.index({ verificationStatus: 1, processingStatus: 1 });
inboundWebhookEventSchema.index({ source: 1, eventType: 1, createdAt: -1 });

// Keep a normal index for deterministic, hold-aware retention cleanup. A
// migration removes the previous TTL index so MongoDB cannot bypass the worker.
inboundWebhookEventSchema.index(
  { createdAt: 1 },
  {},
);
inboundWebhookEventSchema.index({
  processingStatus: 1,
  createdAt: 1,
  archivedAt: 1,
  retentionHold: 1,
});

const InboundWebhookEvent =
  mongoose.models.InboundWebhookEvent ||
  mongoose.model<IInboundWebhookEvent>("InboundWebhookEvent", inboundWebhookEventSchema);

export default InboundWebhookEvent;
