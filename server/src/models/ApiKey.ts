import mongoose from "mongoose";

export const API_KEY_SCOPES = [
  "listings:read",
  "purchases:read",
  "creator:manage",
] as const;

export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

const apiKeySchema = new mongoose.Schema(
  {
    keyId: { type: String, required: true, unique: true, index: true },
    keyHash: { type: String, required: true, unique: true, select: false },
    keyPrefix: { type: String, required: true },
    walletAddress: { type: String, required: true, lowercase: true, index: true },
    name: { type: String, required: true, trim: true, maxlength: 80 },
    scopes: {
      type: [String],
      required: true,
      enum: API_KEY_SCOPES,
    },
    revokedAt: { type: Date, default: null, index: true },
    expiresAt: { type: Date, default: null, index: true },
    lastUsedAt: { type: Date, default: null },
    lastUsedIp: { type: String, default: null },
    lastUsedUserAgent: { type: String, default: null },
    usageCount: { type: Number, default: 0 },
    replacedByKeyId: { type: String, default: null },
  },
  { timestamps: true },
);

apiKeySchema.index({ walletAddress: 1, createdAt: -1 });

const ApiKey = mongoose.models.ApiKey || mongoose.model("ApiKey", apiKeySchema);

export default ApiKey;