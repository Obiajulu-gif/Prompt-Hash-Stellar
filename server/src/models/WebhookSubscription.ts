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
  },
  { timestamps: true },
);

const WebhookSubscription =
  mongoose.models.WebhookSubscription ||
  mongoose.model("WebhookSubscription", webhookSubscriptionSchema);

export default WebhookSubscription;
