/**
 * Invitation model — abuse-resistant collaboration workflow (#835).
 *
 * Design decisions:
 *  - `status` tracks lifecycle: pending → accepted | revoked | expired
 *  - `expiresAt` enforces TTL; expired invitations cannot be accepted
 *  - `role` is validated server-side; escalation is rejected
 *  - `rateLimitKey` enables per-inviter throttling
 *  - Invitations are scoped to a wallet (inviter) and target wallet (invitee)
 */

import mongoose from "mongoose";

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export type InvitationRole = "viewer" | "editor" | "admin";

const ROLE_HIERARCHY: Record<InvitationRole, number> = {
  viewer: 0,
  editor: 1,
  admin: 2,
};

const invitationSchema = new mongoose.Schema(
  {
    inviterWallet: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    inviteeWallet: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    promptId: {
      type: String,
      default: null,
      index: true,
    },
    role: {
      type: String,
      required: true,
      enum: ["viewer", "editor", "admin"],
    },
    status: {
      type: String,
      required: true,
      enum: ["pending", "accepted", "revoked", "expired"],
      default: "pending",
      index: true,
    },
    message: {
      type: String,
      default: "",
      maxLength: 500,
    },
    expiresAt: {
      type: Date,
      required: true,
      index: true,
    },
    acceptedAt: {
      type: Date,
      default: null,
    },
    revokedAt: {
      type: Date,
      default: null,
    },
    revokedBy: {
      type: String,
      default: null,
    },
  },
  { timestamps: true },
);

// Compound indexes for common queries
invitationSchema.index({ inviteeWallet: 1, status: 1, createdAt: -1 });
invitationSchema.index({ inviterWallet: 1, status: 1, createdAt: -1 });
invitationSchema.index({ promptId: 1, status: 1 });

// TTL index: auto-delete expired invitations after 30 days
invitationSchema.index(
  { expiresAt: 1 },
  { expireAfterSeconds: 30 * 24 * 60 * 60 },
);

invitationSchema.static("ROLE_HIERARCHY", ROLE_HIERARCHY);

const Invitation =
  mongoose.models.Invitation ||
  mongoose.model("Invitation", invitationSchema);

export default Invitation;
export { ROLE_HIERARCHY };
