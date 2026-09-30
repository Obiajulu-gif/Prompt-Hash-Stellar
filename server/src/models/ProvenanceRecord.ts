import mongoose from "mongoose";

/**
 * Provenance tracking for imported and derived prompt records (Issue #929).
 *
 * This model captures the full lineage of how a prompt entered the system:
 * - Import source (external API, file upload, migration, etc.)
 * - Import batch (grouping of related imports)
 * - Transform operations applied
 * - Actor who performed the operation
 *
 * Design principles:
 * 1. Immutable - provenance records are never modified after creation
 * 2. Comprehensive - captures all metadata needed to trace origin
 * 3. Queryable - indexed for efficient lineage and audit queries
 * 4. Complements PromptRelation - that tracks prompt-to-prompt relationships,
 *    this tracks prompt-to-external-source relationships
 */

/**
 * The type of import source that created this prompt.
 */
export const IMPORT_SOURCE_TYPES = [
  "manual",           // Manually created by user via UI
  "api",              // Created via REST API
  "file_upload",      // Bulk imported from file (CSV, JSON, etc.)
  "migration",        // Migrated from legacy system
  "external_api",     // Fetched from external marketplace/API
  "fork",             // Forked from another prompt (complements PromptRelation)
  "template",         // Generated from a template
  "ai_generated",     // AI-generated content
  "system",           // System-generated (e.g., seed data)
] as const;
export type ImportSourceType = (typeof IMPORT_SOURCE_TYPES)[number];

/**
 * The type of transformation applied to create this prompt.
 */
export const TRANSFORM_TYPES = [
  "none",             // No transformation (original import)
  "translation",      // Translated to different language
  "summarization",    // Summarized/shortened from original
  "expansion",        // Expanded with additional details
  "format_conversion",// Converted between formats (markdown, plain text, etc.)
  "ai_enhancement",   // AI-improved or refined
  "merge",            // Merged from multiple sources
  "extraction",       // Extracted from larger content
  "customization",    // Customized for specific use case
] as const;
export type TransformType = (typeof TRANSFORM_TYPES)[number];

/**
 * The status of the import/transform operation.
 */
export const IMPORT_STATUSES = [
  "pending",          // Import initiated but not complete
  "processing",       // Currently being processed
  "completed",        // Successfully completed
  "failed",           // Failed with errors
  "partial",          // Partially completed (some items failed)
  "rollback",         // Rolled back due to errors
] as const;
export type ImportStatus = (typeof IMPORT_STATUSES)[number];

/**
 * Interface for import batch metadata.
 */
export interface IImportBatch {
  batchId: string;                    // Unique identifier for the batch
  batchName?: string;                 // Human-readable batch name
  totalItems: number;                 // Total items in batch
  successfulItems: number;            // Successfully imported items
  failedItems: number;                // Failed items
  status: ImportStatus;               // Overall batch status
  startedAt: Date;                    // When batch started
  completedAt?: Date;                 // When batch completed
  errorSummary?: string;              // Summary of errors if any
}

/**
 * Interface for source system metadata.
 */
export interface ISourceSystem {
  systemName: string;                 // Name of source system
  systemVersion?: string;             // Version of source system
  systemUrl?: string;                 // URL to source system
  externalId?: string;                // ID in source system
  externalUrl?: string;               // Direct URL to source item
  apiEndpoint?: string;               // API endpoint used for import
  apiVersion?: string;                // API version
}

/**
 * Interface for transformation metadata.
 */
export interface ITransformMetadata {
  transformType: TransformType;       // Type of transformation
  transformVersion: string;           // Version of transform logic
  transformConfig?: Record<string, any>; // Transform-specific config
  transformedFields?: string[];       // Which fields were transformed
  transformTimestamp: Date;           // When transform was applied
  transformDuration?: number;         // Duration in milliseconds
}

/**
 * Interface for actor metadata.
 */
export interface IActorMetadata {
  actorType: "user" | "system" | "service" | "admin"; // Type of actor
  actorId: string;                    // ID of the actor
  actorName?: string;                 // Display name
  actorWallet?: string;               // Stellar wallet address if applicable
  actorEmail?: string;                // Email if applicable
  actorRole?: string;                 // Role/permission level
  actorIp?: string;                   // IP address
  actorUserAgent?: string;            // User agent string
}

/**
 * Main provenance record schema.
 */
const provenanceRecordSchema = new mongoose.Schema(
  {
    // Reference to the prompt this provenance applies to
    promptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Prompt",
      required: true,
      index: true,
    },
    
    // On-chain ID if prompt is published on-chain
    onChainId: {
      type: String,
      index: true,
      sparse: true,
    },

    // Import source information
    sourceType: {
      type: String,
      enum: IMPORT_SOURCE_TYPES,
      required: true,
      index: true,
    },
    
    sourceSystem: {
      systemName: { type: String, required: true },
      systemVersion: { type: String },
      systemUrl: { type: String },
      externalId: { type: String, index: true },
      externalUrl: { type: String },
      apiEndpoint: { type: String },
      apiVersion: { type: String },
    },

    // Import batch information (null for individual imports)
    importBatch: {
      batchId: { type: String, index: true },
      batchName: { type: String },
      totalItems: { type: Number, min: 0 },
      successfulItems: { type: Number, min: 0 },
      failedItems: { type: Number, min: 0 },
      status: {
        type: String,
        enum: IMPORT_STATUSES,
      },
      startedAt: { type: Date },
      completedAt: { type: Date },
      errorSummary: { type: String },
    },

    // Transformation information (null if no transformation)
    transformations: [{
      transformType: {
        type: String,
        enum: TRANSFORM_TYPES,
        required: true,
      },
      transformVersion: { type: String, required: true },
      transformConfig: { type: mongoose.Schema.Types.Mixed },
      transformedFields: [{ type: String }],
      transformTimestamp: { type: Date, required: true },
      transformDuration: { type: Number, min: 0 },
    }],

    // Actor who performed the import/transform
    actor: {
      actorType: {
        type: String,
        enum: ["user", "system", "service", "admin"],
        required: true,
      },
      actorId: { type: String, required: true, index: true },
      actorName: { type: String },
      actorWallet: { type: String, lowercase: true, index: true },
      actorEmail: { type: String, lowercase: true },
      actorRole: { type: String },
      actorIp: { type: String },
      actorUserAgent: { type: String },
    },

    // Parent provenance record (for derived records)
    parentProvenanceId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "ProvenanceRecord",
      index: true,
      default: null,
    },

    // Source prompt (for derived records)
    sourcePromptId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Prompt",
      index: true,
      default: null,
    },

    // Additional metadata (flexible for future extensions)
    metadata: {
      type: mongoose.Schema.Types.Mixed,
      default: {},
    },

    // Verification/integrity
    verificationStatus: {
      type: String,
      enum: ["unverified", "verified", "disputed", "invalid"],
      default: "unverified",
      index: true,
    },
    
    verificationTimestamp: {
      type: Date,
      default: null,
    },

    verificationNotes: {
      type: String,
      default: "",
    },

    // Soft delete support
    isDeleted: {
      type: Boolean,
      default: false,
      index: true,
    },

    deletedAt: {
      type: Date,
      default: null,
    },

    deletedBy: {
      type: String,
      default: null,
    },

    deletionReason: {
      type: String,
      default: null,
    },
  },
  {
    timestamps: true, // Adds createdAt and updatedAt
    collection: "provenance_records",
  }
);

// Compound indexes for common queries
provenanceRecordSchema.index({ promptId: 1, createdAt: -1 });
provenanceRecordSchema.index({ "importBatch.batchId": 1, createdAt: -1 });
provenanceRecordSchema.index({ "actor.actorId": 1, createdAt: -1 });
provenanceRecordSchema.index({ sourceType: 1, createdAt: -1 });
provenanceRecordSchema.index({ "sourceSystem.externalId": 1 });
provenanceRecordSchema.index({ parentProvenanceId: 1, promptId: 1 });
provenanceRecordSchema.index({ isDeleted: 1, verificationStatus: 1 });

// Text index for full-text search on metadata
provenanceRecordSchema.index({
  "sourceSystem.systemName": "text",
  "importBatch.batchName": "text",
  "actor.actorName": "text",
  "metadata": "text",
});

/**
 * Virtual for getting the full lineage chain.
 */
provenanceRecordSchema.virtual("lineage").get(async function (this: any) {
  const lineage = [this];
  let current = this;
  
  while (current.parentProvenanceId) {
    const parent = await ProvenanceRecord.findById(current.parentProvenanceId);
    if (!parent) break;
    lineage.unshift(parent);
    current = parent;
  }
  
  return lineage;
});

/**
 * Instance method: Get all descendant records.
 */
provenanceRecordSchema.methods.getDescendants = async function () {
  const descendants: any[] = [];
  const queue = [this._id];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const currentId = queue.shift()!;
    if (visited.has(currentId.toString())) continue;
    visited.add(currentId.toString());

    const children = await ProvenanceRecord.find({
      parentProvenanceId: currentId,
      isDeleted: false,
    });

    for (const child of children) {
      descendants.push(child);
      queue.push(child._id);
    }
  }

  return descendants;
};

/**
 * Static method: Find all records in a batch.
 */
provenanceRecordSchema.statics.findByBatch = function (batchId: string) {
  return this.find({
    "importBatch.batchId": batchId,
    isDeleted: false,
  }).sort({ createdAt: 1 });
};

/**
 * Static method: Find all records by actor.
 */
provenanceRecordSchema.statics.findByActor = function (actorId: string, limit = 100) {
  return this.find({
    "actor.actorId": actorId,
    isDeleted: false,
  })
    .sort({ createdAt: -1 })
    .limit(limit);
};

/**
 * Static method: Get import statistics for a time range.
 */
provenanceRecordSchema.statics.getImportStats = async function (params: {
  startDate?: Date;
  endDate?: Date;
  sourceType?: ImportSourceType;
  actorId?: string;
}) {
  const { startDate, endDate, sourceType, actorId } = params;
  
  const matchStage: any = { isDeleted: false };
  if (startDate || endDate) {
    matchStage.createdAt = {};
    if (startDate) matchStage.createdAt.$gte = startDate;
    if (endDate) matchStage.createdAt.$lte = endDate;
  }
  if (sourceType) matchStage.sourceType = sourceType;
  if (actorId) matchStage["actor.actorId"] = actorId;

  const stats = await this.aggregate([
    { $match: matchStage },
    {
      $group: {
        _id: {
          sourceType: "$sourceType",
          status: "$importBatch.status",
        },
        count: { $sum: 1 },
        totalTransformations: {
          $sum: { $size: { $ifNull: ["$transformations", []] } },
        },
      },
    },
    { $sort: { "_id.sourceType": 1 } },
  ]);

  return stats;
};

/**
 * Pre-save hook: Validate parent-child consistency.
 */
provenanceRecordSchema.pre("save", async function (next) {
  // Ensure sourcePromptId is set if parentProvenanceId is set
  if (this.parentProvenanceId && !this.sourcePromptId) {
    const parent = await ProvenanceRecord.findById(this.parentProvenanceId);
    if (parent) {
      this.sourcePromptId = parent.promptId;
    }
  }
  
  next();
});

const ProvenanceRecord =
  mongoose.models.ProvenanceRecord ||
  mongoose.model("ProvenanceRecord", provenanceRecordSchema);

export default ProvenanceRecord;
