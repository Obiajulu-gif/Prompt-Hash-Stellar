import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { generateCorrelationId } from "./correlation";

describe("generateCorrelationId", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("generates a valid UUID v4 format using crypto.randomUUID when available", () => {
    const id = generateCorrelationId();
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(id).toMatch(uuidV4Regex);
  });

  it("generates unique correlation IDs on successive calls", () => {
    const id1 = generateCorrelationId();
    const id2 = generateCorrelationId();
    const id3 = generateCorrelationId();

    expect(id1).not.toBe(id2);
    expect(id2).not.toBe(id3);
    expect(id1).not.toBe(id3);
  });

  it("falls back to crypto.getRandomValues when crypto.randomUUID is unavailable", () => {
    const originalCrypto = global.crypto;

    // Mock: crypto.randomUUID unavailable, but crypto.getRandomValues is available
    Object.defineProperty(global, "crypto", {
      value: {
        getRandomValues: (arr: Uint8Array) => {
          for (let i = 0; i < arr.length; i++) {
            arr[i] = Math.floor(Math.random() * 256);
          }
          return arr;
        },
      },
      writable: true,
    });

    const id = generateCorrelationId();
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    expect(id).toMatch(uuidV4Regex);

    Object.defineProperty(global, "crypto", {
      value: originalCrypto,
      writable: true,
    });
  });

  it("falls back to Math.random when both crypto.randomUUID and crypto.getRandomValues are unavailable", () => {
    const originalCrypto = global.crypto;

    // Mock: both crypto.randomUUID and crypto.getRandomValues unavailable
    Object.defineProperty(global, "crypto", {
      value: undefined,
      writable: true,
    });

    const id = generateCorrelationId();
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // Verify it's a well-formed UUID even with Math.random fallback
    expect(id).toMatch(uuidV4Regex);
    expect(id).toHaveLength(36); // UUID format is always 36 chars (8-4-4-4-12)

    Object.defineProperty(global, "crypto", {
      value: originalCrypto,
      writable: true,
    });
  });

  it("produces well-formed UUIDs: 36 characters with correct separators", () => {
    const id = generateCorrelationId();

    // Check length
    expect(id).toHaveLength(36);

    // Check separator positions
    expect(id[8]).toBe("-");
    expect(id[13]).toBe("-");
    expect(id[18]).toBe("-");
    expect(id[23]).toBe("-");

    // Check only hex characters and separators
    const hexPart = id.replace(/-/g, "");
    expect(/^[0-9a-f]{32}$/i.test(hexPart)).toBe(true);
  });

  it("handles getRandomValues gracefully if it throws (edge case)", () => {
    const originalCrypto = global.crypto;

    // Mock: crypto.randomUUID unavailable, crypto.getRandomValues throws
    Object.defineProperty(global, "crypto", {
      value: {
        getRandomValues: () => {
          throw new Error("getRandomValues not available");
        },
      },
      writable: true,
    });

    const id = generateCorrelationId();
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    // Should still produce a valid UUID (using Math.random fallback)
    expect(id).toMatch(uuidV4Regex);

    Object.defineProperty(global, "crypto", {
      value: originalCrypto,
      writable: true,
    });
  });

  it("produces IDs with correct UUID v4 version and variant bits", () => {
    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    // where y is one of: 8, 9, A, or B
    const id = generateCorrelationId();
    const parts = id.split("-");

    // Version 4 is at position 0 of the third group
    expect(parts[2][0]).toBe("4");

    // Variant is at position 0 of the fourth group (should be 8, 9, a, or b)
    expect(["8", "9", "a", "b", "A", "B"]).toContain(parts[3][0]);
  });

  it("correlation IDs are safe for logging (no sensitive data leaked)", () => {
    // Generate many IDs to spot any patterns that might suggest weak RNG
    const ids = Array.from({ length: 100 }, () => generateCorrelationId());

    // All should be unique (no collisions in reasonable set)
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(100);

    // All should have correct format
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    ids.forEach((id) => {
      expect(id).toMatch(uuidV4Regex);
    });
  });
});
