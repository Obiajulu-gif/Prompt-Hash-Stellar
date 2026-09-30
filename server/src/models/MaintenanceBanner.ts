import mongoose, { Schema, type InferDocumentType, type Model } from "mongoose";

/**
 * Scopes that a maintenance banner can target.
 * The client asks for the active banners for a given scope (e.g. "marketplace")
 * and only banners whose scope matches will be returned.
 */
export const MAINTENANCE_SCOPES = [
  "global",
  "marketplace",
  "publishing",
  "buyer-dashboard",
  "creator-dashboard",
  "wallet",
  "api",
] as const;

export type MaintenanceScope = (typeof MAINTENANCE_SCOPES)[number];

export const MAINTENANCE_SEVERITIES = [
  "info",
  "warning",
  "critical",
] as const;

export type MaintenanceSeverity = (typeof MAINTENANCE_SEVERITIES)[number];

export interface MaintenanceBannerDocument extends mongoose.Document {
  /** Human-readable title shown in the banner. */
  title: string;
  /** Markdown-safe message body shown to users. */
  message: string;
  /** Severity level controlling client styling. */
  severity: MaintenanceSeverity;
  /** Scopes this banner applies to. "global" matches every scope. */
  scopes: MaintenanceScope[];
  /** Features affected by the maintenance window. */
  affectedFeatures: string[];
  /** Optional link to a status page or incident report. */
  statusUrl?: string;
  /** When the banner becomes visible. */
  startsAt: Date;
  /** When the banner stops showing. Must be after startsAt. */
  endsAt: Date;
  /** Whether the banner is actively enabled. */
  enabled: boolean;
  /** Admin wallet that created the banner. */
  createdBy: string;
  /** Admin wallet that last updated the banner. */
  updatedBy?: string;
  createdAt: Date;
  updatedAt: Date;
}

export type MaintenanceBannerModel = Model<MaintenanceBannerDocument>;

const maintenanceBannerSchema = new SchemaMaintenanceBannerDocument>(
  {
    title: { type: String, required: true, trim: true, maxlength: 200 },
    message: { type: String, required: true, trim: true, maxlength: 2000 },
    severity: {
      type: String,
      enum: MAINTENANCE_SEVERITIES,
      required: true,
      default: "info",
    },
    scopes: {
      type: [String],
      enum: MAINTENANCE_SCOPES,
      required: true,
      validate: {
        validator: (value: string[]) => value.length > 0,
        message: "At least one scope is required.",
      },
    },
    affectedFeatures: {
      type: [String],
      default: [],
    },
    statusUrl: { type: String, trim: true },
    startsAt: { type: Date, required: true },
    endsAt: { type: Date, required: true },
    enabled: { type: Boolean, required: true, default: true },
    createdBy: { type: String, required: true, trim: true },
    updatedBy: { type: String, trim: true },
  },
  { timestamps: true },
);

// Efficiently find active banners for a scope.
maintenanceBannerSchema.index({ enabled: 1, startsAt: 1, endsAt: 1, scopes: 1 });

export const MaintenanceBanner =
  (mongoose.models.MaintenanceBanner as MaintenanceBannerModel) ||
  mongoose.model<MaintenanceBannerDocument>(
    "MaintenanceBanner",
    maintenanceBannerSchema,
  );

export type MaintenanceBannerLeanConstructor = MaintenanceBannerDocument;
export type MaintenanceBannerInput = InferDocumentType<MaintenanceBannerDocument>;
