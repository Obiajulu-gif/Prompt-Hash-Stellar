import mongoose, { type Document, type Model } from "mongoose";

export const EXTERNAL_IDENTITY_STATUSES = ["active", "unlinked"] as const;
export type ExternalIdentityStatus = (typeof EXTERNAL_IDENTITY_STATUSES)[number];

export interface IExternalIdentityLink extends Document {
  walletAddress: string;
  provider: string;
  subject: string;
  status: ExternalIdentityStatus;
  verificationMethod: string;
  verificationHash: string;
  verifiedAt: Date;
  linkedAt: Date;
  unlinkedAt?: Date;
  unlinkReason?: string;
}

const externalIdentityLinkSchema = new mongoose.Schema<IExternalIdentityLink>(
  {
    walletAddress: { type: String, required: true, lowercase: true, index: true },
    provider: { type: String, required: true, lowercase: true, trim: true },
    subject: { type: String, required: true, trim: true },
    status: { type: String, required: true, enum: EXTERNAL_IDENTITY_STATUSES, default: "active" },
    verificationMethod: { type: String, required: true, trim: true },
    // A digest is retained for audit correlation; raw signatures and tokens are never stored.
    verificationHash: { type: String, required: true },
    verifiedAt: { type: Date, required: true },
    linkedAt: { type: Date, required: true, default: Date.now },
    unlinkedAt: { type: Date, default: null },
    unlinkReason: { type: String, trim: true, maxlength: 500, default: null },
  },
  { timestamps: true },
);

// A provider subject can belong to only one wallet while active, and a wallet
// can have at most one active identity per provider.
externalIdentityLinkSchema.index(
  { provider: 1, subject: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);
externalIdentityLinkSchema.index(
  { walletAddress: 1, provider: 1 },
  { unique: true, partialFilterExpression: { status: "active" } },
);

const ExternalIdentityLink = (mongoose.models.ExternalIdentityLink ||
  mongoose.model<IExternalIdentityLink>("ExternalIdentityLink", externalIdentityLinkSchema)) as Model<IExternalIdentityLink>;

export default ExternalIdentityLink;
