/**
 * Activity Timeline model — user-facing events with privacy-aware filtering (#838).
 *
 * Design decisions:
 *  - `eventType` categorizes events; `visibility` controls who can see them
 *  - Maintainer-only events (visibility=maintainer) are filtered out for users
 *  - `resourceType` + `resourceId` provide stable deep links
 *  - `actorWallet` identifies who triggered the event
 *  - `recipientWallet` scopes which user sees the event
 *  - 90-day retention via TTL index
 */

import mongoose from "mongoose";

export type TimelineEventType =
  | "prompt_published"
  | "prompt_updated"
  | "prompt_purchased"
  | "prompt_reviewed"
  | "prompt_moderated"
  | "prompt_reported"
  | "profile_updated"
  | "payout_received"
  | "invitation_sent"
  | "invitation_accepted"
  | "audit_event";

export type TimelineVisibility = "public" | "private" | "maintainer";

const timelineEventSchema = new mongoose.Schema(
  {
    eventType: {
      type: String,
      required: true,
      enum: [
        "prompt_published",
        "prompt_updated",
        "prompt_purchased",
        "prompt_reviewed",
        "prompt_moderated",
        "prompt_reported",
        "profile_updated",
        "payout_received",
        "invitation_sent",
        "invitation_accepted",
        "audit_event",
      ] as TimelineEventType[],
      index: true,
    },
    visibility: {
      type: String,
      required: true,
      enum: ["public", "private", "maintainer"] as TimelineVisibility[],
      default: "public",
      index: true,
    },
    actorWallet: {
      type: String,
      default: null,
      lowercase: true,
      index: true,
    },
    recipientWallet: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    resourceType: {
      type: String,
      required: true,
      enum: ["prompt", "purchase", "review", "profile", "payout", "invitation"],
    },
    resourceId: {
      type: String,
      default: null,
    },
    summary: {
      type: String,
      required: true,
      maxLength: 500,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },
  },
  { timestamps: true },
);

// Compound indexes for timeline queries
timelineEventSchema.index({ recipientWallet: 1, createdAt: -1 });
timelineEventSchema.index({ recipientWallet: 1, visibility: 1, createdAt: -1 });
timelineEventSchema.index({
  recipientWallet: 1,
  eventType: 1,
  createdAt: -1,
});

// 90-day retention
timelineEventSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

const TimelineEvent =
  mongoose.models.TimelineEvent ||
  mongoose.model("TimelineEvent", timelineEventSchema);

export default TimelineEvent;
