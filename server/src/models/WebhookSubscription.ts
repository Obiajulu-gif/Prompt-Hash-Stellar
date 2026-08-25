import mongoose from "mongoose";

const webhookSubscriptionSchema = new mongoose.Schema(
  {
    walletAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    url: {
      type: String,
      required: true,
      trim: true,
    },
    secret: {
      type: String,
      required: true,
    },
    // Signing-key rotation (#536): the prior secret stays valid for
    // verification purposes until `previousSecretExpiresAt` so a subscriber
    // has time to switch over; new deliveries always sign with `secret`.
    previousSecret: {
      type: String,
      default: null,
    },
    previousSecretExpiresAt: {
      type: Date,
      default: null,
    },
    events: {
      type: [String],
      default: ["PromptPurchased"],
    },
    active: {
      type: Boolean,
      default: true,
    },
    failureCount: {
      type: Number,
      default: 0,
    },
    lastDeliveredAt: {
      type: Date,
      default: null,
    },
    nextDeliverySequence: {
      type: Number,
      default: 1,
      min: 1,
    },
  },
  { timestamps: true },
);

const WebhookSubscription =
  mongoose.models.WebhookSubscription ||
  mongoose.model("WebhookSubscription", webhookSubscriptionSchema);

export default WebhookSubscription;
