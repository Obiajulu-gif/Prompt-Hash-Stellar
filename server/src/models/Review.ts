import mongoose from "mongoose";

const revisionSchema = new mongoose.Schema(
  {
    rating: Number,
    text: String,
    signature: String,
    updatedAt: { type: Date, default: Date.now },
  },
  { _id: false }
);

const reviewSchema = new mongoose.Schema(
  {
    promptId: {
      type: String,
      required: true,
      index: true,
    },
    userAddress: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    rating: {
      type: Number,
      required: true,
      min: 1,
      max: 5,
    },
    text: {
      type: String,
      default: "",
      trim: true,
      maxlength: 2000,
    },
    signature: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["published", "flagged", "hidden"],
      default: "published",
      index: true,
    },
    verified: {
      type: Boolean,
      default: true,
    },
    revisions: [revisionSchema],
  },
  { timestamps: true }
);

// Unique index: One review per user per prompt
reviewSchema.index({ promptId: 1, userAddress: 1 }, { unique: true });

const Review = mongoose.models.Review || mongoose.model("Review", reviewSchema);
export default Review;
