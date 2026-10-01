import mongoose from "mongoose";

/**
 * Every action code the audit trail accepts. Grouped by the export scope they
 * belong to (see `AUDIT_EXPORT_SCOPES` in services/auditTrail.ts).
 */
export const AUDIT_ACTIONS = [
  // unlock / challenge flow
  "challenge_issued",
  "challenge_rate_limited",
  "unlock_success",
  "unlock_invalid_signature",
  "unlock_expired_challenge",
  "unlock_no_access",
  "unlock_integrity_failure",
  "unlock_error",
  "unlock_rate_limited",
  "unlock_replay_detected",
  "unlock_ledger_failure",
  "unlock_stale_quote",
  "unlock_stale_listing_snapshot",
  // admin access
  "admin_auth_success",
  "admin_auth_denied",
  "audit_export",
  "audit_sensitive_field_access",
  "audit_sensitive_field_denied",
  // moderation (api/prompts/moderate.ts)
  "prompt_restrict",
  "prompt_reinstate",
  "prompt_retire",
  "moderation_unauthorized",
  "moderation_error",
  // disputed purchase resolution (#755)
  "dispute_unlock_failed",
  "dispute_unlock_succeeded",
  "dispute_refund_requested",
  "dispute_retry_scheduled",
  "dispute_refund_approved",
  "dispute_refund_rejected",
  "dispute_resolved",
  "dispute_escalated",
  "dispute_refund_settled",
  // ownership and access changes
  "ownership_transfer_requested",
  "ownership_transfer_accepted",
  "ownership_transfer_rejected",
  "ownership_transfer_cancelled",
  "role_assigned",
  "role_revoked",
  "permission_granted",
  "permission_revoked",
  "access_granted",
  "access_revoked",
  "entitlement_repair",
  "policy_override_created",
  "policy_override_revoked",
  "operation_recovery",
  "receipt_generated",
  "prompt_lifecycle_transition",
  "prompt_lifecycle_transition_denied",
  "moderation.override",
  "identity_link",
  "identity_unlink",
] as const;

export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export type AuditResult = "success" | "failure" | "blocked";

const auditLogSchema = new mongoose.Schema(
  {
    action: {
      type: String,
      required: true,
      enum: AUDIT_ACTIONS,
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
    // Who performed the action when it is not a wallet — e.g. the admin
    // token subject for admin/moderation/dispute actions (#783).
    actor: {
      type: String,
      default: null,
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
    // Target resource and type for ownership and access mutations
    target: {
      type: String,
      default: null,
      index: true,
    },
    targetType: {
      type: String,
      default: null,
      index: true,
    },
    beforeState: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    afterState: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: null,
    },
    recordHash: {
      type: String,
      required: true,
      index: true,
    },
    previousHash: {
      type: String,
      required: true,
    },
    // Hash algorithm used for `recordHash`. Records written before #783 have
    // no value and are verified with the legacy (version 1) field set.
    integrityVersion: {
      type: Number,
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
// Filtered, chronological exports (#783).
auditLogSchema.index({ createdAt: 1, _id: 1 });
auditLogSchema.index({ actor: 1, createdAt: 1 });
auditLogSchema.index({ target: 1, targetType: 1, createdAt: -1 });
auditLogSchema.index({ targetType: 1, action: 1, createdAt: -1 });

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
