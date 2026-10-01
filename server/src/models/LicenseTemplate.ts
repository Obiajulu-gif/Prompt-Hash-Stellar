import mongoose from "mongoose";

/**
 * Named license template (#759).
 *
 * Templates are the * vocabulary* of licensing terms a creator picks from
 * when publishing or updating a prompt. They are global and append-only:
 * existing rows are never edited — a changed template is added as a new
 * version so historical snapshots keep pointing at the text the buyer saw.
 */
const licenseTemplateSchema = new mongoose.Schema(
  {
    key: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    version: {
      type: Number,
      required: true,
      min: 1,
    },
    name: {
      type: String,
      required: true,
      trim: true,
    },
    summary: {
      type: String,
      required: true,
      trim: true,
    },
    /** Full human-readable terms shown on the receipt. */
    termsText: {
      type: String,
      required: true,
      minLength: 10,
    },
    /** Machine-readable rights granted, used by entitlement checks. */
    allowedUses: {
      type: [String],
      default: [],
      validate: {
        validator: (v: string[]) => v.length <= 20,
        message: "A license template may declare at most 20 allowed uses",
      },
    },
    /** True when the license permits commercial exploitation. */
    commercialUse: {
      type: Boolean,
      required: true,
    },
    /** True when the buyer must credit the creator in derived works. */
    attributionRequired: {
      type: Boolean,
      default: false,
    },
    /** True when buyers may redistribute or resell the prompt output. */
    redistributionAllowed: {
      type: Boolean,
      default: false,
    },
    /** Admin-only maintenance flag; draft templates cannot be applied. */
    active: {
      type: Boolean,
      default: true,
      index: true,
    },
  },
  { timestamps: true },
);

licenseTemplateSchema.index({ key: 1, version: 1 }, { unique: true });

const LicenseTemplate =
  mongoose.models.LicenseTemplate ||
  mongoose.model("LicenseTemplate", licenseTemplateSchema);

export default LicenseTemplate;
