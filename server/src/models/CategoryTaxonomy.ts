/**
 * Category Taxonomy Management Model (#xyz)
 * 
 * Manages category lifecycle: active, renamed, merged, deprecated.
 * Preserves stable category IDs separate from slugs for redirect support.
 * Logs taxonomy changes for audit trail.
 */

import mongoose from 'mongoose';

export enum CategoryLifecycleState {
  ACTIVE = 'active',
  RENAMED = 'renamed',      // Slug changed, old slug redirects here
  MERGED = 'merged',        // Category merged into another, old slug redirects
  DEPRECATED = 'deprecated', // No longer used, marked for removal
}

export interface CategoryTaxonomyDoc {
  _id: mongoose.Types.ObjectId;
  categoryId: string;           // Stable UUID, never changes
  slug: string;                 // Current slug (used in URLs/filters)
  displayName: string;          // User-facing name
  state: CategoryLifecycleState;
  description?: string;
  promptCount: number;          // Denormalized for quick stats
  
  // Redirect/merge tracking
  redirectsFrom?: string[];     // Old slugs that redirect here
  mergedIntoId?: string;        // If MERGED, which category it merged into
  redirectTarget?: string;      // If RENAMED or MERGED, points to new slug
  
  // Audit trail
  createdAt: Date;
  updatedAt: Date;
  changedBy?: string;           // Admin wallet address
  changeReason?: string;        // Why this change was made
  changeLog?: Array<{
    timestamp: Date;
    action: 'created' | 'renamed' | 'merged' | 'deprecated' | 'restored';
    oldValue?: string;
    newValue?: string;
    reason?: string;
    admin?: string;
  }>;
}

const categoryTaxonomySchema = new mongoose.Schema<CategoryTaxonomyDoc>(
  {
    categoryId: {
      type: String,
      required: true,
      unique: true,
      index: true,
    },
    slug: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
      unique: true,
      index: true,
    },
    displayName: {
      type: String,
      required: true,
      trim: true,
    },
    state: {
      type: String,
      enum: Object.values(CategoryLifecycleState),
      default: CategoryLifecycleState.ACTIVE,
      index: true,
    },
    description: String,
    promptCount: {
      type: Number,
      default: 0,
      min: 0,
    },
    redirectsFrom: {
      type: [String],
      default: [],
    },
    mergedIntoId: String,
    redirectTarget: String,
    changedBy: String,
    changeReason: String,
    changeLog: [
      {
        timestamp: { type: Date, default: Date.now },
        action: String,
        oldValue: String,
        newValue: String,
        reason: String,
        admin: String,
      },
    ],
  },
  { timestamps: true }
);

// Index for querying active categories
categoryTaxonomySchema.index({ state: 1, slug: 1 });

// Index for finding redirects
categoryTaxonomySchema.index({ redirectsFrom: 1 });

// Index for category merges
categoryTaxonomySchema.index({ mergedIntoId: 1 });

const CategoryTaxonomy =
  mongoose.models.CategoryTaxonomy ||
  mongoose.model<CategoryTaxonomyDoc>('CategoryTaxonomy', categoryTaxonomySchema);

export default CategoryTaxonomy;
