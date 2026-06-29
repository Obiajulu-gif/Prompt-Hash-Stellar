import mongoose from "mongoose";

export type AuditAction =
  | "challenge_issued"
  | "challenge_rate_limited"
  | "unlock_success"
  | "unlock_invalid_signature"
  | "unlock_expired_challenge"
  | "unlock_no_access"
  | "unlock_integrity_failure"
  | "unlock_error"
  | "unlock_rate_limited";

export type AuditResult = "success" | "failure" | "blocked";

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: [
        "challenge_issued",
        "challenge_rate_limited",
        "unlock_success",
        "unlock_invalid_signature",
        "unlock_expired_challenge",
        "unlock_no_access",
        "unlock_integrity_failure",
        "unlock_error",
        "unlock_rate_limited",
      ] as AuditAction[],
      index: true,
    },
    result: {
      type: String,
      required: true,
      enum: ["success", "failure", "blocked"] as AuditResult[],
      index: true,
    },
    promptId: {
      type: String,
      default: null,
      index: true,
    },
    walletAddress: {
      type: String,
      default: null,
      lowercase: true,
      index: true,
    },
    requestId: {
      type: String,
      default: null,
      index: true,
    },
    clientIp: {
      type: String,
      default: null,
    },
    reason: {
      type: String,
      default: null,
    },
    // Sensitive fields are NEVER stored — only stable reason codes above.
    // No plaintext, no keys, no raw signatures, no challenge secrets.
  },
  {
    timestamps: true,
    // Append-only: disable update operations at the schema level via middleware.
  },
);

// Compound indexes for common incident-review queries.
auditLogSchema.index({ walletAddress: 1, createdAt: -1 });
auditLogSchema.index({ promptId: 1, createdAt: -1 });
auditLogSchema.index({ action: 1, result: 1, createdAt: -1 });

// Prevent updates — audit records are immutable.
auditLogSchema.pre("findOneAndUpdate", function () {
  throw new Error("AuditLog records are immutable.");
});
auditLogSchema.pre("updateOne", function () {
  throw new Error("AuditLog records are immutable.");
});
auditLogSchema.pre("updateMany", function () {
  throw new Error("AuditLog records are immutable.");
});

export const AuditLog =
  mongoose.models.AuditLog || mongoose.model("AuditLog", auditLogSchema);
