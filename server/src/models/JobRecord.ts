import mongoose from "mongoose";

/**
 * Durable job record — Issue: background jobs
 *
 * Keep payloads small and versioned: `payload.version` is required, max ~1KB JSON.
 * Long-running work must happen in the worker, never in request handlers.
 */

export type JobType =
  | "settlement_poll"
  | "entitlement_repair"
  | "analytics_aggregate"
  | "export_csv"
  | "stale_dispute_cleanup"
  | "retention_cleanup";

export type JobStatus = "pending" | "processing" | "completed" | "failed" | "dead_letter";

const jobRecordSchema = new mongoose.Schema(
  {
    type: { type: String, required: true, index: true, enum: ["settlement_poll", "entitlement_repair", "analytics_aggregate", "export_csv", "stale_dispute_cleanup", "retention_cleanup"] },
    status: { type: String, required: true, index: true, enum: ["pending", "processing", "completed", "failed", "dead_letter"], default: "pending" },
    payload: { type: mongoose.Schema.Types.Mixed, required: true },
    payloadVersion: { type: Number, required: true, default: 1 },
    dedupeKey: { type: String, index: true, sparse: true },
    attempts: { type: Number, default: 0 },
    maxAttempts: { type: Number, default: 5 },
    lastError: { type: String, default: null },
    nextRunAt: { type: Date, default: () => new Date(), index: true },
    lockedAt: { type: Date, default: null },
    lockedBy: { type: String, default: null },
    completedAt: { type: Date, default: null },
    archivedAt: { type: Date, default: null, index: true },
    retentionHold: { type: Boolean, default: false, index: true },
    retentionHoldReason: { type: String, default: null },
    // Observability: keep a bounded history of attempts (last 10)
    attemptHistory: {
      type: [{ attempt: Number, at: Date, error: String }],
      default: [],
    },
  },
  { timestamps: true }
);

jobRecordSchema.index({ status: 1, nextRunAt: 1 });
jobRecordSchema.index({ type: 1, dedupeKey: 1 }, { sparse: true });
jobRecordSchema.index({ type: 1, status: 1, completedAt: 1, archivedAt: 1, retentionHold: 1 });

const JobRecord = mongoose.models.JobRecord || mongoose.model("JobRecord", jobRecordSchema);
export default JobRecord;
