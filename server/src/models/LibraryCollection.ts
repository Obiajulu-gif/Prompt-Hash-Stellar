import mongoose from "mongoose";

/**
 * A buyer's personal collection of purchased prompts (#784).
 *
 * Organisation metadata only: collections live in their own collection and
 * reference prompts by id, so creating, editing, or deleting one never
 * touches Purchase (ownership) records.
 */
export const MAX_COLLECTIONS_PER_BUYER = 50;
export const MAX_PROMPTS_PER_COLLECTION = 500;

const libraryCollectionSchema = new mongoose.Schema(
  {
    buyerWallet: { type: String, required: true, lowercase: true },
    name: { type: String, required: true, trim: true, minLength: 1, maxLength: 60 },
    description: { type: String, default: "", trim: true, maxLength: 280 },
    promptIds: {
      type: [String],
      default: [],
      validate: {
        validator: (ids: string[]) => ids.length <= MAX_PROMPTS_PER_COLLECTION,
        message: `A collection may hold at most ${MAX_PROMPTS_PER_COLLECTION} prompts`,
      },
    },
  },
  { timestamps: true },
);

libraryCollectionSchema.index({ buyerWallet: 1, name: 1 }, { unique: true });
libraryCollectionSchema.index({ buyerWallet: 1, promptIds: 1 });

const LibraryCollection =
  mongoose.models.LibraryCollection ||
  mongoose.model("LibraryCollection", libraryCollectionSchema);

export default LibraryCollection;
