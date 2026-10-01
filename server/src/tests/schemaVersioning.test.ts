/**
 * Tests for server/src/services/schemaVersioning.ts
 *
 * Covers:
 *  • Legacy record reads (schemaVersion absent / 0 / 1) → normalised to
 *    current shape with all guaranteed fields populated.
 *  • New writes (schemaVersion === current) → pass-through with no mutation.
 *  • Unsupported future versions → SchemaVersionError thrown.
 *  • assertSupported* helpers return error strings / null as expected.
 *  • currentPrompt/ReviewSchemaVersion() return the expected constants.
 */

import { describe, it, expect } from "vitest";
import {
  CURRENT_PROMPT_SCHEMA_VERSION,
  CURRENT_REVIEW_SCHEMA_VERSION,
  transformPromptForApi,
  transformReviewForApi,
  assertSupportedPromptVersion,
  assertSupportedReviewVersion,
  currentPromptSchemaVersion,
  currentReviewSchemaVersion,
  SchemaVersionError,
} from "../services/schemaVersioning";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Minimal v0 Prompt (no schemaVersion, no lifecycleState) — pre-migration. */
const legacyV0Prompt: Record<string, unknown> = {
  _id: "abc123",
  title: "Legacy prompt",
  image: "https://example.com/img.png",
  price: 5,
  owner: "user1",
  listingStatus: "published",
  isActive: true,
  category: "Marketing",
  // No schemaVersion, no lifecycleState, no tags, no description, no licence
};

/** v1 Prompt — has schemaVersion but no lifecycleState yet (pre-#786). */
const v1Prompt: Record<string, unknown> = {
  ...legacyV0Prompt,
  schemaVersion: 1,
  tags: ["launch"],
  description: "A v1 prompt",
};

/** Current-version Prompt — all fields present. */
const currentPrompt: Record<string, unknown> = {
  ...v1Prompt,
  schemaVersion: CURRENT_PROMPT_SCHEMA_VERSION,
  lifecycleState: "published",
  moderationStatus: "none",
  licence: "standard",
};

/** Prompt from a hypothetical future build (version > current). */
const futurePrompt: Record<string, unknown> = {
  ...currentPrompt,
  schemaVersion: CURRENT_PROMPT_SCHEMA_VERSION + 10,
  someNewFutureField: true,
};

/** Minimal v0 Review (no schemaVersion, no status). */
const legacyV0Review: Record<string, unknown> = {
  _id: "rev1",
  promptId: "prompt1",
  userAddress: "GABC",
  rating: 4,
  text: "Good prompt",
  createdAt: new Date("2024-01-01T00:00:00Z"),
  verified: true,
  // No schemaVersion, no status
};

/** v1 Review — has schemaVersion 1 but still no explicit status. */
const v1Review: Record<string, unknown> = {
  ...legacyV0Review,
  schemaVersion: 1,
};

/** Current-version Review. */
const currentReview: Record<string, unknown> = {
  ...v1Review,
  schemaVersion: CURRENT_REVIEW_SCHEMA_VERSION,
  status: "published",
};

/** Future Review (version > current). */
const futureReview: Record<string, unknown> = {
  ...currentReview,
  schemaVersion: CURRENT_REVIEW_SCHEMA_VERSION + 5,
};

// ---------------------------------------------------------------------------
// Prompt — version constants
// ---------------------------------------------------------------------------

describe("schemaVersioning constants", () => {
  it("currentPromptSchemaVersion() matches CURRENT_PROMPT_SCHEMA_VERSION", () => {
    expect(currentPromptSchemaVersion()).toBe(CURRENT_PROMPT_SCHEMA_VERSION);
  });

  it("currentReviewSchemaVersion() matches CURRENT_REVIEW_SCHEMA_VERSION", () => {
    expect(currentReviewSchemaVersion()).toBe(CURRENT_REVIEW_SCHEMA_VERSION);
  });
});

// ---------------------------------------------------------------------------
// assertSupportedPromptVersion
// ---------------------------------------------------------------------------

describe("assertSupportedPromptVersion", () => {
  it("returns null for version 0 (absent)", () => {
    expect(assertSupportedPromptVersion(0)).toBeNull();
  });

  it("returns null for version 1", () => {
    expect(assertSupportedPromptVersion(1)).toBeNull();
  });

  it("returns null for the current version", () => {
    expect(assertSupportedPromptVersion(CURRENT_PROMPT_SCHEMA_VERSION)).toBeNull();
  });

  it("returns null when version is absent (undefined treated as 0)", () => {
    expect(assertSupportedPromptVersion(undefined)).toBeNull();
  });

  it("returns an error string for a future version", () => {
    const result = assertSupportedPromptVersion(CURRENT_PROMPT_SCHEMA_VERSION + 1);
    expect(typeof result).toBe("string");
    expect(result).toContain("Unsupported");
  });

  it("includes the detected and max versions in the error message", () => {
    const future = CURRENT_PROMPT_SCHEMA_VERSION + 99;
    const result = assertSupportedPromptVersion(future);
    expect(result).toContain(String(future));
    expect(result).toContain(String(CURRENT_PROMPT_SCHEMA_VERSION));
  });
});

// ---------------------------------------------------------------------------
// assertSupportedReviewVersion
// ---------------------------------------------------------------------------

describe("assertSupportedReviewVersion", () => {
  it("returns null for version 0", () => {
    expect(assertSupportedReviewVersion(0)).toBeNull();
  });

  it("returns null for the current version", () => {
    expect(assertSupportedReviewVersion(CURRENT_REVIEW_SCHEMA_VERSION)).toBeNull();
  });

  it("returns an error string for a future version", () => {
    const result = assertSupportedReviewVersion(CURRENT_REVIEW_SCHEMA_VERSION + 1);
    expect(typeof result).toBe("string");
    expect(result).toContain("Unsupported");
  });
});

// ---------------------------------------------------------------------------
// transformPromptForApi — legacy reads
// ---------------------------------------------------------------------------

describe("transformPromptForApi — legacy records", () => {
  it("normalises a v0 (unversioned) prompt to the current schema version", () => {
    const out = transformPromptForApi(legacyV0Prompt);
    expect(out.schemaVersion).toBe(CURRENT_PROMPT_SCHEMA_VERSION);
  });

  it("fills missing tags with an empty array on v0 records", () => {
    const out = transformPromptForApi(legacyV0Prompt);
    expect(Array.isArray(out.tags)).toBe(true);
    expect(out.tags).toEqual([]);
  });

  it("fills missing description with an empty string on v0 records", () => {
    const out = transformPromptForApi(legacyV0Prompt);
    expect(out.description).toBe("");
  });

  it("fills missing licence with 'standard' on v0 records", () => {
    const out = transformPromptForApi(legacyV0Prompt);
    expect(out.licence).toBe("standard");
  });

  it("derives lifecycleState from listingStatus for v0 published records", () => {
    const out = transformPromptForApi(legacyV0Prompt);
    expect(out.lifecycleState).toBe("published");
  });

  it("derives lifecycleState 'hidden' when isActive is false", () => {
    const out = transformPromptForApi({ ...legacyV0Prompt, isActive: false });
    expect(out.lifecycleState).toBe("hidden");
  });

  it("derives lifecycleState 'archived' when moderationStatus is retired", () => {
    const out = transformPromptForApi({
      ...legacyV0Prompt,
      moderationStatus: "retired",
    });
    expect(out.lifecycleState).toBe("archived");
  });

  it("derives lifecycleState 'hidden' when moderationStatus is restricted", () => {
    const out = transformPromptForApi({
      ...legacyV0Prompt,
      moderationStatus: "restricted",
    });
    expect(out.lifecycleState).toBe("hidden");
  });

  it("derives lifecycleState 'review' from listingStatus 'ready'", () => {
    const out = transformPromptForApi({
      ...legacyV0Prompt,
      listingStatus: "ready",
    });
    expect(out.lifecycleState).toBe("review");
  });

  it("defaults lifecycleState to 'draft' for unknown listingStatus", () => {
    const out = transformPromptForApi({
      ...legacyV0Prompt,
      listingStatus: "unknown_value",
    });
    expect(out.lifecycleState).toBe("draft");
  });

  it("normalises moderationStatus from null to 'none'", () => {
    const out = transformPromptForApi({
      ...legacyV0Prompt,
      moderationStatus: null,
    });
    expect(out.moderationStatus).toBe("none");
  });

  it("normalises a v1 prompt — preserves its tags and description", () => {
    const out = transformPromptForApi(v1Prompt);
    expect(out.schemaVersion).toBe(CURRENT_PROMPT_SCHEMA_VERSION);
    expect(out.tags).toEqual(["launch"]);
    expect(out.description).toBe("A v1 prompt");
  });

  it("preserves all existing fields not touched by the transform", () => {
    const out = transformPromptForApi(legacyV0Prompt);
    expect(out.title).toBe("Legacy prompt");
    expect(out.price).toBe(5);
    expect(out.owner).toBe("user1");
  });
});

// ---------------------------------------------------------------------------
// transformPromptForApi — current-version records (new writes)
// ---------------------------------------------------------------------------

describe("transformPromptForApi — current-version records", () => {
  it("passes through a current-version prompt without mutating domain fields", () => {
    const out = transformPromptForApi(currentPrompt);
    expect(out.schemaVersion).toBe(CURRENT_PROMPT_SCHEMA_VERSION);
    expect(out.lifecycleState).toBe("published");
    expect(out.moderationStatus).toBe("none");
    expect(out.tags).toEqual(["launch"]);
    expect(out.description).toBe("A v1 prompt");
    expect(out.licence).toBe("standard");
  });

  it("does not lose any fields from the current-version record", () => {
    const out = transformPromptForApi(currentPrompt);
    expect(out.title).toBe("Legacy prompt");
    expect(out.image).toBe("https://example.com/img.png");
  });
});

// ---------------------------------------------------------------------------
// transformPromptForApi — unsupported (future) versions
// ---------------------------------------------------------------------------

describe("transformPromptForApi — unsupported future versions", () => {
  it("throws SchemaVersionError for a future-version prompt", () => {
    expect(() => transformPromptForApi(futurePrompt)).toThrow(SchemaVersionError);
  });

  it("error includes the detected version number", () => {
    try {
      transformPromptForApi(futurePrompt);
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaVersionError);
      const err = e as SchemaVersionError;
      expect(err.detectedVersion).toBe(CURRENT_PROMPT_SCHEMA_VERSION + 10);
      expect(err.maxSupportedVersion).toBe(CURRENT_PROMPT_SCHEMA_VERSION);
    }
  });

  it("error message mentions 'Unsupported'", () => {
    try {
      transformPromptForApi(futurePrompt);
      expect.fail("should have thrown");
    } catch (e) {
      expect((e as Error).message).toContain("Unsupported");
    }
  });
});

// ---------------------------------------------------------------------------
// transformReviewForApi — legacy reads
// ---------------------------------------------------------------------------

describe("transformReviewForApi — legacy records", () => {
  it("normalises a v0 review to the current schema version", () => {
    const out = transformReviewForApi(legacyV0Review);
    expect(out.schemaVersion).toBe(CURRENT_REVIEW_SCHEMA_VERSION);
  });

  it("defaults status to 'published' for pre-moderation records (v0)", () => {
    const out = transformReviewForApi(legacyV0Review);
    expect(out.status).toBe("published");
  });

  it("defaults status to 'published' for v1 records without status", () => {
    const out = transformReviewForApi(v1Review);
    expect(out.status).toBe("published");
  });

  it("populates id from _id", () => {
    const out = transformReviewForApi(legacyV0Review);
    expect(out.id).toBe("rev1");
  });

  it("normalises createdAt Date to a millisecond timestamp", () => {
    const out = transformReviewForApi(legacyV0Review);
    expect(typeof out.createdAt).toBe("number");
    expect(out.createdAt).toBe(new Date("2024-01-01T00:00:00Z").getTime());
  });

  it("clamps rating to 1–5 range", () => {
    const out = transformReviewForApi({ ...legacyV0Review, rating: 0 });
    expect(out.rating).toBe(1);

    const out2 = transformReviewForApi({ ...legacyV0Review, rating: 99 });
    expect(out2.rating).toBe(5);
  });

  it("defaults missing text to empty string", () => {
    const out = transformReviewForApi({ ...legacyV0Review, text: undefined });
    expect(out.text).toBe("");
  });

  it("treats missing verified as true (old records had implicit verification)", () => {
    const out = transformReviewForApi({ ...legacyV0Review, verified: undefined });
    expect(out.verified).toBe(true);
  });

  it("respects verified: false", () => {
    const out = transformReviewForApi({ ...legacyV0Review, verified: false });
    expect(out.verified).toBe(false);
  });

  it("preserves existing fields not touched by the transform", () => {
    const out = transformReviewForApi(legacyV0Review);
    expect(out.promptId).toBe("prompt1");
    expect(out.userAddress).toBe("GABC");
  });
});

// ---------------------------------------------------------------------------
// transformReviewForApi — current-version records (new writes)
// ---------------------------------------------------------------------------

describe("transformReviewForApi — current-version records", () => {
  it("passes through a current-version review correctly", () => {
    const out = transformReviewForApi(currentReview);
    expect(out.schemaVersion).toBe(CURRENT_REVIEW_SCHEMA_VERSION);
    expect(out.status).toBe("published");
    expect(out.rating).toBe(4);
    expect(out.verified).toBe(true);
  });

  it("preserves explicit status values (flagged, hidden) from new records", () => {
    const flagged = transformReviewForApi({ ...currentReview, status: "flagged" });
    expect(flagged.status).toBe("flagged");
  });
});

// ---------------------------------------------------------------------------
// transformReviewForApi — unsupported future versions
// ---------------------------------------------------------------------------

describe("transformReviewForApi — unsupported future versions", () => {
  it("throws SchemaVersionError for a future-version review", () => {
    expect(() => transformReviewForApi(futureReview)).toThrow(SchemaVersionError);
  });

  it("error carries correct detectedVersion and maxSupportedVersion", () => {
    try {
      transformReviewForApi(futureReview);
      expect.fail("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(SchemaVersionError);
      const err = e as SchemaVersionError;
      expect(err.detectedVersion).toBe(CURRENT_REVIEW_SCHEMA_VERSION + 5);
      expect(err.maxSupportedVersion).toBe(CURRENT_REVIEW_SCHEMA_VERSION);
    }
  });
});

// ---------------------------------------------------------------------------
// SchemaVersionError shape
// ---------------------------------------------------------------------------

describe("SchemaVersionError", () => {
  it("is an instance of Error", () => {
    const err = new SchemaVersionError("test", 99, 2);
    expect(err).toBeInstanceOf(Error);
  });

  it("has name SchemaVersionError", () => {
    const err = new SchemaVersionError("test", 99, 2);
    expect(err.name).toBe("SchemaVersionError");
  });

  it("exposes detectedVersion and maxSupportedVersion", () => {
    const err = new SchemaVersionError("test msg", 99, 2);
    expect(err.detectedVersion).toBe(99);
    expect(err.maxSupportedVersion).toBe(2);
  });
});
