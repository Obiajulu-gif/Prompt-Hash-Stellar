/**
 * Schema compatibility tests (#1100): old clients vs new responses, and new
 * clients vs retained records, for additive / removed / renamed / type-changed
 * fields. See docs/schema-compatibility.md for the guarantees these enforce.
 */
import { describe, it, expect } from "vitest";
import {
  PROMPT_METADATA_SCHEMA_VERSION,
  LEGACY_PROMPT_SCHEMA_VERSIONS,
  promptMetadataSchema,
  validatePromptMetadata,
  migrateCategory,
  migratePromptMetadata,
} from "./promptMetadata.js";

const baseRecord = {
  title: "Compatibility test prompt",
  category: "Programming",
  image: "https://example.com/cover.png",
  price: 5,
};

describe("supported schema versions", () => {
  it("current version is among the versions we can read", () => {
    expect(LEGACY_PROMPT_SCHEMA_VERSIONS).toContain(PROMPT_METADATA_SCHEMA_VERSION);
  });

  it("rejects records from a future, unsupported schema version", () => {
    const result = migratePromptMetadata({ ...baseRecord, schemaVersion: 999 });
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });
});

describe("new client reading retained records", () => {
  it("fills defaults when optional fields are missing (additive change)", () => {
    const { data, errors } = validatePromptMetadata(baseRecord);
    expect(errors).toEqual({});
    expect(data).toMatchObject({
      schemaVersion: PROMPT_METADATA_SCHEMA_VERSION,
      description: "",
      tags: [],
      licence: "standard",
      status: "draft",
    });
  });

  it("migrates a removed category slug to its replacement", () => {
    expect(migrateCategory("software-development")).toBe("Programming");
    expect(migrateCategory("content-writing")).toBe("Creative Writing");
  });

  it("falls back to Other for a category that no longer exists", () => {
    expect(migrateCategory("totally-removed-category")).toBe("Other");
  });
});

describe("old client reading new responses", () => {
  it("ignores unknown extra fields instead of failing (added field)", () => {
    const newResponse = { ...baseRecord, newFieldFromFutureRelease: "x", ratingCount: 12 };
    const parsed = promptMetadataSchema.safeParse(newResponse);
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("newFieldFromFutureRelease");
      expect(parsed.data).not.toHaveProperty("ratingCount");
    }
  });
});

describe("incompatible changes are detected", () => {
  it.each(["title", "category", "image", "price"] as const)(
    "removed required field '%s' is rejected and reported",
    (field) => {
      const record: Record<string, unknown> = { ...baseRecord };
      delete record[field];
      const { data, errors } = validatePromptMetadata(record);
      expect(data).toBeNull();
      expect(errors[field]).toBeTruthy();
    },
  );

  it("renamed field (title -> name) is rejected", () => {
    const { title, ...rest } = baseRecord;
    const { data, errors } = validatePromptMetadata({ ...rest, name: title });
    expect(data).toBeNull();
    expect(errors.title).toBeTruthy();
  });

  it("removed enum value is rejected", () => {
    const { data, errors } = validatePromptMetadata({ ...baseRecord, category: "Video" });
    expect(data).toBeNull();
    expect(errors.category).toBeTruthy();
  });

  it("type-changed fields are rejected", () => {
    expect(validatePromptMetadata({ ...baseRecord, price: "not-a-number" }).data).toBeNull();
    expect(validatePromptMetadata({ ...baseRecord, tags: "a,b,c" }).data).toBeNull();
    expect(validatePromptMetadata({ ...baseRecord, category: 7 }).data).toBeNull();
  });

  it("numeric strings are still accepted for price (documented coercion)", () => {
    const { data } = validatePromptMetadata({ ...baseRecord, price: "12.5" });
    expect(data?.price).toBe(12.5);
  });
});
