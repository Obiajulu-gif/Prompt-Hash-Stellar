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

/** Canonical prompt categories, shared by the form dropdown, server validation, and the Mongo enum. */
export const PROMPT_CATEGORIES = [
  "Marketing",
  "Creative Writing",
  "Programming",
  "Music",
  "Gaming",
  "Other",
] as const;

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
