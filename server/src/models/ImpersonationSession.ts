import mongoose, { Document, Schema } from "mongoose";

export type ImpersonationScope = "READ_ONLY" | "REPRODUCE_ISSUE" | "BILLING_VIEW" | "FULL_MAINTAINER";

export interface IImpersonationAuditEvent {
  action: string;
  path: string;
  method: string;
  status: "ALLOWED" | "BLOCKED" | "ELEVATED_CONFIRMED";
  timestamp: Date;
  details?: Record<string, unknown>;
}

export interface IImpersonationSession extends Document {
  sessionId: string;
  maintainerId: string;
  targetUserId: string;
  supportTicketId?: string;
  reason: string;
  scope: ImpersonationScope;
  isActive: boolean;
  expiresAt: Date;
  auditTrail: IImpersonationAuditEvent[];
  elevatedMutationConfirmed: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const auditEventSchema = new Schema({
  action: { type: String, required: true },
  path: { type: String, required: true },
  method: { type: String, required: true },
  status: {
    type: String,
    enum: ["ALLOWED", "BLOCKED", "ELEVATED_CONFIRMED"],
    required: true,
  },
  timestamp: { type: Date, default: Date.now },
  details: { type: Schema.Types.Mixed },
});

const impersonationSessionSchema = new Schema(
  {
    sessionId: { type: String, required: true, unique: true, index: true },
    maintainerId: { type: String, required: true, index: true },
    targetUserId: { type: String, required: true, index: true },
    supportTicketId: { type: String },
    reason: { type: String, required: true },
    scope: {
      type: String,
      enum: ["READ_ONLY", "REPRODUCE_ISSUE", "BILLING_VIEW", "FULL_MAINTAINER"],
      default: "READ_ONLY",
      required: true,
    },
    isActive: { type: Boolean, default: true, index: true },
    expiresAt: { type: Date, required: true, index: true },
    auditTrail: [auditEventSchema],
    elevatedMutationConfirmed: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const ImpersonationSession =
  mongoose.models.ImpersonationSession ||
  mongoose.model<IImpersonationSession>(
    "ImpersonationSession",
    impersonationSessionSchema
  );
