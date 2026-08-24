import mongoose from "mongoose";

/**
 * Delivery status for a webhook outbox event.
 *
 * - `pending`   – ready to be delivered (or first attempt pending)
 * - `processing` – a worker has picked it up and is attempting delivery
 * - `delivered` – successfully delivered (terminal)
 * - `failed`    – exhausted all retries; dead-lettered (terminal)
 */
export type WebhookDeliveryStatus = "pending" | "processing" | "delivered" | "failed";

export interface IWebhookOutboxEvent {
  subscriptionId: mongoose.Types.ObjectId;
  walletAddress: string;
  url: string;
  secret: string;
  event: string;
  deliveryId: string;
  payload: Record<string, unknown>;
  status: WebhookDeliveryStatus;
  attemptCount: number;
  maxAttempts: number;
  lastError: string | null;
  lastStatusCode: number | null;
  nextRetryAt: Date;
  deliveredAt: Date | null;
  failedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const webhookOutboxEventSchema = new mongoose.Schema<IWebhookOutboxEvent>(
  {
    subscriptionId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "WebhookSubscription",
      required: true,
      index: true,
    },
    walletAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    url: {
      type: String,
      required: true,
    },
    secret: {
      type: String,
      required: true,
    },
    event: {
      type: String,
      required: true,
      index: true,
    },
    deliveryId: {
      type: String,
      required: true,
      unique: true,
    },
    payload: {
      type: mongoose.Schema.Types.Mixed,
      required: true,
    },
    status: {
      type: String,
      enum: ["pending", "processing", "delivered", "failed"],
      default: "pending",
      index: true,
    },
    attemptCount: {
      type: Number,
      default: 0,
    },
    maxAttempts: {
      type: Number,
      default: 8,
    },
    lastError: {
      type: String,
      default: null,
    },
    lastStatusCode: {
      type: Number,
      default: null,
    },
    nextRetryAt: {
      type: Date,
      default: () => new Date(),
      index: true,
    },
    deliveredAt: {
      type: Date,
      default: null,
    },
    failedAt: {
      type: Date,
      default: null,
    },
  },
  { timestamps: true },
);

// Compound index for the worker's polling query: find pending events that are
// due for (re)try, ordered by nextRetryAt.
webhookOutboxEventSchema.index({ status: 1, nextRetryAt: 1 });

// Index for admin queries: find all dead-lettered events for a wallet.
webhookOutboxEventSchema.index({ walletAddress: 1, status: 1 });

const WebhookOutboxEvent =
  mongoose.models.WebhookOutboxEvent ||
  mongoose.model("WebhookOutboxEvent", webhookOutboxEventSchema);

export default WebhookOutboxEvent;
