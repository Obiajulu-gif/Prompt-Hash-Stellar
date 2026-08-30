import { describe, it, expect } from "vitest";
import {
  PROMPT_METADATA_SCHEMA_VERSION,
  PROMPT_CATEGORIES,
  promptMetadataSchema,
  validatePromptMetadata,
} from "./promptMetadata.js";
import {
  FIXTURES_SCHEMA_VERSION,
  VALID_PROMPT_METADATA_FIXTURES,
  INVALID_PROMPT_METADATA_FIXTURES,
} from "./fixtures.js";

describe("promptMetadataSchema", () => {
  it("keeps fixtures in lockstep with the schema version", () => {
    // Forces a conscious fixture review whenever the schema version bumps —
    // see the acceptance criterion "schema changes require version and
    // fixture updates".
    expect(FIXTURES_SCHEMA_VERSION).toBe(PROMPT_METADATA_SCHEMA_VERSION);
  });

  it.each(VALID_PROMPT_METADATA_FIXTURES)("accepts valid fixture %#", (fixture) => {
    const result = promptMetadataSchema.safeParse(fixture);
    expect(result.success).toBe(true);
  });

  it.each(INVALID_PROMPT_METADATA_FIXTURES)("rejects invalid fixture: $reason", ({ input }) => {
    const result = promptMetadataSchema.safeParse(input);
    expect(result.success).toBe(false);
  });

  it("returns a consistent {data, errors} shape via validatePromptMetadata", () => {
    const ok = validatePromptMetadata(VALID_PROMPT_METADATA_FIXTURES[0]);
    expect(ok.data).not.toBeNull();
    expect(Object.keys(ok.errors)).toHaveLength(0);

    const bad = validatePromptMetadata({ title: "x" });
    expect(bad.data).toBeNull();
    expect(bad.errors.title).toBeDefined();
    expect(bad.errors.category).toBeDefined();
  });

  it("defaults licence to standard and status to draft", () => {
    const result = promptMetadataSchema.parse({
      title: "Defaults check",
      category: "Other",
      image: "https://example.com/i.png",
      price: 1,
    });
    expect(result.licence).toBe("standard");
    expect(result.status).toBe("draft");
    expect(result.tags).toEqual([]);
  });

  it("exposes the canonical category list used across layers", () => {
    expect(PROMPT_CATEGORIES).toContain("Programming");
    expect(PROMPT_CATEGORIES.length).toBeGreaterThan(0);
  });
});

describe("migratePromptMetadata", () => {
  it("migrates legacy v0 unversioned metadata to current schema version", async () => {
    const { migratePromptMetadata } = await import("./promptMetadata.js");
    const legacy = {
      title: "Legacy Prompt without Schema Version",
      category: "Marketing",
      image: "https://example.com/legacy.png",
      price: "10.5",
    };

    const res = migratePromptMetadata(legacy);
    expect(res.data).not.toBeNull();
    expect(res.data?.schemaVersion).toBe(PROMPT_METADATA_SCHEMA_VERSION);
    expect(res.data?.description).toBe("");
    expect(res.data?.tags).toEqual([]);
    expect(res.data?.licence).toBe("standard");
  });

  it("fails with a clear error on unsupported future schema versions", async () => {
    const { migratePromptMetadata } = await import("./promptMetadata.js");
    const futurePrompt = {
      schemaVersion: 99,
      title: "Future Prompt",
      category: "Other",
      image: "https://example.com/future.png",
      price: 5,
    };

    const res = migratePromptMetadata(futurePrompt);
    expect(res.data).toBeNull();
    expect(res.error).toContain("Unsupported future schema version: 99");
  });

  it("fails when input is invalid or missing required title/image", async () => {
    const { migratePromptMetadata } = await import("./promptMetadata.js");
    const invalid = {
      title: "ab", // below min length
      category: "Other",
      image: "https://example.com/i.png",
      price: 1,
    };

    const res = migratePromptMetadata(invalid);
    expect(res.data).toBeNull();
    expect(res.error).toBeDefined();
  });
});
