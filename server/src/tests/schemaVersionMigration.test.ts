/**
 * Tests for server/src/db/migrations/006_schema_version_metadata.ts
 *
 * Covers:
 *  • up() stamps schemaVersion on Prompt and Review documents that lack it.
 *  • up() does NOT overwrite documents that already have a schemaVersion.
 *  • down() removes schemaVersion from all documents in both collections.
 *  • Both functions log progress messages.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { up, down } from "../db/migrations/006_schema_version_metadata";

// ---------------------------------------------------------------------------
// Mock DB helper
// ---------------------------------------------------------------------------

function makeCollection() {
  return {
    updateMany: vi.fn().mockResolvedValue({ modifiedCount: 0 }),
  };
}

function makeDb(collections: Record<string, ReturnType<typeof makeCollection>>) {
  return {
    collection: (name: string) => {
      if (!collections[name]) {
        throw new Error(`Unexpected collection: ${name}`);
      }
      return collections[name];
    },
  };
}

// ---------------------------------------------------------------------------
// up()
// ---------------------------------------------------------------------------

describe("migration 006 — up()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls updateMany on the 'prompts' collection to stamp schemaVersion", async () => {
    const prompts = makeCollection();
    const reviews = makeCollection();
    prompts.updateMany.mockResolvedValueOnce({ modifiedCount: 42 });
    reviews.updateMany.mockResolvedValueOnce({ modifiedCount: 17 });

    await up(makeDb({ prompts, reviews }) as any);

    expect(prompts.updateMany).toHaveBeenCalledOnce();
    const [filter, update] = prompts.updateMany.mock.calls[0];
    // Only update documents that have NO schemaVersion
    expect(filter).toEqual({ schemaVersion: { $exists: false } });
    // Stamp schemaVersion = 1 (the backfill version)
    expect(update.$set.schemaVersion).toBe(1);
  });

  it("calls updateMany on the 'reviews' collection to stamp schemaVersion", async () => {
    const prompts = makeCollection();
    const reviews = makeCollection();
    prompts.updateMany.mockResolvedValueOnce({ modifiedCount: 0 });
    reviews.updateMany.mockResolvedValueOnce({ modifiedCount: 8 });

    await up(makeDb({ prompts, reviews }) as any);

    expect(reviews.updateMany).toHaveBeenCalledOnce();
    const [filter, update] = reviews.updateMany.mock.calls[0];
    expect(filter).toEqual({ schemaVersion: { $exists: false } });
    expect(update.$set.schemaVersion).toBe(1);
  });

  it("does not overwrite documents that already have schemaVersion ($exists: false filter)", async () => {
    const prompts = makeCollection();
    const reviews = makeCollection();

    await up(makeDb({ prompts, reviews }) as any);

    // Both calls must use $exists: false so existing versioned docs are skipped
    expect(prompts.updateMany.mock.calls[0][0]).toEqual({
      schemaVersion: { $exists: false },
    });
    expect(reviews.updateMany.mock.calls[0][0]).toEqual({
      schemaVersion: { $exists: false },
    });
  });

  it("logs the number of modified documents for each collection", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const prompts = makeCollection();
    const reviews = makeCollection();
    prompts.updateMany.mockResolvedValueOnce({ modifiedCount: 100 });
    reviews.updateMany.mockResolvedValueOnce({ modifiedCount: 50 });

    await up(makeDb({ prompts, reviews }) as any);

    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("100"));
    expect(consoleSpy).toHaveBeenCalledWith(expect.stringContaining("50"));
    consoleSpy.mockRestore();
  });
});

// ---------------------------------------------------------------------------
// down()
// ---------------------------------------------------------------------------

describe("migration 006 — down()", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls updateMany on 'prompts' with $unset to remove schemaVersion", async () => {
    const prompts = makeCollection();
    const reviews = makeCollection();

    await down(makeDb({ prompts, reviews }) as any);

    expect(prompts.updateMany).toHaveBeenCalledOnce();
    const [filter, update] = prompts.updateMany.mock.calls[0];
    // Must target documents that DO have schemaVersion
    expect(filter).toEqual({ schemaVersion: { $exists: true } });
    // Must use $unset to remove the field
    expect(update.$unset).toBeDefined();
    expect(update.$unset.schemaVersion).toBeDefined();
  });

  it("calls updateMany on 'reviews' with $unset to remove schemaVersion", async () => {
    const prompts = makeCollection();
    const reviews = makeCollection();

    await down(makeDb({ prompts, reviews }) as any);

    expect(reviews.updateMany).toHaveBeenCalledOnce();
    const [filter, update] = reviews.updateMany.mock.calls[0];
    expect(filter).toEqual({ schemaVersion: { $exists: true } });
    expect(update.$unset).toBeDefined();
    expect(update.$unset.schemaVersion).toBeDefined();
  });

  it("logs progress for both collections", async () => {
    const consoleSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const prompts = makeCollection();
    const reviews = makeCollection();

    await down(makeDb({ prompts, reviews }) as any);

    // At least two log calls — one per collection
    expect(consoleSpy.mock.calls.length).toBeGreaterThanOrEqual(2);
    consoleSpy.mockRestore();
  });

  it("is the inverse of up() — up then down leaves no schemaVersion field", async () => {
    // Simulate up() stamping the field
    const upFilter = { schemaVersion: { $exists: false } };
    const downFilter = { schemaVersion: { $exists: true } };

    const prompts = makeCollection();
    const reviews = makeCollection();
    prompts.updateMany.mockResolvedValue({ modifiedCount: 5 });
    reviews.updateMany.mockResolvedValue({ modifiedCount: 3 });

    await up(makeDb({ prompts, reviews }) as any);
    await down(makeDb({ prompts, reviews }) as any);

    // up uses $exists: false, down uses $exists: true — they are exact inverses
    expect(prompts.updateMany.mock.calls[0][0]).toEqual(upFilter);
    expect(prompts.updateMany.mock.calls[1][0]).toEqual(downFilter);
    expect(reviews.updateMany.mock.calls[0][0]).toEqual(upFilter);
    expect(reviews.updateMany.mock.calls[1][0]).toEqual(downFilter);
  });
});
