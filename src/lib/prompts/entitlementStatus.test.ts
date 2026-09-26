import { describe, expect, it } from "vitest";
import { deriveEntitlementState } from "./entitlementStatus";

describe("deriveEntitlementState — issue #490", () => {
  it("is 'unavailable' when the listing has been delisted, regardless of unlock/reference state", () => {
    const descriptor = deriveEntitlementState({
      listingActive: false,
      referenceStatus: "ready",
      unlockState: "success",
    });

    expect(descriptor.state).toBe("unavailable");
    expect(descriptor.summary).toMatch(/delisted/i);
  });

  it("stays 'unavailable' even while the reference is pending or unlock failed", () => {
    const descriptor = deriveEntitlementState({
      listingActive: false,
      referenceStatus: "pending",
      unlockState: "failed",
    });

    expect(descriptor.state).toBe("unavailable");
  });

  it("is 'pending' when the purchase reference hasn't been indexed yet, distinct from a failure", () => {
    const descriptor = deriveEntitlementState({
      listingActive: true,
      referenceStatus: "pending",
      unlockState: "idle",
    });

    expect(descriptor.state).toBe("pending");
    // Reassures the buyer this is a delay, not a failed purchase — the
    // acceptance criterion that pending indexing must read differently from
    // a hard failure.
    expect(descriptor.summary).toMatch(/not a failed purchase/i);
    expect(descriptor.summary).toMatch(/index/i);
  });

  it("is 'active' once the reference is ready and unlock has succeeded", () => {
    const descriptor = deriveEntitlementState({
      listingActive: true,
      referenceStatus: "ready",
      unlockState: "success",
    });

    expect(descriptor.state).toBe("active");
    expect(descriptor.unlockReadiness).toMatch(/decrypted/i);
  });

  it("is 'verification_needed' before the buyer has verified wallet ownership this session", () => {
    const descriptor = deriveEntitlementState({
      listingActive: true,
      referenceStatus: "ready",
      unlockState: "idle",
    });

    expect(descriptor.state).toBe("verification_needed");
  });

  it.each([
    ["rejected", /declined/i],
    ["expired", /expired/i],
    ["failed", /verification attempt failed/i],
  ] as const)(
    "explains why access is unavailable for unlock state '%s'",
    (unlockState, expectedCopy) => {
      const descriptor = deriveEntitlementState({
        listingActive: true,
        referenceStatus: "ready",
        unlockState,
      });

      expect(descriptor.state).toBe("verification_needed");
      expect(descriptor.summary).toMatch(expectedCopy);
    },
  );

  it("shows a 'verifying' unlock readiness while signing/verifying is in progress", () => {
    const signing = deriveEntitlementState({
      listingActive: true,
      referenceStatus: "ready",
      unlockState: "signing",
    });
    const verifying = deriveEntitlementState({
      listingActive: true,
      referenceStatus: "ready",
      unlockState: "verifying",
    });

    expect(signing.unlockReadiness).toMatch(/verifying/i);
    expect(verifying.unlockReadiness).toMatch(/verifying/i);
  });

  it("treats an unknown reference status (loading/error) as verification-needed rather than pending", () => {
    const descriptor = deriveEntitlementState({
      listingActive: true,
      referenceStatus: "unknown",
      unlockState: "idle",
    });

    expect(descriptor.state).toBe("verification_needed");
  });
});
