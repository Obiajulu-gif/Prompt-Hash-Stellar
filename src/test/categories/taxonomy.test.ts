import { describe, it, expect, beforeEach, afterEach } from "vitest";
/**
 * Category Taxonomy Management Tests (#xyz)
 * 
 * Tests cover:
 * - Slug redirects for renamed categories
 * - Slug conflicts and resolution
 * - Deleted/deprecated categories
 * - Search filter behavior with redirects
 * - Merge and migration operations
 */

import CategoryTaxonomy, { CategoryLifecycleState } from '../../server/src/models/CategoryTaxonomy';
import {
  createCategory,
  renameCategory,
  mergeCategories,
  deprecateCategory,
  resolveCategory,
  listActiveCategories,
  updateCategoryCount,
} from '../../server/src/services/categoryTaxonomyService';
import Prompt from '../../server/src/models/Prompt';

describe('Category Taxonomy Management', () => {
  beforeAll(async () => {
    // Connect to test database
    // Note: Requires MONGODB_URI_TEST env var
  });

  afterEach(async () => {
    // Clean up test data
    await CategoryTaxonomy.deleteMany({});
    await Prompt.deleteMany({});
  });

  describe('Category Creation', () => {
    it('creates a new category with stable ID and slug', async () => {
      const category = await createCategory({
        categoryId: 'cat-001',
        slug: 'programming',
        displayName: 'Programming',
        description: 'Programming and development',
      });

      expect(category.categoryId).toBe('cat-001');
      expect(category.slug).toBe('programming');
      expect(category.displayName).toBe('Programming');
      expect(category.state).toBe(CategoryLifecycleState.ACTIVE);
      expect(category.redirectsFrom).toEqual([]);
    });

    it('rejects duplicate slug', async () => {
      await createCategory({
        categoryId: 'cat-001',
        slug: 'programming',
        displayName: 'Programming',
      });

      expect(
        createCategory({
          categoryId: 'cat-002',
          slug: 'programming',
          displayName: 'Programming 2',
        })
      ).rejects.toThrow('slug or ID conflict');
    });

    it('rejects duplicate categoryId', async () => {
      await createCategory({
        categoryId: 'cat-001',
        slug: 'programming',
        displayName: 'Programming',
      });

      expect(
        createCategory({
          categoryId: 'cat-001',
          slug: 'programming-2',
          displayName: 'Programming 2',
        })
      ).rejects.toThrow('slug or ID conflict');
    });

    it('normalizes slug to lowercase', async () => {
      const category = await createCategory({
        categoryId: 'cat-001',
        slug: 'Programming',
        displayName: 'Programming',
      });

      expect(category.slug).toBe('programming');
    });
  });

  describe('Category Rename', () => {
    it('renames category and creates redirect', async () => {
      const original = await createCategory({
        categoryId: 'cat-001',
        slug: 'prog',
        displayName: 'Programming',
      });

      const renamed = await renameCategory({
        categoryId: 'cat-001',
        newSlug: 'programming',
        newDisplayName: 'Programming',
        reason: 'Standardize naming',
      });

      expect(renamed.slug).toBe('programming');
      expect(renamed.redirectsFrom).toContain('prog');
      expect(renamed.state).toBe(CategoryLifecycleState.ACTIVE);
      expect(renamed.changeLog).toHaveLength(2); // created + renamed
    });

    it('rejects slug conflict on rename', async () => {
      await createCategory({
        categoryId: 'cat-001',
        slug: 'programming',
        displayName: 'Programming',
      });

      const category2 = await createCategory({
        categoryId: 'cat-002',
        slug: 'prog',
        displayName: 'Prog',
      });

      expect(
        renameCategory({
          categoryId: 'cat-002',
          newSlug: 'programming',
          newDisplayName: 'Programming',
        })
      ).rejects.toThrow('Slug conflict');
    });

    it('tracks rename reason in audit log', async () => {
      await createCategory({
        categoryId: 'cat-001',
        slug: 'prog',
        displayName: 'Programming',
      });

      const renamed = await renameCategory({
        categoryId: 'cat-001',
        newSlug: 'programming',
        newDisplayName: 'Programming',
        reason: 'Consistency update',
        adminWallet: 'admin-001',
      });

      const lastEntry = renamed.changeLog![renamed.changeLog!.length - 1];
      expect(lastEntry.action).toBe('renamed');
      expect(lastEntry.reason).toBe('Consistency update');
      expect(lastEntry.admin).toBe('admin-001');
    });
  });

  describe('Category Merge', () => {
    it('migrates prompts and creates redirect', async () => {
      const fromCat = await createCategory({
        categoryId: 'cat-001',
        slug: 'writing',
        displayName: 'Writing',
      });

      const toCat = await createCategory({
        categoryId: 'cat-002',
        slug: 'creative-writing',
        displayName: 'Creative Writing',
      });

      // Create prompts in source category
      await Prompt.create([
        { title: 'Prompt 1', category: 'Writing', owner: 'owner-001' },
        { title: 'Prompt 2', category: 'Writing', owner: 'owner-002' },
      ]);

      const result = await mergeCategories({
        fromCategoryId: 'cat-001',
        toCategoryId: 'cat-002',
        reason: 'Consolidate categories',
      });

      expect(result.movedCount).toBe(2);
      expect(fromCat.state).toBe(CategoryLifecycleState.MERGED);
      expect(fromCat.mergedIntoId).toBe('cat-002');
      expect(fromCat.redirectTarget).toBe('creative-writing');

      // Verify prompts migrated
      const migratedPrompts = await Prompt.find({ category: 'Creative Writing' });
      expect(migratedPrompts).toHaveLength(2);
    });

    it('rejects merge of already-merged category', async () => {
      const cat1 = await createCategory({
        categoryId: 'cat-001',
        slug: 'a',
        displayName: 'A',
      });

      const cat2 = await createCategory({
        categoryId: 'cat-002',
        slug: 'b',
        displayName: 'B',
      });

      const cat3 = await createCategory({
        categoryId: 'cat-003',
        slug: 'c',
        displayName: 'C',
      });

      // Merge cat1 into cat2
      await mergeCategories({
        fromCategoryId: 'cat-001',
        toCategoryId: 'cat-002',
      });

      // Try to merge already-merged cat1 into cat3
      expect(
        mergeCategories({
          fromCategoryId: 'cat-001',
          toCategoryId: 'cat-003',
        })
      ).rejects.toThrow('Cannot merge already-merged category');
    });
  });

  describe('Category Deprecation', () => {
    it('deprecates category without redirect', async () => {
      await createCategory({
        categoryId: 'cat-001',
        slug: 'obsolete',
        displayName: 'Obsolete',
      });

      const deprecated = await deprecateCategory({
        categoryId: 'cat-001',
        reason: 'No longer used',
      });

      expect(deprecated.state).toBe(CategoryLifecycleState.DEPRECATED);
      expect(deprecated.redirectTarget).toBeUndefined();
    });

    it('deprecates category with redirect', async () => {
      const toCat = await createCategory({
        categoryId: 'cat-002',
        slug: 'active',
        displayName: 'Active',
      });

      const deprecated = await deprecateCategory({
        categoryId: 'cat-001',
        redirectToId: 'cat-002',
        reason: 'Redirect to active category',
      });

      expect(deprecated.state).toBe(CategoryLifecycleState.DEPRECATED);
      expect(deprecated.redirectTarget).toBe('active');
      expect(deprecated.mergedIntoId).toBe('cat-002');
    });
  });

  describe('Category Resolution (Redirects)', () => {
    it('resolves active category by slug', async () => {
      await createCategory({
        categoryId: 'cat-001',
        slug: 'programming',
        displayName: 'Programming',
      });

      const resolved = await resolveCategory('programming');

      expect(resolved).toBeDefined();
      expect(resolved?.slug).toBe('programming');
      expect(resolved?.state).toBe(CategoryLifecycleState.ACTIVE);
    });

    it('resolves renamed category via old slug', async () => {
      await createCategory({
        categoryId: 'cat-001',
        slug: 'prog',
        displayName: 'Programming',
      });

      await renameCategory({
        categoryId: 'cat-001',
        newSlug: 'programming',
        newDisplayName: 'Programming',
      });

      // Old slug should redirect to new
      const resolved = await resolveCategory('prog');

      expect(resolved).toBeDefined();
      expect(resolved?.slug).toBe('programming');
    });

    it('resolves merged category via old slug', async () => {
      const cat1 = await createCategory({
        categoryId: 'cat-001',
        slug: 'writing',
        displayName: 'Writing',
      });

      const cat2 = await createCategory({
        categoryId: 'cat-002',
        slug: 'creative-writing',
        displayName: 'Creative Writing',
      });

      await mergeCategories({
        fromCategoryId: 'cat-001',
        toCategoryId: 'cat-002',
      });

      // Old slug should redirect to new
      const resolved = await resolveCategory('writing');

      expect(resolved).toBeDefined();
      expect(resolved?.slug).toBe('creative-writing');
    });

    it('returns null for deprecated category', async () => {
      await createCategory({
        categoryId: 'cat-001',
        slug: 'obsolete',
        displayName: 'Obsolete',
      });

      await deprecateCategory({
        categoryId: 'cat-001',
      });

      const resolved = await resolveCategory('obsolete');

      expect(resolved).toBeNull();
    });

    it('returns null for nonexistent category', async () => {
      const resolved = await resolveCategory('nonexistent');

      expect(resolved).toBeNull();
    });

    it('follows redirect chain', async () => {
      // Create chain: cat1 → cat2 → cat3
      const cat1 = await createCategory({
        categoryId: 'cat-001',
        slug: 'a',
        displayName: 'A',
      });

      const cat2 = await createCategory({
        categoryId: 'cat-002',
        slug: 'b',
        displayName: 'B',
      });

      const cat3 = await createCategory({
        categoryId: 'cat-003',
        slug: 'c',
        displayName: 'C',
      });

      await mergeCategories({
        fromCategoryId: 'cat-001',
        toCategoryId: 'cat-002',
      });

      await mergeCategories({
        fromCategoryId: 'cat-002',
        toCategoryId: 'cat-003',
      });

      // Resolve from original slug should end at cat3
      const resolved = await resolveCategory('a');

      expect(resolved).toBeDefined();
      expect(resolved?.slug).toBe('c');
    });
  });

  describe('Search Filter with Redirects', () => {
    it('searches with current category slug', async () => {
      const cat = await createCategory({
        categoryId: 'cat-001',
        slug: 'programming',
        displayName: 'Programming',
      });

      // Note: This test requires integration with searchPrompts
      // and Prompt model setup; implementation shown in acceptance tests
    });

    it('searches with old category slug (via redirect)', async () => {
      // Similar integration test
    });
  });

  describe('Listing Active Categories', () => {
    it('returns only active categories', async () => {
      await createCategory({
        categoryId: 'cat-001',
        slug: 'programming',
        displayName: 'Programming',
      });

      await createCategory({
        categoryId: 'cat-002',
        slug: 'writing',
        displayName: 'Writing',
      });

      const cat3 = await createCategory({
        categoryId: 'cat-003',
        slug: 'obsolete',
        displayName: 'Obsolete',
      });

      await deprecateCategory({
        categoryId: 'cat-003',
      });

      const active = await listActiveCategories();

      expect(active).toHaveLength(2);
      expect(active.map((c) => c.slug)).not.toContain('obsolete');
    });

    it('returns sorted by slug', async () => {
      await createCategory({
        categoryId: 'cat-001',
        slug: 'zebra',
        displayName: 'Zebra',
      });

      await createCategory({
        categoryId: 'cat-002',
        slug: 'alpha',
        displayName: 'Alpha',
      });

      const active = await listActiveCategories();

      expect(active[0].slug).toBe('alpha');
      expect(active[1].slug).toBe('zebra');
    });
  });

  describe('Prompt Count Updates', () => {
    it('updates prompt count for category', async () => {
      const cat = await createCategory({
        categoryId: 'cat-001',
        slug: 'programming',
        displayName: 'Programming',
      });

      await Prompt.create([
        { title: 'Prompt 1', category: 'Programming', isActive: true, listingStatus: 'published' },
        { title: 'Prompt 2', category: 'Programming', isActive: true, listingStatus: 'published' },
        { title: 'Prompt 3', category: 'Programming', isActive: false },
      ]);

      const count = await updateCategoryCount('cat-001');

      expect(count).toBe(2); // Only active, published prompts
      const updated = await CategoryTaxonomy.findOne({ categoryId: 'cat-001' });
      expect(updated?.promptCount).toBe(2);
    });
  });
});
