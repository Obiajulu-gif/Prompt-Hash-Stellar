import mongoose from "mongoose";

/**
 * MarketplaceIndex is a denormalized, search-optimized read-layer.
 *
 * It is populated and kept in sync by the Soroban indexer (src/services/indexer.ts)
 * and by the REST API when prompts are created or updated through the platform.
 *
 * The goal is that the /api/marketplace/search endpoint can resolve every query
 * from this single collection — no runtime joins, no RPC calls.
 */
const marketplaceIndexSchema = new mongoose.Schema(
  {
    // Reference back to the canonical Prompt document
    promptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Prompt",
      required: true,
      unique: true,
    },

    // On-chain identifier from the Soroban contract (may be absent for off-chain prompts)
    onChainId: {
      type: String,
      index: true,
      sparse: true,
    },

    // Denormalized searchable fields
    title: {
      type: String,
      required: true,
      trim: true,
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

    // USD-equivalent price (converted from stroops in the indexer)
    price: {
      type: Number,
      required: true,
      min: 0,
    },

    ownerWallet: {
      type: String,
      required: true,
      lowercase: true,
    },

    ownerUsername: {
      type: String,
      default: "",
    },

    rating: {
      type: Number,
      default: 1,
      min: 1,
      max: 5,
    },

    salesCount: {
      type: Number,
      default: 0,
    },

    isActive: {
      type: Boolean,
      default: true,
    },

    image: {
      type: String,
      default: "",
    },

    // Free-form tags for future enrichment (e.g. auto-extracted keywords)
    tags: {
      type: [String],
      default: [],
    },
  },
  { timestamps: true },
);

// --- Indexes ---

// Full-text search across title and tags
marketplaceIndexSchema.index({ title: "text", tags: "text" });

// Filtering + sorting combinations the search endpoint needs to be fast
marketplaceIndexSchema.index({ category: 1, price: 1 });
marketplaceIndexSchema.index({ isActive: 1, createdAt: -1 });
marketplaceIndexSchema.index({ isActive: 1, salesCount: -1 });
marketplaceIndexSchema.index({ isActive: 1, rating: -1 });
marketplaceIndexSchema.index({ ownerWallet: 1 });

export const MarketplaceIndex =
  mongoose.models.MarketplaceIndex ||
  mongoose.model("MarketplaceIndex", marketplaceIndexSchema);