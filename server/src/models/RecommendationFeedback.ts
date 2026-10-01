import mongoose from "mongoose";

export type FeedbackAction = "not_interested" | "hide_creator" | "hide_prompt" | "improve_recommendations";

export interface IRecommendationFeedback extends mongoose.Document {
  userWallet: string;
  promptId?: string;
  creatorWallet?: string;
  action: FeedbackAction;
  reason?: string;
  createdAt: Date;
}

const recommendationFeedbackSchema = new mongoose.Schema<IRecommendationFeedback>(
  {
    userWallet: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    promptId: {
      type: String,
      index: true,
    },
    creatorWallet: {
      type: String,
      lowercase: true,
      index: true,
    },
    action: {
      type: String,
      enum: ["not_interested", "hide_creator", "hide_prompt", "improve_recommendations"],
      required: true,
      index: true,
    },
    reason: {
      type: String,
      maxlength: 500,
    },
  },
  { timestamps: true }
);

recommendationFeedbackSchema.index({ userWallet: 1, createdAt: -1 });
recommendationFeedbackSchema.index({ userWallet: 1, action: 1 });
recommendationFeedbackSchema.index({ promptId: 1 });
recommendationFeedbackSchema.index({ creatorWallet: 1 });

const RecommendationFeedback =
  mongoose.models.RecommendationFeedback ||
  mongoose.model<IRecommendationFeedback>("RecommendationFeedback", recommendationFeedbackSchema);

export default RecommendationFeedback;
