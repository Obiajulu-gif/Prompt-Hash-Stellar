import { describe, expect, it } from "vitest";
import {
  calculateCreatorTrustScore,
  describeCreatorTrustScore,
  normalizeCreatorTrustScore,
} from "./creatorTrustScore";

describe("creator trust scoring", () => {
  it("uses a bounded, reproducible score for brand-new creators", () => {
    const snapshot = calculateCreatorTrustScore({
      qualityScore: 3.8,
      refundRate: 0.04,
      moderationFlags: 0,
      moderationActions: 0,
      salesCount: 0,
      totalListings: 1,
      isNewCreator: true,
    });

    expect(snapshot.score).toBeGreaterThan(0);
    expect(snapshot.score).toBeLessThanOrEqual(100);
    expect(snapshot.band).toBe("new");
    expect(snapshot.explanation.length).toBeGreaterThan(0);
    expect(normalizeCreatorTrustScore(4.5)).toBe(90);
  });

  it("penalizes creators with elevated refund and moderation history", () => {
    const snapshot = calculateCreatorTrustScore({
      qualityScore: 2.6,
      refundRate: 0.25,
      moderationFlags: 2,
      moderationActions: 1,
      salesCount: 6,
      totalListings: 3,
      isNewCreator: false,
    });

    expect(snapshot.score).toBeLessThan(65);
    expect(snapshot.refundPenalty).toBeGreaterThan(0);
    expect(snapshot.moderationPenalty).toBeGreaterThan(0);
    expect(snapshot.band).toBe("watch");
  });

  it("recovers after clean performance and low refund rate", () => {
    const snapshot = calculateCreatorTrustScore({
      qualityScore: 4.8,
      refundRate: 0.03,
      moderationFlags: 0,
      moderationActions: 0,
      salesCount: 20,
      totalListings: 5,
      isNewCreator: false,
    });

    expect(snapshot.recoveryBonus).toBeGreaterThan(0);
    expect(snapshot.score).toBeGreaterThan(75);
    expect(describeCreatorTrustScore(snapshot.score)).toMatch(/Trusted|Stable|New/);
  });
});
