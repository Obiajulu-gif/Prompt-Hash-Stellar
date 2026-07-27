import mongoose from "mongoose";

/**
 * Vote model — Issue #113
 * One upvote per wallet per prompt (enforced by unique index).
 */
const voteSchema = new mongoose.Schema(
  {
    promptId: {
      type: String,
      required: true,
      index: true,
    },
    voterWallet: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
  },
  { timestamps: true }
);

// One vote per wallet per prompt
voteSchema.index({ promptId: 1, voterWallet: 1 }, { unique: true });

const Vote = mongoose.models.Vote || mongoose.model("Vote", voteSchema);
export default Vote;
