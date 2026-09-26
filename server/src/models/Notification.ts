/**
 * Notification model — in-app notification center (#notification-center).
 *
 * Design decisions:
 *  - `idempotencyKey` (unique sparse index) prevents duplicate notifications
 *    from retried events; callers pass the on-chain event id as the key.
 *  - `type` covers all high-impact marketplace events for buyers, creators,
 *    and admins. `prompt_update` is kept for backward compatibility.
 *  - `deepLink` is an opaque relative path (e.g. `/prompts/abc123`) so the
 *    frontend can navigate without re-parsing notification data.
 *  - Sensitive payload details (wallet keys, prices, addresses) must never
 *    be stored here. Use reference IDs only.
 *  - A TTL index on `createdAt` enforces the 90-day retention policy so the
 *    collection does not grow unbounded. Audit-relevant facts live in AuditLog.
 */

import mongoose from "mongoose";

export type NotificationType =
  | "prompt_update" // creator updated a prompt the user owns
  | "purchase_confirmed" // buyer: their purchase was indexed on-chain
  | "dispute_opened" // buyer: they opened a dispute / creator: dispute filed against them
  | "dispute_resolved" // buyer + creator: dispute resolution outcome
  | "payout_available" // creator: payout ledger entry settled
  | "moderation_action" // creator: a prompt was hidden/restored by a moderator
  | "ownership_transfer" // both parties: prompt ownership change
  | "system"; // admin-targeted system announcements

const NOTIFICATION_TYPES: NotificationType[] = [
  "prompt_update",
  "purchase_confirmed",
  "dispute_opened",
  "dispute_resolved",
  "payout_available",
  "moderation_action",
  "ownership_transfer",
  "system",
];

// Default muted types per user are stored in preferences.mutedTypes.
const DEFAULT_MUTED_TYPES: NotificationType[] = [];

const notificationPreferencesSchema = new mongoose.Schema(
  {
    mutedTypes: {
      type: [String],
      enum: NOTIFICATION_TYPES,
      default: DEFAULT_MUTED_TYPES,
    },
    emailEnabled: { type: Boolean, default: false },
  },
  { _id: false },
);

const notificationSchema = new mongoose.Schema(
  {
    recipientWallet: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    // Stable idempotency key, typically the on-chain event id.
    // Sparse so pre-existing rows without this field are unaffected.
    idempotencyKey: {
      type: String,
      sparse: true,
      index: true,
    },
    type: {
      type: String,
      required: true,
      enum: NOTIFICATION_TYPES,
      index: true,
    },
    // Human-readable message. Must not contain sensitive payload data.
    message: {
      type: String,
      required: true,
    },
    // Relative path for deep linking to the relevant workflow.
    deepLink: {
      type: String,
      default: null,
    },
    // Stable reference IDs (never raw addresses, keys, or amounts).
    promptId: {
      type: String,
      default: null,
      index: true,
    },
    promptTitle: {
      type: String,
      default: "",
    },
    // Type-specific supplemental fields (read-only, non-sensitive).
    versionIndex: {
      type: Number,
      default: null,
    },
    changeNote: {
      type: String,
      default: "",
    },
    read: {
      type: Boolean,
      default: false,
      index: true,
    },
  },
  { timestamps: true },
);

// Compound indexes for the notification center queries.
notificationSchema.index({ recipientWallet: 1, read: 1, createdAt: -1 });
notificationSchema.index({ recipientWallet: 1, type: 1, createdAt: -1 });

// Unique idempotency constraint — only enforce when key is present.
notificationSchema.index(
  { recipientWallet: 1, idempotencyKey: 1 },
  { unique: true, sparse: true },
);

// 90-day retention policy. MongoDB TTL indexes delete documents whose
// `createdAt` is older than `expireAfterSeconds` seconds.
notificationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 90 * 24 * 60 * 60 },
);

const Notification =
  mongoose.models.Notification ||
  mongoose.model("Notification", notificationSchema);

export default Notification;
export { NOTIFICATION_TYPES, notificationPreferencesSchema };
