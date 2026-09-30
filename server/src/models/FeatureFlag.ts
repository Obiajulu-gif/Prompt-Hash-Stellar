import mongoose from "mongoose";

export type FeatureFlagEnvironment = "development" | "staging" | "production";
export type FeatureFlagStatus = "enabled" | "disabled" | "experimental";

export interface IFeatureFlag extends mongoose.Document {
  name: string;
  description: string;
  status: FeatureFlagStatus;
  environments: {
    [key in FeatureFlagEnvironment]?: boolean;
  };
  rolloutPercentage: number;
  createdBy: string;
  createdAt: Date;
  updatedAt: Date;
}

const featureFlagSchema = new mongoose.Schema<IFeatureFlag>(
  {
    name: {
      type: String,
      required: true,
      unique: true,
      trim: true,
      lowercase: true,
      index: true,
    },
    description: {
      type: String,
      required: true,
      trim: true,
      maxlength: 500,
    },
    status: {
      type: String,
      enum: ["enabled", "disabled", "experimental"],
      default: "disabled",
      index: true,
    },
    environments: {
      type: {
        development: Boolean,
        staging: Boolean,
        production: Boolean,
      },
      default: {
        development: false,
        staging: false,
        production: false,
      },
    },
    rolloutPercentage: {
      type: Number,
      min: 0,
      max: 100,
      default: 0,
    },
    createdBy: {
      type: String,
      required: true,
    },
  },
  { timestamps: true }
);

featureFlagSchema.index({ name: 1 });
featureFlagSchema.index({ status: 1 });

const FeatureFlag =
  mongoose.models.FeatureFlag ||
  mongoose.model<IFeatureFlag>("FeatureFlag", featureFlagSchema);

export default FeatureFlag;
