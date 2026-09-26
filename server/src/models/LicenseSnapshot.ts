import mongoose from "mongoose";

/**
 * Immutable per-purchase license snapshot (#759).
 *
 * When a purchase is recorded, the license terms active *at that moment*
 * are frozen into a LicenseSnapshot. Later changes to the prompt's license
 * (or to the underlying template) mutate nothing here — a dispute is always
 * resolved against the exact text the buyer was shown when they paid.
 */
const licenseSnapshotSchema = new mongoose.Schema(
  {
    /** Purchase (Purchase._id as string) this snapshot belongs to. */
    purchaseId: {
      type: String,
      required: true,
      index: true,
    },
    promptId: {
      type: String,
      required: true,
      index: true,
    },
    buyerWallet: {
      type: String,
      required: true,
      lowercase: true,
      index: true,
    },
    /** Prompt-level license version active at purchase time. */
    licenseVersionIndex: {
      type: Number,
      required: true,
      min: 1,
    },
    /** Template key + version the prompt-level terms pointed at, if any. */
    templateKey: {
      type: String,
      default: null,
    },
    templateVersion: {
      type: Number,
      default: null,
    },
    /** Frozen display fields (denormalized on purpose — never re-resolved). */
    name: {
      type: String,
      required: true,
    },
    summary: {
      type: String,
      required: true,
    },
    termsText: {
      type: String,
      required: true,
    },
    allowedUses: {
      type: [String],
      default: [],
    },
    commercialUse: {
      type: Boolean,
      required: true,
    },
    attributionRequired: {
      type: Boolean,
      default: false,
    },
    redistributionAllowed: {
      type: Boolean,
      default: false,
    },
    /** Creator-specific overrides layered onto the template. */
    customTerms: {
      type: String,
      default: "",
      maxLength: 4000,
    },
    /** Monotonic prompt-level license counter at snapshot time (redundant
     * with licenseVersionIndex, kept for dispute-tooling readability). */
    snapshotAt: {
      type: Date,
      required: true,
    },
  },
  { timestamps: true },
);

licenseSnapshotSchema.index(
  { purchaseId: 1, licenseVersionIndex: 1 },
  { unique: true },
);

const LicenseSnapshot =
  mongoose.models.LicenseSnapshot ||
  mongoose.model("LicenseSnapshot", licenseSnapshotSchema);

export default LicenseSnapshot;
