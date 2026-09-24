import mongoose from "mongoose";

/**
 * Per-prompt library state for a buyer (#784), e.g. whether the buyer has
 * archived a purchase. Kept apart from Purchase so organising a library
 * never changes ownership records.
 */
const libraryItemSchema = new mongoose.Schema(
  {
    buyerWallet: { type: String, required: true, lowercase: true },
    promptId: { type: String, required: true },
    archived: { type: Boolean, default: false },
    archivedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

libraryItemSchema.index({ buyerWallet: 1, promptId: 1 }, { unique: true });
libraryItemSchema.index({ buyerWallet: 1, archived: 1 });

const LibraryItem =
  mongoose.models.LibraryItem || mongoose.model("LibraryItem", libraryItemSchema);

export default LibraryItem;
