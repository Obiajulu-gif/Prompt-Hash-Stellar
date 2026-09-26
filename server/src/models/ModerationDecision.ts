/**
 * ModerationDecision — append-only audit record for every bulk moderation
 * action (#moderation-queue).
 *
 * Design decisions:
 *
 *  Separation of moderation and publication state
 *  ------------------------------------------------
 *  ModerationDecision records the *intent* (approve/reject/hide/restore) and
 *  the *actor*. The actual state change is applied to Prompt.moderationStatus
 *  separately. This means a decision document is authoritative evidence
 *  independent of the Prompt document.
 *
 *  Rollback capability
 *  --------------------
 *  `rolledBack`, `rollbackReason`, and `rollbackAt` allow an admin to reverse
 *  a decision. Rollback re-applies `previousStatus` to the Prompt and marks
 *  this document as rolled back — it does not delete the original record.
 *
 *  Actor privacy
 *  -------------
 *  `actorWallet` stores the SHA-256 hash of the admin wallet address, matching
 *  the AuditLog convention. The raw address is never persisted here.
 *
 *  Stale-result protection
 *  -----------------------
 *  `snapshotModerationStatus` captures the prompt's moderationStatus at the
 *  moment the bulk action ran, so replays or out-of-order retries can detect
 *  that the state has changed since the decision was made.
 */

import mongoose, { Document, Schema } from "mongoose";

export type ModerationAction = "approve" | "reject" | "hide" | "restore";
export type ModerationStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "hidden"
  | "restored";

export interface IModerationDecision extends Document {
  promptId: string;
  action: ModerationAction;
  /** SHA-256 hash of the acting admin wallet address. */
  actorWallet: string;
  reason: string;
  evidenceNote: string | null;
  /** Prompt.moderationStatus value at the time this decision was made. */
  previousStatus: ModerationStatus;
  /** Prompt.moderationStatus value applied by this decision. */
  newStatus: ModerationStatus;
  /** True once this decision has been rolled back. */
  rolledBack: boolean;
  rollbackReason: string | null;
  rollbackAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const moderationDecisionSchema = new Schema<IModerationDecision>(
  {
    promptId: {
      type: String,
      required: true,
      index: true,
    },
    action: {
      type: String,
      enum: ["approve", "reject", "hide", "restore"],
      required: true,
      index: true,
    },
    actorWallet: {
      type: String,
      required: true,
      index: true,
    },
    reason: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    evidenceNote: {
      type: String,
      default: null,
      trim: true,
      maxlength: 1000,
    },
    previousStatus: {
      type: String,
      enum: ["pending_review", "approved", "rejected", "hidden", "restored"],
      required: true,
    },
    newStatus: {
      type: String,
      enum: ["pending_review", "approved", "rejected", "hidden", "restored"],
      required: true,
    },
    rolledBack: {
      type: Boolean,
      default: false,
      index: true,
    },
    rollbackReason: {
      type: String,
      default: null,
    },
    rollbackAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
    // Append-only: disable updates at the schema level. Rollback is the only
    // permitted mutation and is applied via findByIdAndUpdate with explicit
    // $set on rollback fields only — never via updateMany or replaceOne.
  },
);

// Compound indexes for the moderation queue and audit review queries.
moderationDecisionSchema.index({ promptId: 1, createdAt: -1 });
moderationDecisionSchema.index({ actorWallet: 1, createdAt: -1 });
moderationDecisionSchema.index({ action: 1, createdAt: -1 });
moderationDecisionSchema.index({ rolledBack: 1, createdAt: -1 });

const ModerationDecision =
  mongoose.models.ModerationDecision ||
  mongoose.model<IModerationDecision>("ModerationDecision", moderationDecisionSchema);

export default ModerationDecision;
