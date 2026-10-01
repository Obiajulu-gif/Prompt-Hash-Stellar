import mongoose, { Document, Schema } from "mongoose";

export interface IExportRecord extends Document {
  userId: string; // the user who owns the exported data
  promptIds: string[]; // exported prompt IDs
  scope: "PROMPT" | "HISTORY" | "FULL";
  status: "pending" | "completed" | "failed" | "expired";
  fileUrl?: string; // signed URL where export can be downloaded
  integrityChecksum?: string;
  generatedAt: Date;
  expiresAt: Date;
  metadata: {
    schemaVersion: string;
    recordCount: number;
    includeWalletHashes: boolean;
    includeHistory: boolean;
  };
  auditTrail: {
    action: string;
    performedBy: string;
    performedAt: Date;
    reason: string;
  };
}

/**
 * Export scope definitions - what record types are included in each export mode.
 */
export const EXPORT_SCOPES = {
  PROMPT: "prompt", // Only prompts owned by the user
  HISTORY: "history", // Prompt history/lifecycle events
  FULL: "full", // Prompts + full history + metadata
} as const;

export type ExportScope = keyof typeof EXPORT_SCOPES;

/**
 * Export retention configuration.
 * Exports are retained for 24 hours after generation, then automatically cleaned up.
 */
export const EXPORT_RETENTION_MS = 24 * 60 * 60 * 1000; // 24 hours

const exportSchema = new Schema(
  {
    userId: {
      type: Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    promptIds: {
      type: [String],
      default: [],
    },
    scope: {
      type: String,
      enum: ["prompt", "history", "full"],
      default: "prompt",
    },
    status: {
      type: String,
      enum: ["pending", "completed", "failed", "expired"],
      default: "pending",
    },
    fileUrl: {
      type: String,
      // Optional: signed URL for download; set when export completes
    },
    integrityChecksum: {
      type: String,
      // SHA-256 checksum of the exported data for integrity verification
    },
    generatedAt: {
      type: Date,
      default: Date.now,
    },
    expiresAt: {
      type: Date,
      // Auto-calculated based on retention policy; set on creation if not provided
    },
    metadata: {
      schemaVersion: {
        type: String,
        default: "1.0.0",
      },
      recordCount: {
        type: Number,
        default: 0,
      },
      includeWalletHashes: {
        type: Boolean,
        default: true,
      },
      includeHistory: {
        type: Boolean,
        default: false,
      },
    },
    auditTrail: {
      action: {
        type: String,
        required: true,
      },
      performedBy: {
        type: String,
        required: true,
      },
      performedAt: {
        type: Date,
        default: Date.now,
      },
      reason: {
        type: String,
        required: true,
      },
    },
  },
  { timestamps: true }
);

// Index for efficient user-owned export queries
exportSchema.index({ userId: 1, status: 1, expiresAt: 1 });

export const ExportRecord =
  mongoose.models.ExportRecord ||
  mongoose.model<IExportRecord>("ExportRecord", exportSchema);