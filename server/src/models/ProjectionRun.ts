import mongoose from "mongoose";

/**
 * Projection rebuild bookkeeping for the event replay tool (#1024).
 *
 * ProjectionRun      — one replay of the journal into a projection version:
 *                      status, checkpoint (for resume), counters, and the
 *                      unsupported-version samples an operator must review.
 * ProjectionDocument — the rows a run produced, isolated by `runId`, so a
 *                      rebuild never touches the projection currently served.
 * ProjectionPointer  — which completed run is active per projection, plus the
 *                      previous one so activation can be rolled back.
 */

export type ProjectionRunStatus = "pending" | "running" | "failed" | "completed";

const projectionRunSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true, unique: true },
    projection: { type: String, required: true, index: true },
    projectionVersion: { type: Number, required: true },
    mode: { type: String, enum: ["build", "dry_run"], required: true },
    strict: { type: Boolean, default: true },
    status: {
      type: String,
      enum: ["pending", "running", "failed", "completed"],
      default: "pending",
      index: true,
    },
    startedBy: { type: String, required: true },
    checkpoint: {
      ledger: { type: Number, default: 0 },
      eventId: { type: String, default: "" },
    },
    counts: {
      applied: { type: Number, default: 0 },
      ignored: { type: Number, default: 0 },
      unsupported: { type: Number, default: 0 },
      malformed: { type: Number, default: 0 },
    },
    unsupportedSamples: { type: [mongoose.Schema.Types.Mixed], default: [] },
    malformedSamples: { type: [mongoose.Schema.Types.Mixed], default: [] },
    documents: { type: Number, default: 0 },
    attempts: { type: Number, default: 0 },
    leaseExpiresAt: { type: Date, default: null },
    error: { type: String, default: null },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

const projectionDocumentSchema = new mongoose.Schema(
  {
    runId: { type: String, required: true },
    projection: { type: String, required: true },
    key: { type: String, required: true },
    doc: { type: mongoose.Schema.Types.Mixed, required: true },
  },
  { timestamps: true },
);
projectionDocumentSchema.index({ runId: 1, key: 1 }, { unique: true });

const projectionPointerSchema = new mongoose.Schema(
  {
    projection: { type: String, required: true, unique: true },
    activeRunId: { type: String, default: null },
    activeVersion: { type: Number, default: null },
    previousRunId: { type: String, default: null },
    previousVersion: { type: Number, default: null },
    activatedBy: { type: String, default: null },
    activatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const ProjectionRun =
  mongoose.models.ProjectionRun || mongoose.model("ProjectionRun", projectionRunSchema);
export const ProjectionDocument =
  mongoose.models.ProjectionDocument || mongoose.model("ProjectionDocument", projectionDocumentSchema);
export const ProjectionPointer =
  mongoose.models.ProjectionPointer || mongoose.model("ProjectionPointer", projectionPointerSchema);
