import mongoose from "mongoose";

const promptSchema = new mongoose.Schema(
  {
    image: {
      type: String,
      required: true,
      trim: true,
    },
    title: {
      type: String,
      required: true,
      trim: true,
      minLength: 3,
      maxLength: 100,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      minLength: 10,
    },
    rating: {
      type: Number,
      default: 1,
      min: 1,
      max: 5,
    },
    owner: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    price: {
      type: Number,
      required: true,
      min: 0,
    },
    category: {
      type: String,
      required: true,
      enum: [
        "Marketing",
        "Creative Writing",
        "Programming",
        "Music",
        "Gaming",
        "Other",
      ],
      default: "Other",
    },
    currentVersionIndex: {
      type: Number,
      default: 1,
      min: 1,
    },
    // Anti-plagiarism fields (Issue #133)
    similarityFlag: {
      type: String,
      enum: ["clean", "suspicious", "highly_similar"],
      default: "clean",
      index: true,
    },
    similarityScore: {
      type: Number,
      default: null,
      min: 0,
      max: 1,
    },
    similarTo: {
      // onChainId of the most similar existing prompt, if flagged.
      type: String,
      default: null,
    },
    similarityCheckedAt: {
      type: Date,
      default: null,
    },
    onChainId: {
      type: String,
      default: null,
      index: true,
    },
    isActive: {
      type: Boolean,
      default: true,
      index: true,
    },
    listingStatus: {
      type: String,
      enum: ['draft', 'ready', 'published', 'archived'],
      default: 'draft',
      index: true,
    },
    savedPrompts: {
      type: [mongoose.Schema.Types.ObjectId],
      ref: 'User',
      default: [],
    },
    salesCount: {
      type: Number,
      default: 0,
      min: 0,
    },
  },
  {
    timestamps: true,
  },
);
promptSchema.index({ title: 1 });

// Check if the model exists before creating it
const Prompt = mongoose.models.Prompt || mongoose.model("Prompt", promptSchema);

export default Prompt;
