/**
 * Permalink & Safe Redirection Service — Issue #936
 *
 * Implements canonical permalinks, safe 301 redirection for renamed records,
 * and security barriers preventing private data leaks through old or
 * active links for archived, restricted, and deleted records.
 */

import Prompt from "../models/Prompt.js";
import { recordAuditEvent } from "./auditTrail.js";
import {
  generateSlug,
  buildCanonicalPermalink,
  sanitizePromptRecord,
  type SanitizedPublicPrompt,
  type PermalinkResolution,
} from "@prompthash/schema";

export { generateSlug, buildCanonicalPermalink, sanitizePromptRecord };

export interface PermalinkActor {
  role: "creator" | "moderator" | "system" | "admin";
  id: string | null;
}

export interface RenameRecordInput {
  promptId: string;
  by?: "id" | "onChainId" | "slug";
  newTitle: string;
  actor?: PermalinkActor;
  reason?: string;
}

export interface PermalinkLifecycleInput {
  promptId: string;
  by?: "id" | "onChainId" | "slug";
  actor?: PermalinkActor;
  reason?: string;
}

/**
 * Builds standard query for finding a prompt by ID, onChainId, or slug
 */
function buildLookupQuery(identifier: string, by?: "id" | "onChainId" | "slug") {
  const normalized = identifier.trim();
  if (by === "id") return { _id: normalized };
  if (by === "onChainId") return { onChainId: normalized };
  if (by === "slug") return { slug: normalized.toLowerCase() };

  // Auto-detect: if numeric, try onChainId first, otherwise slug/id
  const isNumeric = /^\d+$/.test(normalized);
  if (isNumeric) {
    return {
      $or: [
        { onChainId: normalized },
        { onChainId: Number(normalized) },
        { slug: normalized },
      ],
    };
  }

  // Check if it's a valid 24-char hex Mongo ObjectId
  const isMongoId = /^[0-9a-fA-F]{24}$/.test(normalized);
  if (isMongoId) {
    return {
      $or: [
        { _id: normalized },
        { slug: normalized.toLowerCase() },
        { onChainId: normalized },
      ],
    };
  }

  // Default to slug or previousSlugs/redirectsFrom
  return {
    $or: [
      { slug: normalized.toLowerCase() },
      { onChainId: normalized },
    ],
  };
}

/**
 * Rename a record: updates title, recalculates canonical slug,
 * preserves old slug in `previousSlugs` and `redirectsFrom` to ensure
 * old links safely 301-redirect to canonical permalink.
 */
export async function renameRecord(input: RenameRecordInput) {
  const query = buildLookupQuery(input.promptId, input.by);
  const prompt = await Prompt.findOne(query);

  if (!prompt) {
    throw new Error(`Prompt not found: ${input.promptId}`);
  }

  const oldTitle = prompt.title;
  const oldSlug = prompt.slug || generateSlug(oldTitle);
  const newSlug = generateSlug(input.newTitle);

  // If slug has changed, append oldSlug to previousSlugs and redirectsFrom
  if (oldSlug && oldSlug !== newSlug) {
    prompt.previousSlugs = prompt.previousSlugs || [];
    if (!prompt.previousSlugs.includes(oldSlug)) {
      prompt.previousSlugs.push(oldSlug);
    }

    prompt.redirectsFrom = prompt.redirectsFrom || [];
    if (!prompt.redirectsFrom.includes(oldSlug)) {
      prompt.redirectsFrom.push(oldSlug);
    }
  }

  const promptIdentifier = String(prompt.onChainId || prompt._id);
  prompt.title = input.newTitle;
  prompt.slug = newSlug;
  prompt.canonicalUrl = buildCanonicalPermalink({ id: promptIdentifier, slug: newSlug });

  await prompt.save();

  await recordAuditEvent({
    action: "prompt_permalink_renamed",
    result: "success",
    promptId: promptIdentifier,
    walletAddress: input.actor?.id || null,
    reason: input.reason || "title_rename",
    metadata: {
      oldTitle,
      newTitle: input.newTitle,
      oldSlug,
      newSlug,
      canonicalUrl: prompt.canonicalUrl,
    },
  });

  return prompt;
}

/**
 * Archive a record: marks record as archived.
 * Public links return safe archived tombstone and disable purchases,
 * with zero private content leaked.
 */
export async function archiveRecord(input: PermalinkLifecycleInput) {
  const query = buildLookupQuery(input.promptId, input.by);
  const prompt = await Prompt.findOne(query);

  if (!prompt) {
    throw new Error(`Prompt not found: ${input.promptId}`);
  }

  const now = new Date();
  prompt.listingStatus = "archived";
  prompt.lifecycleState = "archived";
  prompt.isActive = false;
  prompt.archivedAt = now;

  const promptIdentifier = String(prompt.onChainId || prompt._id);
  if (!prompt.canonicalUrl) {
    prompt.canonicalUrl = buildCanonicalPermalink({
      id: promptIdentifier,
      slug: prompt.slug || generateSlug(prompt.title),
    });
  }

  await prompt.save();

  await recordAuditEvent({
    action: "prompt_permalink_archived",
    result: "success",
    promptId: promptIdentifier,
    walletAddress: input.actor?.id || null,
    reason: input.reason || "creator_archived",
    metadata: {
      archivedAt: now,
      canonicalUrl: prompt.canonicalUrl,
    },
  });

  return prompt;
}

/**
 * Restore an archived or hidden record back to active published state.
 */
export async function restoreRecord(input: PermalinkLifecycleInput) {
  const query = buildLookupQuery(input.promptId, input.by);
  const prompt = await Prompt.findOne(query);

  if (!prompt) {
    throw new Error(`Prompt not found: ${input.promptId}`);
  }

  prompt.listingStatus = "published";
  prompt.lifecycleState = "published";
  prompt.isActive = true;
  prompt.archivedAt = null;

  const promptIdentifier = String(prompt.onChainId || prompt._id);
  if (!prompt.canonicalUrl) {
    prompt.canonicalUrl = buildCanonicalPermalink({
      id: promptIdentifier,
      slug: prompt.slug || generateSlug(prompt.title),
    });
  }

  await prompt.save();

  await recordAuditEvent({
    action: "prompt_permalink_restored",
    result: "success",
    promptId: promptIdentifier,
    walletAddress: input.actor?.id || null,
    reason: input.reason || "creator_restored",
    metadata: {
      canonicalUrl: prompt.canonicalUrl,
    },
  });

  return prompt;
}

/**
 * Restrict a record (moderation action):
 * Restricts listing. Old links and direct links MUST NOT leak private data.
 */
export async function restrictRecord(
  input: PermalinkLifecycleInput & { reasonCode?: string; notes?: string }
) {
  const query = buildLookupQuery(input.promptId, input.by);
  const prompt = await Prompt.findOne(query);

  if (!prompt) {
    throw new Error(`Prompt not found: ${input.promptId}`);
  }

  const now = new Date();
  prompt.moderationStatus = "restricted";
  prompt.lifecycleState = "suspended";
  prompt.isActive = false;
  prompt.moderatedAt = now;
  prompt.moderatedBy = input.actor?.id || "moderator";
  prompt.moderationReason = input.reasonCode || input.reason || "Content policy violation";
  if (input.notes) prompt.moderationNotes = input.notes;

  const promptIdentifier = String(prompt.onChainId || prompt._id);
  if (!prompt.canonicalUrl) {
    prompt.canonicalUrl = buildCanonicalPermalink({
      id: promptIdentifier,
      slug: prompt.slug || generateSlug(prompt.title),
    });
  }

  await prompt.save();

  await recordAuditEvent({
    action: "prompt_permalink_restricted",
    result: "success",
    promptId: promptIdentifier,
    walletAddress: input.actor?.id || null,
    reason: prompt.moderationReason,
    metadata: {
      moderatedAt: now,
      canonicalUrl: prompt.canonicalUrl,
    },
  });

  return prompt;
}

/**
 * Delete a record (soft-delete / retirement):
 * Record is marked deleted. Returns 410 Gone with zero private data.
 */
export async function deleteRecord(input: PermalinkLifecycleInput) {
  const query = buildLookupQuery(input.promptId, input.by);
  const prompt = await Prompt.findOne(query);

  if (!prompt) {
    throw new Error(`Prompt not found: ${input.promptId}`);
  }

  const now = new Date();
  prompt.isDeleted = true;
  prompt.deletedAt = now;
  prompt.isActive = false;

  const promptIdentifier = String(prompt.onChainId || prompt._id);
  await prompt.save();

  await recordAuditEvent({
    action: "prompt_permalink_deleted",
    result: "success",
    promptId: promptIdentifier,
    walletAddress: input.actor?.id || null,
    reason: input.reason || "deleted",
    metadata: {
      deletedAt: now,
    },
  });

  return prompt;
}

/**
 * Resolves a permalink or slug identifier safely:
 * - Current slug or ID -> Returns canonical record (sanitized)
 * - Old slug (renamed record) -> Safe 301 redirect to canonical URL
 * - Archived record -> Safe archived response (no private prompt template leak)
 * - Restricted record -> 403 Forbidden with NO private data leak (even via old links)
 * - Deleted record -> 410 Gone with NO private data leak
 */
export async function resolvePermalink(
  identifier: string,
  context?: { viewerWallet?: string; role?: string }
): Promise<PermalinkResolution> {
  const rawNormalized = identifier.trim();
  const normalizedLower = rawNormalized.toLowerCase();

  // Search across:
  // 1. Direct ID (onChainId or _id)
  // 2. Current slug
  // 3. Historical slugs (previousSlugs, redirectsFrom)
  const isNumeric = /^\d+$/.test(rawNormalized);
  const isMongoId = /^[0-9a-fA-F]{24}$/.test(rawNormalized);

  const queryOrs: Record<string, unknown>[] = [
    { slug: normalizedLower },
    { previousSlugs: normalizedLower },
    { redirectsFrom: normalizedLower },
  ];

  if (isNumeric) {
    queryOrs.push({ onChainId: rawNormalized }, { onChainId: Number(rawNormalized) });
  }

  if (isMongoId) {
    queryOrs.push({ _id: rawNormalized });
  }

  const prompt = await Prompt.findOne({ $or: queryOrs }).populate(
    "owner",
    "username walletAddress rating"
  );

  if (!prompt) {
    return {
      status: "not_found",
      statusCode: 404,
      canonicalUrl: "",
      message: "Listing not found.",
    };
  }

  const promptIdentifier = String(prompt.onChainId || prompt._id);
  const currentSlug = prompt.slug || generateSlug(prompt.title);
  const canonicalUrl =
    prompt.canonicalUrl || buildCanonicalPermalink({ id: promptIdentifier, slug: currentSlug });

  // 1. Handle Deleted Records
  if (prompt.isDeleted) {
    return {
      status: "deleted",
      statusCode: 410,
      canonicalUrl,
      isDeleted: true,
      message: "This listing has been deleted and is no longer available.",
    };
  }

  // Determine if caller reached this record via an OLD / historical slug
  const requestedHistoricalSlug =
    (prompt.previousSlugs && prompt.previousSlugs.includes(normalizedLower)) ||
    (prompt.redirectsFrom && prompt.redirectsFrom.includes(normalizedLower));

  // 2. Handle Restricted Records
  // CRITICAL REQUIREMENT: "Restricted records do not leak through old links."
  const isRestricted =
    prompt.moderationStatus === "restricted" ||
    prompt.moderationStatus === "retired" ||
    prompt.lifecycleState === "suspended" ||
    prompt.lifecycleState === "hidden";

  if (isRestricted) {
    // Check if viewer is authorized owner or admin
    const ownerWallet =
      typeof prompt.owner === "object" && prompt.owner?.walletAddress
        ? String(prompt.owner.walletAddress).toLowerCase()
        : typeof prompt.creator === "string"
        ? prompt.creator.toLowerCase()
        : null;

    const viewer = context?.viewerWallet?.toLowerCase();
    const isOwner = Boolean(viewer && ownerWallet && viewer === ownerWallet);
    const isAdmin = context?.role === "admin" || context?.role === "moderator";

    if (!isOwner && !isAdmin) {
      // Public or unauthorized access through old link or direct link
      // MUST NOT leak private content, encrypted prompt, or internal moderation notes
      return {
        status: "restricted",
        statusCode: 403,
        canonicalUrl,
        isRestricted: true,
        reason: prompt.moderationReason || "Listing restricted by moderator.",
        message: "This listing has been restricted by moderators and cannot be viewed.",
      };
    }

    // Authorized owner/admin can see safe metadata with restricted status
    return {
      status: "restricted",
      statusCode: 403,
      canonicalUrl,
      record: sanitizePromptRecord(prompt),
      isRestricted: true,
      reason: prompt.moderationReason,
      message: "This listing is currently restricted.",
    };
  }

  // 3. Handle Renamed Records (Accessed via an old link / previous slug)
  if (requestedHistoricalSlug) {
    const isArchived =
      prompt.listingStatus === "archived" || prompt.lifecycleState === "archived";

    return {
      status: "redirect",
      statusCode: 301,
      canonicalUrl,
      targetId: promptIdentifier,
      targetSlug: currentSlug,
      isArchived,
      message: "This record has been renamed. Redirecting to canonical URL.",
    };
  }

  // 4. Handle Archived Records (Accessed via canonical link or ID)
  const isArchived =
    prompt.listingStatus === "archived" || prompt.lifecycleState === "archived";

  if (isArchived) {
    return {
      status: "archived",
      statusCode: 200,
      canonicalUrl,
      record: sanitizePromptRecord(prompt),
      isArchived: true,
      message: "This listing has been archived by the author and is no longer available for purchase.",
    };
  }

  // 5. Active Record (Normal canonical access)
  return {
    status: "active",
    statusCode: 200,
    canonicalUrl,
    record: sanitizePromptRecord(prompt),
  };
}
