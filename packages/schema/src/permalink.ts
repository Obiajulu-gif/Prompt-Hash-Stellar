/**
 * Safe Public Permalinks and Redirect Contracts — Issue #936
 *
 * Defines canonical permalink structure, slug generation, permalink resolution
 * states, and public sanitization schemas to prevent private data leaks
 * across renamed, archived, restored, or restricted records.
 */
import { z } from "zod";

/** Canonical states a permalink resolution can return */
export const PERMALINK_STATUSES = [
  "active",      // Record is live and accessible at canonical URL
  "redirect",    // Record was renamed; old slug/link redirects to canonical URL
  "archived",    // Record was archived; safe public tombstone/banner, no purchases
  "restricted",  // Record was restricted/suspended by moderation; no private data
  "deleted",     // Record was deleted/retired
  "not_found",   // No record matches this identifier
] as const;

export type PermalinkStatus = (typeof PERMALINK_STATUSES)[number];

/**
 * Generates a clean, URL-safe slug from a title string.
 * - Lowercases and trims
 * - Replaces non-alphanumeric chars with hyphens
 * - Collapses repeated hyphens
 * - Truncates to max 80 characters without breaking mid-word when possible
 */
export function generateSlug(title: string): string {
  if (!title || typeof title !== "string") {
    return "untitled-prompt";
  }

  const cleaned = title
    .toLowerCase()
    .trim()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // Strip diacritics
    .replace(/[^a-z0-9\s-]/g, "")    // Remove invalid URL chars
    .replace(/\s+/g, "-")            // Convert spaces to hyphens
    .replace(/-+/g, "-")            // Collapse consecutive hyphens
    .replace(/^-+|-+$/g, "");        // Trim leading/trailing hyphens

  if (!cleaned) {
    return "untitled-prompt";
  }

  // Truncate to 80 chars max
  if (cleaned.length > 80) {
    const truncated = cleaned.slice(0, 80);
    const lastHyphen = truncated.lastIndexOf("-");
    return lastHyphen > 30 ? truncated.slice(0, lastHyphen) : truncated;
  }

  return cleaned;
}

/**
 * Builds the canonical public permalink URL path for a record.
 * Standard format: `/prompts/${id}` or `/prompts/${id}-${slug}`
 */
export function buildCanonicalPermalink(params: {
  id: string | number;
  slug?: string;
  baseUrl?: string;
}): string {
  const base = params.baseUrl ? params.baseUrl.replace(/\/+$/, "") : "";
  const idStr = String(params.id);
  const slugPart = params.slug ? `-${params.slug}` : "";
  return `${base}/prompts/${idStr}`;
}

/**
 * Schema for public-safe prompt projection.
 * STRICTLY OMITS sensitive fields:
 * - `content`: Raw plaintext prompt template (unlocked buyers only)
 * - `encryptedPrompt`: Ciphertext payload
 * - `moderationNotes`: Internal moderator annotations
 */
export const publicPromptSchema = z.object({
  id: z.string(),
  onChainId: z.string().nullable().optional(),
  title: z.string(),
  slug: z.string(),
  canonicalUrl: z.string(),
  previewText: z.string().default(""),
  description: z.string().default(""),
  category: z.string(),
  tags: z.array(z.string()).default([]),
  image: z.string().nullable().optional(),
  price: z.number().default(0),
  rating: z.number().default(1),
  salesCount: z.number().default(0),
  owner: z.any().optional(),
  creatorWallet: z.string().optional(),
  lifecycleState: z.string().default("published"),
  listingStatus: z.string().default("published"),
  moderationStatus: z.string().default("none"),
  archivedAt: z.union([z.date(), z.string()]).nullable().optional(),
  createdAt: z.union([z.date(), z.string()]).optional(),
  updatedAt: z.union([z.date(), z.string()]).optional(),
});

export type SanitizedPublicPrompt = z.infer<typeof publicPromptSchema>;

/**
 * Filter out any private or sensitive fields from a prompt record.
 * Ensures zero leakage of private prompt content or moderation internal notes.
 */
export function sanitizePromptRecord(raw: any): SanitizedPublicPrompt {
  const id = String(raw._id ?? raw.id ?? raw.onChainId ?? "");
  const onChainId = raw.onChainId ? String(raw.onChainId) : null;
  const title = String(raw.title || "Untitled Prompt");
  const slug = raw.slug || generateSlug(title);
  const canonicalUrl = raw.canonicalUrl || buildCanonicalPermalink({ id: onChainId || id, slug });

  // Extract owner wallet address safely
  const creatorWallet =
    typeof raw.owner === "object" && raw.owner?.walletAddress
      ? String(raw.owner.walletAddress)
      : typeof raw.creator === "string"
      ? raw.creator
      : typeof raw.owner === "string"
      ? raw.owner
      : undefined;

  return {
    id,
    onChainId,
    title,
    slug,
    canonicalUrl,
    previewText: raw.previewText || raw.description || "",
    description: raw.description || "",
    category: raw.category || "Other",
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    image: raw.image || raw.imageUrl || null,
    price: typeof raw.price === "number" ? raw.price : 0,
    rating: typeof raw.rating === "number" ? raw.rating : 1,
    salesCount: typeof raw.salesCount === "number" ? raw.salesCount : 0,
    creatorWallet,
    lifecycleState: raw.lifecycleState || "published",
    listingStatus: raw.listingStatus || "published",
    moderationStatus: raw.moderationStatus || "none",
    archivedAt: raw.archivedAt ? new Date(raw.archivedAt) : null,
    createdAt: raw.createdAt ? new Date(raw.createdAt) : undefined,
    updatedAt: raw.updatedAt ? new Date(raw.updatedAt) : undefined,
  };
}

/** Result shape when resolving a permalink */
export interface PermalinkResolution {
  status: PermalinkStatus;
  statusCode: number;
  canonicalUrl: string;
  targetId?: string;
  targetSlug?: string;
  record?: SanitizedPublicPrompt;
  isArchived?: boolean;
  isRestricted?: boolean;
  isDeleted?: boolean;
  message?: string;
  reason?: string | null;
}
