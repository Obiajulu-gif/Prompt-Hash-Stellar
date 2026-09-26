import mongoose from "mongoose";

/**
 * Explicit provenance relationship between two prompt listings (#753).
 *
 * Each record is one directed edge from a derivative listing (`promptId`) to
 * the listing it came from (`relatedPromptId`), both on-chain prompt ids.
 * Lineage is always rebuilt from these records — never from free-form or
 * mutable prompt metadata — and services/provenance.ts refuses edges that
 * would create a cycle.
 *
 *   parent — a new edition of the related listing by the same creator
 *   fork   — a copy of the related listing that has since diverged
 *   remix  — a derivative that adapts or combines the related listing
 *   source — attribution to the original the listing is based on
 */
export const PROVENANCE_KINDS = ["parent", "fork", "remix", "source"] as const;
export type ProvenanceKind = (typeof PROVENANCE_KINDS)[number];

/**
 * creator  — declared by the derivative listing's owner
 * backfill — migrated from legacy similarity detection; unconfirmed until
 *            the creator declares (or removes) it
 */
export const PROVENANCE_ORIGINS = ["creator", "backfill"] as const;
export type ProvenanceOrigin = (typeof PROVENANCE_ORIGINS)[number];

const promptRelationSchema = new mongoose.Schema(
  {
    promptId: { type: String, required: true },
    relatedPromptId: { type: String, required: true },
    kind: { type: String, enum: PROVENANCE_KINDS, required: true },
    origin: { type: String, enum: PROVENANCE_ORIGINS, default: "creator" },
    declaredBy: { type: String, lowercase: true, default: null },
  },
  { timestamps: true },
);

// One relationship per ordered pair; ancestors are walked by promptId and
// derivatives by relatedPromptId.
promptRelationSchema.index({ promptId: 1, relatedPromptId: 1 }, { unique: true });
promptRelationSchema.index({ relatedPromptId: 1, kind: 1 });
promptRelationSchema.index({ origin: 1, updatedAt: -1 });

const PromptRelation =
  mongoose.models.PromptRelation || mongoose.model("PromptRelation", promptRelationSchema);

export default PromptRelation;
