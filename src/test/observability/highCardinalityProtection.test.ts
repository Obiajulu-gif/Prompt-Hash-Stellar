import { describe, it, expect } from "vitest";
import {
  hashUserIdentifier,
  truncateValue,
  classifyPayloadSize,
  protectHighCardinalityPayload,
} from "../../lib/observability/highCardinalityProtection";

describe("High-Cardinality Log Protection (#924)", () => {
  it("hashes user identifiers into safe correlation tokens", () => {
    const rawUserId = "user-alice-123456789";
    const hashedToken = hashUserIdentifier(rawUserId);

    expect(hashedToken).not.toBe(rawUserId);
    expect(hashedToken).toMatch(/^corr_[a-f0-9]{12}$/);
    // Deterministic for same input
    expect(hashUserIdentifier(rawUserId)).toBe(hashedToken);
  });

  it("truncates unbounded user-provided text payloads", () => {
    const longInput = "A".repeat(200);
    const truncated = truncateValue(longInput, 64);

    expect(truncated.length).toBeLessThan(longInput.length);
    expect(truncated).toContain("...[truncated length=200]");
  });

  it("classifies payload sizes into low-cardinality metrics categories", () => {
    expect(classifyPayloadSize(50)).toBe("small_le_128b");
    expect(classifyPayloadSize(500)).toBe("medium_le_1kb");
    expect(classifyPayloadSize(5000)).toBe("large_le_10kb");
    expect(classifyPayloadSize(50000)).toBe("xlarge_gt_10kb");
  });

  it("sanitizes nested unsafe log examples preventing high-cardinality exposure", () => {
    const unsafeLogExample = {
      userId: "user-secret-999",
      userInput: "This is a super long raw prompt input ".repeat(10),
      rawPayload: "x".repeat(500),
      metadata: {
        searchQuery: "find prompt with sensitive term ".repeat(5),
        safeField: 12345,
      },
    };

    const sanitized = protectHighCardinalityPayload(unsafeLogExample) as Record<string, any>;

    // Raw user identifier should be hashed into correlation token
    expect(sanitized.userId).toMatch(/^corr_[a-f0-9]{12}$/);
    expect(sanitized.userId).not.toContain("user-secret-999");

    // Long user inputs should be truncated
    expect(sanitized.userInput).toContain("...[truncated");
    expect(sanitized.rawPayload).toContain("...[truncated");
    expect(sanitized.metadata.searchQuery).toContain("...[truncated");

    // Safe low-cardinality values preserved
    expect(sanitized.metadata.safeField).toBe(12345);
  });
});
