# Category Taxonomy Management (#xyz)

## Overview

The category taxonomy system manages the complete lifecycle of prompt categories: creation, renaming, merging, and deprecation. It preserves **stable category IDs** independent of slugs, enabling slug-based redirects without breaking discovery links.

## Architecture

### Core Concepts

**Category ID (`categoryId`)**: Unique, immutable identifier for a category. Never changes.

**Slug**: Human-readable URL identifier. Can change through rename/merge operations; old slugs redirect to new.

**Lifecycle State**: Tracks whether a category is `active`, `renamed`, `merged`, or `deprecated`.

**Redirect Chain**: When categories are renamed or merged, old slugs redirect to active categories automatically.

### Data Model

```typescript
{
  _id: ObjectId;
  categoryId: string;                  // Stable UUID
  slug: string;                        // Current URL slug (lowercase)
  displayName: string;                 // User-facing name
  state: 'active' | 'renamed' | 'merged' | 'deprecated';
  description?: string;
  promptCount: number;                 // Denormalized count
  
  // Redirect support
  redirectsFrom?: string[];            // Old slugs that redirect here
  mergedIntoId?: string;               // If merged, points to target category ID
  redirectTarget?: string;             // Target slug for redirects
  
  // Audit trail
  createdAt: Date;
  updatedAt: Date;
  changedBy?: string;                  // Admin wallet address
  changeReason?: string;
  changeLog: Array<{
    timestamp: Date;
    action: 'created' | 'renamed' | 'merged' | 'deprecated' | 'restored';
    oldValue?: string;
    newValue?: string;
    reason?: string;
    admin?: string;
  }>;
}
```

## Admin Operations

### Create Category

Creates a new active category with a stable ID.

```bash
curl -X POST /api/admin/categories \
  -H "Content-Type: application/json" \
  -d '{
    "action": "create",
    "adminWallet": "GBXYZ...",
    "categoryId": "cat-001",
    "slug": "programming",
    "displayName": "Programming",
    "description": "Programming and software development"
  }'
```

**Response:**
```json
{
  "success": true,
  "action": "create",
  "category": {
    "categoryId": "cat-001",
    "slug": "programming",
    "displayName": "Programming",
    "state": "active",
    "redirectsFrom": []
  }
}
```

### Rename Category

Renames a category. Old slug becomes a redirect to the new slug.

```bash
curl -X POST /api/admin/categories \
  -H "Content-Type: application/json" \
  -d '{
    "action": "rename",
    "adminWallet": "GBXYZ...",
    "categoryId": "cat-001",
    "newSlug": "software-development",
    "newDisplayName": "Software Development",
    "reason": "Standardize naming convention"
  }'
```

**Result:**
- Category `categoryId` remains `cat-001` (unchanged)
- New slug: `software-development`
- Old slug `programming` now redirects to `software-development`
- Prompts category field: Unchanged (still `Programming`)
- URLs with `?category=programming` automatically resolve to `software-development`

**Audit Log Entry:**
```json
{
  "action": "renamed",
  "timestamp": "2026-09-24T14:05:00Z",
  "oldValue": "programming",
  "newValue": "software-development",
  "reason": "Standardize naming convention",
  "admin": "GBXYZ..."
}
```

### Merge Categories

Merges one category into another. Prompts are migrated to the target category, old slug redirects.

```bash
curl -X POST /api/admin/categories \
  -H "Content-Type: application/json" \
  -d '{
    "action": "merge",
    "adminWallet": "GBXYZ...",
    "fromCategoryId": "cat-002",
    "toCategoryId": "cat-001",
    "reason": "Consolidate creative categories"
  }'
```

**What Happens:**
1. All prompts with `category: "Writing"` → migrated to `category: "Creative Writing"`
2. Source category marked as `MERGED`
3. Old slug `writing` → redirects to `creative-writing`
4. Prompt counts updated
5. Audit log records: action, fromCategory, toCategory, promptsMoved

**Example Result:**
```json
{
  "success": true,
  "action": "merge",
  "promptsMoved": 147,
  "category": {
    "categoryId": "cat-002",
    "slug": "writing",
    "state": "merged",
    "mergedIntoId": "cat-001",
    "redirectTarget": "creative-writing"
  }
}
```

### Deprecate Category

Marks a category as deprecated (no longer used for new listings). Optionally redirects old slugs.

```bash
curl -X POST /api/admin/categories \
  -H "Content-Type: application/json" \
  -d '{
    "action": "deprecate",
    "adminWallet": "GBXYZ...",
    "categoryId": "cat-999",
    "redirectToId": "cat-001",
    "reason": "Replaced by Programming category"
  }'
```

**Result:**
- Category marked as `DEPRECATED`
- New listings cannot use this category
- Old slugs redirect to `redirectToId` (if specified)
- Existing prompts remain in old category (not migrated)

## User-Facing Behavior

### URL Redirect Example

User has a saved filter: `/browse?category=software-development`

Admin renames `software-development` → `app-development`:

1. Old slug `software-development` added to `redirectsFrom`
2. New slug: `app-development`
3. User's saved link still works: search resolves `software-development` → `app-development`
4. Results now filtered by the new active category

### Search Behavior

When a user searches with a category filter:

1. Frontend sends: `?category=programming`
2. Backend calls `resolveCategory('programming')`
3. If renamed: `programming` → lookup in `redirectsFrom` → found in `redirectTarget` → returns new category
4. If merged: `programming` → lookup in `redirectsFrom` → found in `mergedIntoId` → returns merged-into category
5. If deprecated: Returns null; search shows no results
6. If active: Returns category directly

**Search query adapts:**
- User filter: `category=programming`
- Resolved category: `Creative Writing`
- Database query: `{ category: "Creative Writing" }`

## Migration Workflow

### Scenario: Merge Two Categories

Goal: Merge `Content Writing` into `Creative Writing`

**Steps:**

1. **List active categories** (verify target exists)
   ```bash
   curl -X POST /api/admin/categories \
     -d '{ "action": "list", "adminWallet": "GBXYZ..." }'
   ```

2. **Merge categories** (migrates 200 prompts)
   ```bash
   curl -X POST /api/admin/categories \
     -d '{
       "action": "merge",
       "adminWallet": "GBXYZ...",
       "fromCategoryId": "cat-content-writing",
       "toCategoryId": "cat-creative-writing",
       "reason": "Consolidate content/creative categories per user feedback"
     }'
   ```

3. **Update prompt counts**
   ```bash
   curl -X POST /api/admin/categories \
     -d '{
       "action": "update-count",
       "adminWallet": "GBXYZ...",
       "categoryId": "cat-creative-writing"
     }'
   ```

4. **Verify in database**
   - Source category state: `merged`
   - Source category redirectTarget: `creative-writing`
   - Target category promptCount: 200 → 347
   - Prompt records: 200 now have `category: "Creative Writing"`

5. **Test redirect**
   - Query: `/api/search/prompts?category=content-writing`
   - Should return: Creative Writing prompts

**Audit Trail:**
```json
{
  "action": "category_merged",
  "promptsMoved": 200,
  "fromSlug": "content-writing",
  "toSlug": "creative-writing"
}
```

### Scenario: Rename a Category

Goal: Rename `Software Dev` → `Programming` for consistency

**Steps:**

1. **Rename**
   ```bash
   curl -X POST /api/admin/categories \
     -d '{
       "action": "rename",
       "adminWallet": "GBXYZ...",
       "categoryId": "cat-software-dev",
       "newSlug": "programming",
       "newDisplayName": "Programming",
       "reason": "Align with canonical category naming"
     }'
   ```

2. **Test redirect**
   - Old URL: `/browse?category=software-dev` → Works, redirects to `programming`
   - New URL: `/browse?category=programming` → Works directly

**Audit Trail:**
```json
{
  "action": "category_renamed",
  "oldSlug": "software-dev",
  "newSlug": "programming"
}
```

## Technical Details

### Slug Resolution Algorithm

```typescript
async function resolveCategory(slug: string) {
  // 1. Find by direct slug match OR in redirectsFrom
  let category = await CategoryTaxonomy.findOne({
    $or: [{ slug }, { redirectsFrom: slug }]
  });

  // 2. Follow redirect chain (max depth to prevent loops)
  while (category && isRedirected(category.state) && category.redirectTarget) {
    category = await CategoryTaxonomy.findOne({ slug: category.redirectTarget });
  }

  // 3. Return only if final state is ACTIVE
  return category?.state === 'active' ? category : null;
}
```

### Atomic Operations

Merges are atomic:
1. Update all prompts (`Prompt.updateMany()`)
2. Mark source as merged
3. Update prompt counts
4. Single transaction ensures consistency

### Audit Trail

Every operation logged:
- **Actor**: Admin wallet address
- **Action**: created, renamed, merged, deprecated, restored
- **Before/After**: Old value, new value, reason
- **Timestamp**: ISO string
- **Metadata**: Affected IDs, counts, etc.

Queryable via:
```typescript
const history = await CategoryTaxonomy.findOne({ categoryId })
  .select('changeLog')
  .lean();
```

### Index Strategy

**Indexes created:**
- `{ state, slug }` — Fast active category lookups
- `{ redirectsFrom }` — Find categories by old slug
- `{ mergedIntoId }` — Find merge targets

## Search Filter Integration

### Current Behavior

**Before implementing taxonomy:**
```
User filter: ?category=programming
↓
Search query: { category: "programming" }
↓
Database: exact match on `category` field
```

**After implementing taxonomy:**
```
User filter: ?category=software-development
↓
resolveCategory('software-development')
↓
Finds: "software-development" in redirectsFrom
↓
Returns: category with slug "programming"
↓
Search query: { category: "Programming" } (displayName)
↓
Database: returns matching prompts
```

### Code Changes

In `searchController.ts`:

```typescript
if (category) {
  const resolved = await resolveCategory(category);
  if (!resolved) {
    // Category deprecated or not found
    return { prompts: [], total: 0, ... };
  }
  baseQuery.category = resolved.displayName;
}
```

## Testing Coverage

Tests verify:
- ✅ Category creation with stable ID and slug
- ✅ Slug conflict detection
- ✅ Rename creates redirect
- ✅ Merge migrates prompts
- ✅ Merge prevents cascade merge (already-merged category)
- ✅ Category resolution follows redirect chains
- ✅ Deprecated categories return null
- ✅ Search filter honors redirects
- ✅ Listing returns only active categories
- ✅ Prompt counts updated accurately
- ✅ Audit log tracks all changes

**Run tests:**
```bash
npm test -- src/test/categories/taxonomy.test.ts
```

## API Reference

**Endpoint:** `POST /api/admin/categories`

**Authorization:** Admin wallet required

**Actions:**

| Action | Required Fields | Returns |
|--------|-----------------|---------|
| `create` | categoryId, slug, displayName | Created category |
| `rename` | categoryId, newSlug, newDisplayName | Renamed category |
| `merge` | fromCategoryId, toCategoryId | { movedCount, category } |
| `deprecate` | categoryId | Deprecated category |
| `list` | (none) | Array of active categories |
| `update-count` | categoryId | { categoryId, promptCount } |

## Monitoring & Maintenance

### Health Check

Verify redirect chains don't create loops:
```typescript
async function checkRedirectChains() {
  const all = await CategoryTaxonomy.find();
  
  for (const cat of all) {
    let current = cat;
    let depth = 0;
    const maxDepth = 10;
    
    while (current.redirectTarget && depth < maxDepth) {
      current = await CategoryTaxonomy.findOne({ 
        slug: current.redirectTarget 
      });
      depth++;
    }
    
    if (depth >= maxDepth) {
      console.warn(`Redirect loop detected for ${cat.slug}`);
    }
  }
}
```

### Prompt Count Sync

Periodically sync denormalized counts:
```bash
# Update counts for all categories
for catId in $(db.categories.find().map(c => c.categoryId)); do
  curl -X POST /api/admin/categories \
    -d "{ \"action\": \"update-count\", \"adminWallet\": \"...\", \"categoryId\": \"$catId\" }"
done
```

## Rollback

If a merge fails:

1. **Revert prompts** (manual SQL/MongoDB):
   ```javascript
   db.prompts.updateMany(
     { category: "Creative Writing", ... },
     { $set: { category: "Content Writing" } }
   );
   ```

2. **Reset category states**:
   ```javascript
   db.taxonomies.updateMany(
     { categoryId: "cat-content-writing" },
     {
       $set: { state: "active", mergedIntoId: null, redirectTarget: null },
       $pull: { redirectsFrom: "content-writing" }
     }
   );
   ```

3. **Restore from audit log** (record intent to revert in changeLog)

---

**Last Updated:** September 2026  
**Maintainer:** Prompt Hash Team
