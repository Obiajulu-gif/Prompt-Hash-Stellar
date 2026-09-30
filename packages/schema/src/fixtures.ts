/**
 * Fixture examples for the prompt metadata schema — kept in lockstep with
 * PROMPT_METADATA_SCHEMA_VERSION. promptMetadata.test.ts fails if this file's
 * version tag drifts from the schema's without a matching update, so any
 * schema change forces a conscious fixture review.
 *
 * Legacy fixtures (LEGACY_PROMPT_METADATA_FIXTURES) in this file are
 * deliberately shaped like historical prompt records that predate the current
 * schema. They are consumed by the migration layer and its tests so that
 * compatibility behaviour is exercised against realistic old shapes. See
 * migrations/README.md for provenance and coverage notes.
 */
import { PROMPT_METADATA_SCHEMA_VERSION } from "./promptMetadata.js";

export const FIXURES_SCHEMA_VERSION = PROMPT_METADATA_SCHEMA_VERSION;

export const VALID_PROMPT_METADATA_FIXURES: unknown[] = [
  {
    title: "Board-ready launch plan",
    description: "A step-by-step go-to-market plan for a B2B SaaS launch.",
    category: "Marketing",
    tags: ["launch", "b2b", "saas"],
    image: "https://example.com/prompt-cover.png",
    price: 2.5,
    licence: "standard",
    status: "published",
  },
  {
    title: "Minimal metadata",
    category: "Other",
    image: "http://example.com/img.png",
    price: "0.5",
  },
];

export const INVALID_PROMPT_METADATA_FIXTURES: { input: unknown; reason: string }[] = [
  {
    input: { title: "ab", category: "Other", image: "https://x.com/i.png", price: 1 },
    reason: "title below minimum length",
  },
  {
    input: { title: "Valid title", category: "Not-A-Category", image: "https://x.com/i.png", price: 1 },
    reason: "category not in the canonical list",
  },
  {
    input: { title: "Valid title", category: "Other", image: "ftp://x.com/i.png", price: 1 },
    reason: "image URL missing http(s) scheme",
  },
  {
    input: { title: "Valid title", category: "Other", image: "https://x.com/i.png", price: 0 },
    reason: "price not greater than the minimum",
  },
  {
    input: {
      title: "Valid title",
      category: "Other",
      image: "https://x.com/i.png",
      price: 1,
      tags: Array.from({ length: 11 }, (_, i) => `tag-${i}`),
    },
    reason: "more than the maximum number of tags",
  },
];

/**
 * Legacy schema identifiers. These are the version tags that historically
 * appeared on persisted prompt records before the current schema. They are
 * recorded here so the migration layer and its tests can assert on them
 * without relying on magic strings dispersed across the codebase.
 */
export const LEGACY_SCHEMA_VERSION_V0 = "v0" as const;
export const LEGACY_SCHEMA_VERSION_V1 = "v1" as const;

/**
 * Shape of a legacy prompt record as stored by older releases. The fields
 * are intentionally loose ("unknown") because legacy records can carry
 * deprecated, missing, or otherwise unexpected values that the migration
 * layer must normalise or reject.
 */
export interface LegacyPromptRecord {
  schemaVersion: typeof LEGACY_SCHEMA_VERSION_V0 | typeof LEGACY_SCHEMA_VERSION_V1;
  data: Record<string, unknown>;
}

/**
 * Legacy fixtures for known previous schemas. Each entry describes the
 * origin and the expected migration outcome so tests can assert on both
 * the input shape and the output contract.
 */
export interface LegacyPromptFixture {
  /** Stable identifier used in test names and documentation. */
  name: string;
  /** Where this shape came from (release, tag, or migration note). */
  provenance: string;
  /** One line description of what this fixture exercises. */
  coverage: string;
  /** The legacy record as it would have been persisted. */
  record: LegacyPromptRecord;
  /**
   * Expected migration result. "ok" means the migration should produce a
   * current valid record; "incompatible" means the migration must reject
   * the record with a diagnostic message.
   */
  expected: "ok" | "incompatible";
}

export const LEGACY_PROMPT_FIXTURES: LegacyPromptFixture[] = [
  {
    name: "clean-v0",
    provenance: "V0 release (2023-08), pre-licence field",
    coverage: "clean legacy record that migrates without any normalisation",
    record: {
      schemaVersion: LEGACY_SCHEMA_VERSION_V0,
      data: {
        title: "Board-ready launch plan",
        description: "A step-by-step go-to-market plan for a B2B SaaS launch.",
        category: "Marketing",
        tags: ["launch", "b2b", "saas"],
        image: "https://example.com/prompt-cover.png",
        price: 2.5,
        licence: "standard",
        status: "published",
      },
    },
    expected: "ok",
  },
  {
    name: "missing-description-v0",
    provenance: "V0 release (2023-08), description was optional",
    coverage: "missing field that must be defaulted during migration",
    record: {
      schemaVersion: LEGACY_SCHEMA_VERSION_V0,
      data: {
        title: "Minimal metadata",
        category: "Other",
        image: "https://example.com/img.png",
        price: "0.5",
      },
    },
    expected: "ok",
  },
  {
    name: "deprecated-subcategory-v1",
    provenance: "V1 release (2024-02), subcategory was removed in favour of tags",
    coverage: "deprecated field that must be dropped and folded into tags",
    record: {
      schemaVersion: LEGACY_SCHEMA_VERSION_V1,
      data: {
        title: "Board-ready launch plan",
        description: "A step-by-step go-to-market plan for a B2B SaaS launch.",
        category: "Marketing",
        subcategory: "launch",
        tags: ["b2b", "saas"],
        image: "https://example.com/prompt-cover.png",
        price: 2.5,
        licence: "standard",
        status: "published",
      },
    },
    expected: "ok",
  },
  {
    name: "incompatible-unknown-version",
    provenance: "Unknown / future schema version encountered in the wild",
    coverage: "incompatible legacy record that must be rejected with a diagnostic",
    record: {
      schemaVersion: "v9" as typeof LEGACY_SCHEMA_VERSION_V0,
      data: {
        title: "Board-ready launch plan",
        category: "Marketing",
        image: "https://example.com/prompt-cover.png",
        price: 2.5,
      },
    },
    expected: "incompatible",
  },
];
