/**
 * Category Taxonomy Management Service (#xyz)
 * 
 * Handles category lifecycle operations:
 * - Rename categories (old slug redirects to new)
 * - Merge categories (migrate prompts, set redirects)
 * - Deprecate categories (mark for removal)
 * 
 * All operations are logged for audit trail.
 */

import CategoryTaxonomy, { CategoryLifecycleState, type CategoryTaxonomyDoc } from '../models/CategoryTaxonomy';
import Prompt from '../models/Prompt';
import { recordAuditEvent } from './auditTrail';

/**
 * Create a new category in the taxonomy
 */
export async function createCategory(input: {
  categoryId: string;
  slug: string;
  displayName: string;
  description?: string;
  adminWallet?: string;
}): Promise<CategoryTaxonomyDoc> {
  const normalized = input.slug.toLowerCase().trim();

  // Check for slug conflicts
  const existing = await CategoryTaxonomy.findOne({
    $or: [{ slug: normalized }, { categoryId: input.categoryId }],
  });

  if (existing) {
    throw new Error(`Category already exists: slug or ID conflict (${normalized})`);
  }

  const category = new CategoryTaxonomy({
    categoryId: input.categoryId,
    slug: normalized,
    displayName: input.displayName,
    description: input.description,
    state: CategoryLifecycleState.ACTIVE,
    changeLog: [
      {
        timestamp: new Date(),
        action: 'created',
        newValue: normalized,
        admin: input.adminWallet,
      },
    ],
  });

  const saved = await category.save();

  await recordAuditEvent({
    action: 'category_created',
    result: 'success',
    promptId: null,
    walletAddress: input.adminWallet || null,
    reason: 'category_management',
    metadata: {
      categoryId: input.categoryId,
      slug: normalized,
      displayName: input.displayName,
    },
  });

  return saved;
}

/**
 * Rename a category (old slug becomes redirect, prompt category field unchanged)
 */
export async function renameCategory(input: {
  categoryId: string;
  newSlug: string;
  newDisplayName: string;
  reason?: string;
  adminWallet?: string;
}): Promise<CategoryTaxonomyDoc> {
  const normalized = input.newSlug.toLowerCase().trim();

  // Find category by ID
  const category = await CategoryTaxonomy.findOne({ categoryId: input.categoryId });
  if (!category) {
    throw new Error(`Category not found: ${input.categoryId}`);
  }

  const oldSlug = category.slug;

  // Check for slug conflicts
  const conflicting = await CategoryTaxonomy.findOne({
    slug: normalized,
    categoryId: { $ne: input.categoryId },
  });

  if (conflicting) {
    throw new Error(`Slug conflict: ${normalized} already in use`);
  }

  // Add old slug to redirects
  if (!category.redirectsFrom) {
    category.redirectsFrom = [];
  }
  if (!category.redirectsFrom.includes(oldSlug)) {
    category.redirectsFrom.push(oldSlug);
  }

  category.slug = normalized;
  category.displayName = input.newDisplayName;
  category.changeLog = category.changeLog || [];
  category.changeLog.push({
    timestamp: new Date(),
    action: 'renamed',
    oldValue: oldSlug,
    newValue: normalized,
    reason: input.reason,
    admin: input.adminWallet,
  });

  const updated = await category.save();

  await recordAuditEvent({
    action: 'category_renamed',
    result: 'success',
    promptId: null,
    walletAddress: input.adminWallet || null,
    reason: input.reason || 'category_management',
    metadata: {
      categoryId: input.categoryId,
      oldSlug,
      newSlug: normalized,
      oldDisplayName: category.displayName,
      newDisplayName: input.newDisplayName,
    },
  });

  return updated;
}

/**
 * Merge one category into another (migrate prompts, set up redirect)
 */
export async function mergeCategories(input: {
  fromCategoryId: string;  // Category to merge FROM
  toCategoryId: string;    // Category to merge INTO
  reason?: string;
  adminWallet?: string;
}): Promise<{ movedCount: number; category: CategoryTaxonomyDoc }> {
  const fromCategory = await CategoryTaxonomy.findOne({
    categoryId: input.fromCategoryId,
  });
  const toCategory = await CategoryTaxonomy.findOne({
    categoryId: input.toCategoryId,
  });

  if (!fromCategory || !toCategory) {
    throw new Error('One or both categories not found');
  }

  if (fromCategory.state === CategoryLifecycleState.MERGED) {
    throw new Error(`Cannot merge already-merged category: ${input.fromCategoryId}`);
  }

  // Migrate prompts from old category slug to new
  const updateResult = await Prompt.updateMany(
    { category: fromCategory.displayName },
    { category: toCategory.displayName }
  );

  const movedCount = updateResult.modifiedCount || 0;

  // Mark source category as MERGED
  fromCategory.state = CategoryLifecycleState.MERGED;
  fromCategory.mergedIntoId = input.toCategoryId;
  fromCategory.redirectTarget = toCategory.slug;
  fromCategory.changeLog = fromCategory.changeLog || [];
  fromCategory.changeLog.push({
    timestamp: new Date(),
    action: 'merged',
    oldValue: fromCategory.slug,
    newValue: toCategory.slug,
    reason: input.reason || 'category_merge',
    admin: input.adminWallet,
  });

  // Add old slug to target category's redirects if not already there
  if (!toCategory.redirectsFrom) {
    toCategory.redirectsFrom = [];
  }
  if (!toCategory.redirectsFrom.includes(fromCategory.slug)) {
    toCategory.redirectsFrom.push(fromCategory.slug);
  }

  // Update prompt counts
  toCategory.promptCount = await Prompt.countDocuments({
    category: toCategory.displayName,
    isActive: true,
  });
  fromCategory.promptCount = 0;

  const [updatedFrom] = await Promise.all([
    fromCategory.save(),
    toCategory.save(),
  ]);

  await recordAuditEvent({
    action: 'category_merged',
    result: 'success',
    promptId: null,
    walletAddress: input.adminWallet || null,
    reason: input.reason || 'category_management',
    metadata: {
      fromCategoryId: input.fromCategoryId,
      toCategoryId: input.toCategoryId,
      promptsMoved: movedCount,
      fromSlug: fromCategory.slug,
      toSlug: toCategory.slug,
    },
  });

  return { movedCount, category: updatedFrom };
}

/**
 * Deprecate a category (mark for removal, no longer used for new prompts)
 */
export async function deprecateCategory(input: {
  categoryId: string;
  redirectToId?: string;  // Optional: redirect old slugs to this category
  reason?: string;
  adminWallet?: string;
}): Promise<CategoryTaxonomyDoc> {
  const category = await CategoryTaxonomy.findOne({
    categoryId: input.categoryId,
  });

  if (!category) {
    throw new Error(`Category not found: ${input.categoryId}`);
  }

  category.state = CategoryLifecycleState.DEPRECATED;

  if (input.redirectToId) {
    const redirectTo = await CategoryTaxonomy.findOne({
      categoryId: input.redirectToId,
    });
    if (!redirectTo) {
      throw new Error(`Redirect target not found: ${input.redirectToId}`);
    }
    category.redirectTarget = redirectTo.slug;
    category.mergedIntoId = input.redirectToId;
  }

  category.changeLog = category.changeLog || [];
  category.changeLog.push({
    timestamp: new Date(),
    action: 'deprecated',
    oldValue: category.state,
    newValue: CategoryLifecycleState.DEPRECATED,
    reason: input.reason,
    admin: input.adminWallet,
  });

  const updated = await category.save();

  await recordAuditEvent({
    action: 'category_deprecated',
    result: 'success',
    promptId: null,
    walletAddress: input.adminWallet || null,
    reason: input.reason || 'category_management',
    metadata: {
      categoryId: input.categoryId,
      slug: category.slug,
      redirectTo: input.redirectToId || null,
    },
  });

  return updated;
}

/**
 * Resolve category slug to active category (following redirects)
 * Returns null if category not found or fully deprecated
 */
export async function resolveCategory(slug: string): Promise<CategoryTaxonomyDoc | null> {
  const normalized = slug.toLowerCase().trim();

  let category = await CategoryTaxonomy.findOne({
    $or: [{ slug: normalized }, { redirectsFrom: normalized }],
  });

  if (!category) {
    return null;
  }

  // Follow redirect chain
  while (
    category &&
    (category.state === CategoryLifecycleState.RENAMED ||
      category.state === CategoryLifecycleState.MERGED) &&
    category.redirectTarget
  ) {
    const next = await CategoryTaxonomy.findOne({
      slug: category.redirectTarget,
    });
    if (!next) break;
    category = next;
  }

  // Return null if we ended up at a deprecated category
  if (category && category.state === CategoryLifecycleState.DEPRECATED) {
    return null;
  }

  return category && category.state === CategoryLifecycleState.ACTIVE ? category : null;
}

/**
 * List all active categories
 */
export async function listActiveCategories(): Promise<CategoryTaxonomyDoc[]> {
  return CategoryTaxonomy.find({
    state: CategoryLifecycleState.ACTIVE,
  }).sort({ slug: 1 });
}

/**
 * Update prompt count for a category
 */
export async function updateCategoryCount(categoryId: string): Promise<number> {
  const category = await CategoryTaxonomy.findOne({ categoryId });
  if (!category) {
    throw new Error(`Category not found: ${categoryId}`);
  }

  const count = await Prompt.countDocuments({
    category: category.displayName,
    isActive: true,
    listingStatus: 'published',
  });

  category.promptCount = count;
  await category.save();

  return count;
}
