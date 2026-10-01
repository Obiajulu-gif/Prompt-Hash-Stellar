/**
 * Record-level schema versioning and compatibility transforms — Issue #677 / #502.
 *
 * Each persisted document type (Prompt, Review) carries a `schemaVersion`
 * integer field. This module is the single source of truth for:
 *
 *   • The current (latest) version number for each type.
 *   • Read-path transforms: normalise older records to the current shape
 *     before the API layer returns them, so no client ever sees a missing
 *     field or stale enum value.
 *   • Write-path helpers: stamp the current version on new documents so
 *     future migrations can use it as a discriminant.
 *   • Unsupported-version rejection: documents written by a *newer* codebase
 *     than the one currently running are refused rather than silently
 *     mangled.
 *
 * Adding a new field or changing a default?
 *   1. Increment the relevant CURRENT_*_SCHEMA_VERSION constant.
 *   2. Add a `case` (or fill-in) in the corresponding transform function.
 *   3. Add a migration under server/src/db/migrations/ to backfill existing
 *      documents at rest (see 006_schema_version_metadata.ts).
 *   4. Update the fixtures and tests in server/src/tests/schemaVersioning.test.ts.
 */

// ---------------------------------------------------------------------------
// Version constants
// ---------------------------------------------------------------------------

/** Schema version stamped on every new Prompt document. */
export const CURRENT_PROMPT_SCHEMA_VERSION = 2;

/** Schema version stamped on every new Review document. */
export const CURRENT_REVIEW_SCHEMA_VERSION = 2;

// ---------------------------------------------------------------------------
// Prompt compatibility transform
// ---------------------------------------------------------------------------

/**
 * Shape returned by the API for a single Prompt. Only the fields that the
 * compatibility transform guarantees are listed here; Mongoose adds the rest.
 */
export interface PromptApiShape {
  schemaVersion: number;
  /** Lifecycle state, back-derived for v1 records that lack it. */
  lifecycleState: string;
  /** Normalised moderation status — never null on the wire. */
  moderationStatus: string;
  /** Tags array, always present (empty array for records that predate tags). */
  tags: string[];
  /** Description, always a string (never null/undefined). */
  description: string;
  /** Licence type, always present. */
  licence: string;
  [key: string]: unknown;
}

/**
 * Validate that `version` is a supported Prompt schema version.
 *
 * Returns an error string when the version is *higher* than what this build
 * understands (written by a newer deployment), or when it is an unrecognised
 * negative/NaN value. Returns `null` when the version is acceptable.
 */
export function assertSupportedPromptVersion(version: unknown): string | null {
  const v = typeof version === "number" ? version : 0; // treat absent as v0
  if (v > CURRENT_PROMPT_SCHEMA_VERSION) {
    return (
      `Unsupported Prompt schema version ${v}. ` +
      `This build supports up to version ${CURRENT_PROMPT_SCHEMA_VERSION}.`
    );
  }
  return null;
}

/**
 * Normalise a raw Prompt document (any version) to the current API shape.
 *
 * Safe to call on:
 *  • Brand-new documents (schemaVersion === CURRENT_PROMPT_SCHEMA_VERSION).
 *  • Legacy v1 or v0 (unversioned) documents fetched from MongoDB.
 *
 * Throws a {@link SchemaVersionError} for documents written by a future
 * build (version > CURRENT) so callers can surface a 422 rather than
 * silently returning garbage.
 */
export function transformPromptForApi(raw: Record<string, unknown>): PromptApiShape {
  const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;

  const unsupported = assertSupportedPromptVersion(version);
  if (unsupported) {
    throw new SchemaVersionError(unsupported, version, CURRENT_PROMPT_SCHEMA_VERSION);
  }

  // Baseline — copy all existing fields first so nothing is lost.
  const out: PromptApiShape = {
    ...raw,
    schemaVersion: CURRENT_PROMPT_SCHEMA_VERSION,
    lifecycleState: String(raw.lifecycleState ?? deriveLifecycleFallback(raw)),
    moderationStatus: String(raw.moderationStatus ?? "none"),
    tags: Array.isArray(raw.tags) ? (raw.tags as string[]) : [],
    description: typeof raw.description === "string" ? raw.description : "",
    licence: typeof raw.licence === "string" ? raw.licence : "standard",
  };

  // v0 → v1 specific fills (records predating Issue #502)
  if (version < 1) {
    out.category = raw.category ?? "Other";
    out.listingStatus = raw.listingStatus ?? "draft";
  }

  // v1 → v2 specific fills (records predating lifecycle field — Issue #786)
  if (version < 2) {
    // Ensure lifecycleState is present (back-derived above already, but
    // make sure the migration-path default is correct).
    if (!raw.lifecycleState) {
      out.lifecycleState = deriveLifecycleFallback(raw);
    }
  }

  return out;
}

/**
 * Return the `schemaVersion` value to stamp on a new Prompt write.
 * Call this in any controller/service that creates or upserts a Prompt.
 */
export function currentPromptSchemaVersion(): number {
  return CURRENT_PROMPT_SCHEMA_VERSION;
}

// ---------------------------------------------------------------------------
// Review compatibility transform
// ---------------------------------------------------------------------------

export interface ReviewApiShape {
  schemaVersion: number;
  id: string;
  promptId: string;
  userAddress: string;
  rating: number;
  text: string;
  createdAt: number;
  verified: boolean;
  /** Status field, always present for v2+. */
  status: string;
  [key: string]: unknown;
}

/**
 * Validate that `version` is a supported Review schema version.
 */
export function assertSupportedReviewVersion(version: unknown): string | null {
  const v = typeof version === "number" ? version : 0;
  if (v > CURRENT_REVIEW_SCHEMA_VERSION) {
    return (
      `Unsupported Review schema version ${v}. ` +
      `This build supports up to version ${CURRENT_REVIEW_SCHEMA_VERSION}.`
    );
  }
  return null;
}

/**
 * Normalise a raw Review document (any version) to the current API shape.
 */
export function transformReviewForApi(raw: Record<string, unknown>): ReviewApiShape {
  const version = typeof raw.schemaVersion === "number" ? raw.schemaVersion : 0;

  const unsupported = assertSupportedReviewVersion(version);
  if (unsupported) {
    throw new SchemaVersionError(unsupported, version, CURRENT_REVIEW_SCHEMA_VERSION);
  }

  const ratingRaw = raw.rating as number | undefined;
  const ratingVal = Math.min(5, Math.max(1, Math.round(ratingRaw ?? 5)));

  const out: ReviewApiShape = {
    ...raw,
    schemaVersion: CURRENT_REVIEW_SCHEMA_VERSION,
    id: String(raw._id ?? raw.id ?? ""),
    promptId: String(raw.promptId ?? ""),
    userAddress: String(raw.userAddress ?? ""),
    rating: ratingVal,
    text: typeof raw.text === "string" ? raw.text : "",
    createdAt: raw.createdAt instanceof Date
      ? raw.createdAt.getTime()
      : typeof raw.createdAt === "number"
        ? raw.createdAt
        : Date.now(),
    verified: raw.verified !== false,
    // v0/v1 records predate the `status` field — default to "published"
    // (they were visible, so they were implicitly published).
    status: typeof raw.status === "string" ? raw.status : "published",
  };

  return out;
}

/**
 * Return the `schemaVersion` value to stamp on a new Review write.
 */
export function currentReviewSchemaVersion(): number {
  return CURRENT_REVIEW_SCHEMA_VERSION;
}

// ---------------------------------------------------------------------------
// Shared error type
// ---------------------------------------------------------------------------

/** Thrown when a document's schemaVersion exceeds what this build supports. */
export class SchemaVersionError extends Error {
  readonly detectedVersion: number;
  readonly maxSupportedVersion: number;

  constructor(message: string, detectedVersion: number, maxSupportedVersion: number) {
    super(message);
    this.name = "SchemaVersionError";
    this.detectedVersion = detectedVersion;
    this.maxSupportedVersion = maxSupportedVersion;
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Back-derive a lifecycleState for legacy records that predate the
 * lifecycle field (Issue #786). Mirrors the logic in packages/schema/lifecycle.ts
 * without importing it so this module stays framework-free.
 */
function deriveLifecycleFallback(raw: Record<string, unknown>): string {
  const moderation = String(raw.moderationStatus ?? "none");
  if (moderation === "retired") return "archived";
  if (moderation === "restricted") return "hidden";
  if (raw.isActive === false) return "hidden";
  switch (raw.listingStatus) {
    case "draft":     return "draft";
    case "ready":     return "review";
    case "published": return "published";
    case "archived":  return "archived";
    default:          return "draft";
  }
}
