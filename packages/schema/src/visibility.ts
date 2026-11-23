/**
 * Core Visibility Rules and Boundary Definitions — Issue #913
 *
 * Single source of truth for public, private, restricted, archived, and deleted
 * visibility boundaries across Prompt Hash Stellar.
 *
 * Guarantees that public APIs, search indexing, suggestions, category aggregations,
 * data exports, permalinks, and relationship traversal (lineage / derivatives)
 * consistently enforce access boundaries without leaking private records through
 * indirect or cached paths.
 */

export const RECORD_VISIBILITIES = [
  "public",
  "private",
  "restricted",
  "archived",
  "deleted",
] as const;

export type RecordVisibility = (typeof RECORD_VISIBILITIES)[number];

export interface ViewerContext {
  viewerWallet?: string | null;
  role?: "admin" | "moderator" | "creator" | "buyer" | "anonymous";
}

export interface VisibilityEvaluation {
  visibility: RecordVisibility;
  isPublic: boolean;
  canAccess: boolean;
  httpStatus: 200 | 301 | 403 | 404 | 410;
  redactingFields: string[];
  reasons: string[];
}

/**
 * Fields that MUST NEVER be exposed to public or unauthorized callers
 */
export const SENSITIVE_PROMPT_FIELDS = [
  "content",              // Raw prompt template
  "encryptedPrompt",      // Ciphertext payload
  "contentHash",          // Cryptographic hash (only owner on self-export)
  "moderationNotes",      // Internal moderator annotations
  "moderationReason",     // Internal moderation details (unless public summary)
  "searchIndexError",     // Internal indexing diagnostic
  "integrityError",       // Internal integrity error trace
] as const;

/**
 * Pure evaluation of a record's visibility tier and access permissions.
 *
 * Precedence order:
 * 1. DELETED: soft-deleted (`isDeleted: true` or `deletedAt != null`)
 * 2. RESTRICTED: moderation blocks (`moderationStatus` restricted/hidden/rejected, or `lifecycleState` suspended/hidden)
 * 3. ARCHIVED: archived listings (`listingStatus: "archived"`, `lifecycleState: "archived"`)
 * 4. PRIVATE: explicit `visibility: "private"`, draft status, inactive/unlisted
 * 5. PUBLIC: active, published, clean moderation, public visibility
 */
export function evaluateVisibility(
  record: any,
  viewer?: ViewerContext
): VisibilityEvaluation {
  if (!record || typeof record !== "object") {
    return {
      visibility: "deleted",
      isPublic: false,
      canAccess: false,
      httpStatus: 404,
      redactingFields: [...SENSITIVE_PROMPT_FIELDS],
      reasons: ["record_not_found"],
    };
  }

  const reasons: string[] = [];

  // 1. DELETED Check
  if (record.isDeleted === true || record.deletedAt != null || record.lifecycleState === "retired") {
    reasons.push("record_deleted");
    return {
      visibility: "deleted",
      isPublic: false,
      canAccess: false,
      httpStatus: 410,
      redactingFields: [...SENSITIVE_PROMPT_FIELDS, "title", "description", "owner", "price"],
      reasons,
    };
  }

  // Determine viewer identity
  const normalizedViewer = viewer?.viewerWallet?.toLowerCase() || null;
  const ownerWallet =
    typeof record.owner === "object" && record.owner?.walletAddress
      ? String(record.owner.walletAddress).toLowerCase()
      : typeof record.ownerWallet === "string"
      ? record.ownerWallet.toLowerCase()
      : typeof record.creatorWallet === "string"
      ? record.creatorWallet.toLowerCase()
      : typeof record.owner === "string" && record.owner.startsWith("G")
      ? record.owner.toLowerCase()
      : null;

  const isOwner = Boolean(normalizedViewer && ownerWallet && normalizedViewer === ownerWallet);
  const isAdmin = viewer?.role === "admin";
  const isModerator = viewer?.role === "moderator" || isAdmin;

  // 2. RESTRICTED Check (Moderation enforcement)
  const isRestrictedModeration =
    record.moderationStatus === "restricted" ||
    record.moderationStatus === "hidden" ||
    record.moderationStatus === "rejected" ||
    record.moderationStatus === "retired" ||
    record.lifecycleState === "suspended" ||
    record.lifecycleState === "hidden";

  if (isRestrictedModeration) {
    reasons.push(`moderation_restricted:${record.moderationStatus || record.lifecycleState}`);
    const canAccess = isModerator || isOwner;
    return {
      visibility: "restricted",
      isPublic: false,
      canAccess,
      httpStatus: canAccess ? 200 : 403,
      redactingFields: [...SENSITIVE_PROMPT_FIELDS],
      reasons,
    };
  }

  // 3. ARCHIVED Check
  const isArchived =
    record.listingStatus === "archived" ||
    record.lifecycleState === "archived" ||
    record.archivedAt != null;

  if (isArchived) {
    reasons.push("listing_archived");
    // Public callers can see a safe tombstone on direct permalink, but it cannot be purchased or searched
    return {
      visibility: "archived",
      isPublic: false,
      canAccess: true,
      httpStatus: 200,
      redactingFields: [...SENSITIVE_PROMPT_FIELDS],
      reasons,
    };
  }

  // 4. PRIVATE Check
  const isExplicitlyPrivate =
    record.visibility === "private" ||
    record.isPrivate === true;

  const isDraftOrUnpublished =
    record.listingStatus === "draft" ||
    record.lifecycleState === "draft" ||
    record.lifecycleState === "review" ||
    record.isActive === false;

  if (isExplicitlyPrivate || isDraftOrUnpublished) {
    if (isExplicitlyPrivate) reasons.push("visibility_private");
    if (isDraftOrUnpublished) reasons.push(`status_unpublished:${record.lifecycleState || record.listingStatus}`);

    const canAccess = isOwner || isAdmin;
    return {
      visibility: "private",
      isPublic: false,
      canAccess,
      httpStatus: canAccess ? 200 : 404,
      redactingFields: [...SENSITIVE_PROMPT_FIELDS],
      reasons,
    };
  }

  // 5. PUBLIC (All guards passed)
  return {
    visibility: "public",
    isPublic: true,
    canAccess: true,
    httpStatus: 200,
    redactingFields: [...SENSITIVE_PROMPT_FIELDS],
    reasons: ["active_published_public"],
  };
}

/**
 * Fast boolean test for public marketplace inclusion
 */
export function isPubliclyVisible(record: any): boolean {
  return evaluateVisibility(record).isPublic;
}

/**
 * Standard MongoDB filter object that matches ONLY records that satisfy
 * the public visibility boundary.
 */
export function buildPublicVisibilityFilter(): Record<string, any> {
  return {
    isDeleted: { $ne: true },
    deletedAt: null,
    isActive: true,
    listingStatus: "published",
    lifecycleState: {
      $nin: ["draft", "review", "hidden", "suspended", "archived", "retired"],
    },
    visibility: { $ne: "private" },
    moderationStatus: {
      $nin: ["restricted", "hidden", "flagged", "rejected", "retired"],
    },
    integrityStatus: { $nin: ["corrupted", "missing"] },
    similarityFlag: { $ne: "highly_similar" },
  };
}

/**
 * Strips all sensitive fields from a prompt record regardless of viewer
 * to guarantee that internal secrets never leak across any serialization boundary.
 */
export function stripSensitivePromptFields<T extends Record<string, any>>(record: T): Partial<T> {
  if (!record || typeof record !== "object") return record;
  const copy: any = { ...record };
  for (const field of SENSITIVE_PROMPT_FIELDS) {
    delete copy[field];
  }
  return copy;
}

/**
 * Sanitize node representation for relationship traversal (ancestors / derivatives).
 * When node is non-public, hides title and link while keeping graph structure valid.
 */
export function sanitizeRelationshipNode(
  nodeDoc: any,
  viewer?: ViewerContext
): {
  visibility: RecordVisibility;
  title: string | null;
  link: string | null;
  isRedacted: boolean;
} {
  const evaluation = evaluateVisibility(nodeDoc, viewer);
  if (evaluation.isPublic || (evaluation.canAccess && evaluation.visibility !== "deleted")) {
    return {
      visibility: evaluation.visibility,
      title: nodeDoc?.title ?? (nodeDoc?.onChainId ? `Prompt #${nodeDoc.onChainId}` : null),
      link: nodeDoc?.onChainId ? `/prompts/${nodeDoc.onChainId}` : null,
      isRedacted: !evaluation.isPublic,
    };
  }

  return {
    visibility: evaluation.visibility,
    title: null,
    link: null,
    isRedacted: true,
  };
}
