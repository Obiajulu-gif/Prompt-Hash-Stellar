import mongoose from "mongoose";

/**
 * Append-only moderation review history for the safety scanner override
 * workflow (#758).
 *
 * Every maintainer approve/reject decision on a scanner-flagged prompt is
 * recorded here with the acting admin, a reason code, and the scanner rule
 * ids that flagged the prompt, so the full override history remains
 * queryable. See `server/src/moderation/types.ts` for the state machine.
 */
const moderationReviewSchema = new mongoose.Schema(
  {
    promptId: {
      type: String,
      required: true,
      index: true,
    },
    action: {
      type: String,
      required: true,
      enum: ["approve", "reject"],
    },
    reasonCode: {
      type: String,
      required: true,
      enum: [
        "false_positive",
        "policy_exception",
        "insufficient_evidence",
        "policy_violation_confirmed",
        "other",
      ],
    },
    notes: {
      type: String,
      default: "",
      maxLength: 2000,
    },
    actingAdmin: {
      type: String,
      required: true,
    },
    scannerRuleIds: {
      type: [String],
      default: [],
    },
  },
  {
    timestamps: true,
  },
);

moderationReviewSchema.index({ promptId: 1, createdAt: -1 });

const ModerationReview =
  mongoose.models.ModerationReview ||
  mongoose.model("ModerationReview", moderationReviewSchema);

export default ModerationReview;
