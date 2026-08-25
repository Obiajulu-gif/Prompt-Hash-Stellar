import mongoose from "mongoose";

export type WebhookOutboxStatus = "pending" | "delivered" | "dead_letter";

const webhookOutboxEventSchema = new mongoose.Schema(
  {
    subscriptionId: { type: mongoose.Schema.Types.ObjectId, required: true, index: true },
    // Stable identity for the source marketplace event, e.g. the Soroban
    // event id. Combined with `subscriptionId` this gives every committed
    // event exactly one durable delivery row per subscriber, regardless of
    // how many times the projecting code path runs.
    dedupeKey: { type: String, required: true },
    event: { type: String, required: true },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    status: {
      type: String,
      enum: ["pending", "delivered", "dead_letter"],
      default: "pending",
      index: true,
    },
    attempts: { type: Number, default: 0 },
    nextAttemptAt: { type: Date, default: () => new Date(), index: true },
    // Distributed-lease fields, mirroring the compare-and-swap pattern used
    // by the Soroban indexer (`IndexerState`) — only the worker whose
    // conditional claim update matches may deliver this attempt.
    leaseHolder: { type: String, default: null },
    leaseExpiresAt: { type: Date, default: null },
    lastError: { type: String, default: null },
    deliveredAt: { type: Date, default: null },
    deadLetteredAt: { type: Date, default: null },
  },
  { timestamps: true },
);

webhookOutboxEventSchema.index({ subscriptionId: 1, dedupeKey: 1 }, { unique: true });

const WebhookOutboxEvent =
  mongoose.models.WebhookOutboxEvent ||
  mongoose.model("WebhookOutboxEvent", webhookOutboxEventSchema);

export default WebhookOutboxEvent;
