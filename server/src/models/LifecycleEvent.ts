import mongoose, { Schema } from "mongoose";

/**
 * Privacy-minimised lifecycle event (see docs/lifecycle-analytics.md).
 * Stores only a salted HMAC of the client session id, an allow-listed stage
 * and failure reason, and a server-assigned timestamp. Documents expire
 * automatically after 90 days.
 */
export const LIFECYCLE_EVENT_TTL_SECONDS = 90 * 24 * 60 * 60;

const lifecycleEventSchema = new Schema(
  {
    subjectHash: { type: String, required: true, index: true },
    workflow: { type: String, required: true, index: true },
    stage: { type: String, required: true },
    kind: { type: String, enum: ["reached", "failed"], required: true },
    reason: { type: String, default: undefined },
    // Server clock only: client timestamps are never trusted.
    at: { type: Date, required: true, expires: LIFECYCLE_EVENT_TTL_SECONDS },
  },
  { versionKey: false },
);

lifecycleEventSchema.index({ workflow: 1, at: 1 });

const LifecycleEvent =
  mongoose.models.LifecycleEvent || mongoose.model("LifecycleEvent", lifecycleEventSchema);
export default LifecycleEvent;
