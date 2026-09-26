/**
 * Canonical, versioned prompt metadata schema — Issue #502.
 *
 * This is the single checked-in contract for public prompt listing metadata
 * (title, description, category, tags, image, price, licence, status), meant
 * to be imported directly by the frontend listing form, the server's listing
 * validation service, and the Mongo model's category enum instead of each
 * layer hand-rolling its own field list and limits.
 *
 * This schema intentionally does NOT cover the prompt's full plaintext/
 * ciphertext content, purchase records, or on-chain identifiers — those are
 * handled separately (see server/src/services/listingValidation.ts's
 * `validateEncryptedPayload`).
 *
 * Bump PROMPT_METADATA_SCHEMA_VERSION whenever a field, limit, or enum value
 * changes, and update src/fixtures.ts + promptMetadata.test.ts to match —
 * the version-drift test fails the build otherwise.
 */
import { z } from "zod";

/** Current schema version. Bump on any breaking field/limit/enum change. */
export const PROMPT_METADATA_SCHEMA_VERSION = 1;

/** Taxonomy version for category/tag migrations. Bump on category renames/removes/merges. */
export const PROMPT_TAXONOMY_VERSION = 1;

/** Canonical prompt categories, shared by the form dropdown, server validation, and the Mongo enum. */
export const PROMPT_CATEGORIES = [
  "Marketing",
  "Creative Writing",
  "Programming",
  "Music",
  "Gaming",
  "Other",
] as const;

/**
 * Category slug redirect map for backwards compatibility.
 * Maps old/removed category names to their new equivalents.
 * Used to migrate saved filters, URLs, and draft metadata.
 */
export const CATEGORY_SLUG_REDIRECTS: Record<string, string> = {
  // Map old names to new names (case-insensitive)
  "software-development": "Programming",
  "web-development": "Programming",
  "content-writing": "Creative Writing",
  "business": "Marketing",
  "audio-music": "Music",
  "video-games": "Gaming",
};

/** Licence types a listing can grant to buyers. */
export const PROMPT_LICENCES = ["standard", "extended", "commercial"] as const;

/** Listing lifecycle status, matching the Mongo `listingStatus` field. */
export const PROMPT_STATUSES = ["draft", "ready", "published", "archived"] as const;

/** Field length/count limits shared across layers. */
export const PROMPT_METADATA_LIMITS = {
  title: { min: 3, max: 120 },
  description: { max: 4000 },
  image: { max: 512 },
  tags: { max: 10, tagMax: 30 },
  price: { min: 0.00001, max: 100_000 },
} as const;

export const promptMetadataSchema = z.object({
  schemaVersion: z.number().int().min(1).default(PROMPT_METADATA_SCHEMA_VERSION),
  title: z
    .string()
    .trim()
    .min(PROMPT_METADATA_LIMITS.title.min)
    .max(PROMPT_METADATA_LIMITS.title.max),
  description: z.string().trim().max(PROMPT_METADATA_LIMITS.description.max).default(""),
  category: z.enum(PROMPT_CATEGORIES),
  tags: z
    .array(z.string().trim().min(1).max(PROMPT_METADATA_LIMITS.tags.tagMax))
    .max(PROMPT_METADATA_LIMITS.tags.max)
    .default([]),
  image: z
    .string()
    .trim()
    .min(1)
    .max(PROMPT_METADATA_LIMITS.image.max)
    .regex(/^https?:\/\/.+/i, "Image URL must start with http:// or https://"),
  price: z.coerce
    .number()
    .finite()
    .min(PROMPT_METADATA_LIMITS.price.min)
    .max(PROMPT_METADATA_LIMITS.price.max),
  licence: z.enum(PROMPT_LICENCES).default("standard"),
  status: z.enum(PROMPT_STATUSES).default("draft"),
});

export type PromptMetadata = z.infer<typeof promptMetadataSchema>;
export type PromptCategory = (typeof PROMPT_CATEGORIES)[number];
export type PromptLicence = (typeof PROMPT_LICENCES)[number];
export type PromptStatus = (typeof PROMPT_STATUSES)[number];

/** Validation error map keyed by field name, mirroring the server's hand-rolled shape. */
export type PromptMetadataErrors = Partial<Record<keyof PromptMetadata, string>>;

/**
 * Validates raw, untrusted input against the shared schema and returns a
 * consistent `{ data, errors }` shape regardless of caller (form, API route,
 * indexer) so error handling doesn't need to special-case zod issues.
 */
export function validatePromptMetadata(input: unknown): {
  data: PromptMetadata | null;
  errors: PromptMetadataErrors;
} {
  const result = promptMetadataSchema.safeParse(input);
  if (result.success) {
    return { data: result.data, errors: {} };
  }

  const errors: PromptMetadataErrors = {};
  for (const issue of result.error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in errors)) {
      errors[field as keyof PromptMetadata] = issue.message;
    }
  }
  return { data: null, errors };
}

/**
 * Migrate a category slug using the redirect map.
 * Returns the new category, or the original if no redirect exists.
 */
export function migrateCategory(oldCategory: string): PromptCategory {
  const normalizedOld = oldCategory.toLowerCase().replace(/ /g, "-");
  const redirected = CATEGORY_SLUG_REDIRECTS[normalizedOld];

  if (redirected && (PROMPT_CATEGORIES as readonly string[]).includes(redirected)) {
    return redirected as PromptCategory;
  }

  return (PROMPT_CATEGORIES as readonly string[]).includes(oldCategory)
    ? (oldCategory as PromptCategory)
    : ("Other" as PromptCategory);
}

/**
 * Migrate saved draft categories and URL filters to current taxonomy.
 */
export function migrateTaxonomy(input: {
  category?: string | null;
  tags?: string[];
}): {
  category: PromptCategory;
  tags: string[];
  migratedFields: string[];
} {
  const migratedFields: string[] = [];

  const category = input.category ? migrateCategory(input.category) : ("Other" as PromptCategory);
  if (input.category && category !== input.category) {
    migratedFields.push("category");
  }

  const tags = Array.isArray(input.tags) ? input.tags.filter(tag => tag && tag.length > 0) : [];

  return { category, tags, migratedFields };
}

/**
 * Migrates legacy prompt metadata records (v0 / unversioned) to the current
 * canonical schema version, while rejecting future unsupported schema versions (#677).
 */
export function migratePromptMetadata(raw: any): {
  data: PromptMetadata | null;
  error?: string;
} {
  if (!raw || typeof raw !== "object") {
    return { data: null, error: "Invalid metadata: input must be an object" };
  }

  const version = raw.schemaVersion ?? 0;

  if (version > PROMPT_METADATA_SCHEMA_VERSION) {
    return {
      data: null,
      error: `Unsupported future schema version: ${version}. Current supported version is ${PROMPT_METADATA_SCHEMA_VERSION}.`,
    };
  }

  // Migrate category to current taxonomy
  const { category: migratedCategory } = migrateTaxonomy({
    category: raw.category,
    tags: raw.tags,
  });

  // Legacy v0 -> v1 migration
  const normalized = {
    ...raw,
    schemaVersion: PROMPT_METADATA_SCHEMA_VERSION,
    description: raw.description ?? "",
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    licence: raw.licence ?? "standard",
    status: raw.status ?? raw.listingStatus ?? "draft",
    category: migratedCategory,
  };

  const validation = validatePromptMetadata(normalized);
  if (!validation.data) {
    return {
      data: null,
      error: `Metadata migration validation failed: ${Object.values(validation.errors).join(", ")}`,
    };
  }

  return { data: validation.data };
}
