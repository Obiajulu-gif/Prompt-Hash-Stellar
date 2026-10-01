import mongoose from "mongoose";

export type CheckSeverity = "warning" | "blocking";
export type CheckStatus = "passed" | "failed";

export interface QualityCheck {
  name: string;
  description: string;
  severity: CheckSeverity;
  passed: boolean;
  message?: string;
}

export interface IQualityCheckResult extends mongoose.Document {
  promptId: string;
  checks: QualityCheck[];
  overallStatus: CheckStatus;
  passedAt?: Date;
  blockedAt?: Date;
  overriddenAt?: Date;
  overriddenBy?: string;
  overrideReason?: string;
  createdAt: Date;
  updatedAt: Date;
}

const qualityCheckSchema = new mongoose.Schema(
  {
    name: {
      type: String,
      required: true,
    },
    description: {
      type: String,
      required: true,
    },
    severity: {
      type: String,
      enum: ["warning", "blocking"],
      required: true,
    },
    passed: {
      type: Boolean,
      required: true,
    },
    message: {
      type: String,
    },
  },
  { _id: false }
);

const qualityCheckResultSchema = new mongoose.Schema<IQualityCheckResult>(
  {
    promptId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    checks: {
      type: [qualityCheckSchema],
      default: [],
    },
    overallStatus: {
      type: String,
      enum: ["passed", "failed"],
      default: "passed",
      index: true,
    },
    passedAt: {
      type: Date,
    },
    blockedAt: {
      type: Date,
    },
    overriddenAt: {
      type: Date,
    },
    overriddenBy: {
      type: String,
      lowercase: true,
    },
    overrideReason: {
      type: String,
      maxlength: 500,
    },
  },
  { timestamps: true }
);

qualityCheckResultSchema.index({ promptId: 1 });
qualityCheckResultSchema.index({ overallStatus: 1 });
qualityCheckResultSchema.index({ overriddenBy: 1 });

const QualityCheckResult =
  mongoose.models.QualityCheckResult ||
  mongoose.model<IQualityCheckResult>("QualityCheckResult", qualityCheckResultSchema);

export default QualityCheckResult;
