import mongoose from "mongoose";
import { PROMPT_CATEGORIES, PROMPT_METADATA_LIMITS } from "@prompthash/schema";

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
      minLength: PROMPT_METADATA_LIMITS.title.min,
      maxLength: PROMPT_METADATA_LIMITS.title.max,
    },
    content: {
      type: String,
      required: true,
      trim: true,
      minLength: 10,
    },
    // Off-chain rich metadata (#333)
    description: {
      type: String,
      trim: true,
      maxLength: 4000,
      default: "",
    },
    tags: {
      type: [String],
      default: [],
      validate: {
        validator: (v) => v.length <= 10,
        message: "A prompt may have at most 10 tags",
      },
    },
    // References the on-chain listing so the two data stores stay in sync
    onChainReference: {
      type: String,
      trim: true,
      default: "",
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
      enum: PROMPT_CATEGORIES,
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
    previewCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    currentRevision: {
      type: Number,
      default: 0,
      min: 0,
    },
    revisionNotes: {
      type: String,
      default: "",
      trim: true,
    },
    // Content integrity recheck fields (#460)
    encryptedPrompt: {
      type: String,
      default: null,
    },
    contentHash: {
      type: String,
      default: null,
    },
    integrityStatus: {
      type: String,
      enum: ["pending", "ok", "corrupted", "missing", "unreachable"],
      default: "pending",
      index: true,
    },
    integrityCheckedAt: {
      type: Date,
      default: null,
    },
    integrityError: {
      type: String,
      default: null,
    },
    // Search index synchronization state (#699)
    searchIndexStatus: {
      type: String,
      enum: ["synced", "pending", "failed"],
      default: "synced",
      index: true,
    },
    searchIndexError: {
      type: String,
      default: null,
    },
    lastIndexedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);
promptSchema.index({ title: 1 });
promptSchema.index({ listingStatus: 1, isActive: 1, _id: -1 });
promptSchema.index({ listingStatus: 1, isActive: 1, category: 1, _id: -1 });
promptSchema.index({ listingStatus: 1, isActive: 1, owner: 1, _id: -1 });
promptSchema.index({ listingStatus: 1, isActive: 1, salesCount: -1, rating: -1 });

// Check if the model exists before creating it
const Prompt = mongoose.models.Prompt || mongoose.model("Prompt", promptSchema);

export default Prompt;

