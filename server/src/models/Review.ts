import mongoose from "mongoose";

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
    verified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);

// One review per user per prompt
reviewSchema.index({ promptId: 1, userAddress: 1 }, { unique: true });

const Review = mongoose.models.Review || mongoose.model("Review", reviewSchema);
export default Review;
