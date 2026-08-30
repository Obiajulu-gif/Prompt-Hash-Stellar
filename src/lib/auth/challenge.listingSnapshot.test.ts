// @vitest-environment node

import { describe, expect, it } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  createChallengeToken,
  verifyChallengeToken,
  computeListingSnapshotHash,
  type ListingSnapshot,
} from "./challenge";

const SECRET = "unit-test-secret";
const ISSUED_AT = 1_700_000_000_000;
const WITHIN_TTL = ISSUED_AT + 60_000;

function baseSnapshot(): ListingSnapshot {
  return {
    promptId: "42",
    owner: "GABC000000000000000000000000000000000000000000000000000000000000",
    priceStroops: "1000000",
    asset: "CNATIVE0000000000000000000000000000000000000000000000000000000000",
    version: "1",
    expiresAt: "0",
  };
}

describe("listing snapshot hash (#698)", () => {
  it("is deterministic for identical listings", () => {
    const a = computeListingSnapshotHash(baseSnapshot());
    const b = computeListingSnapshotHash(baseSnapshot());
    expect(a).toBe(b);
    expect(a).toMatch(/^[a-f0-9]{64}$/);
  });

  it("changes when any bound field drifts", () => {
    const base = computeListingSnapshotHash(baseSnapshot());
    const changed = (mut: Partial<ListingSnapshot>) =>
      computeListingSnapshotHash({ ...baseSnapshot(), ...mut });

    expect(changed({ owner: "GOTHER00000000000000000000000000000000000000000000000000000000000" })).not.toBe(base);
    expect(changed({ priceStroops: "2000000" })).not.toBe(base);
    expect(changed({ asset: "COTHER00000000000000000000000000000000000000000000000000000000000" })).not.toBe(base);
    expect(changed({ version: "2" })).not.toBe(base);
    expect(changed({ expiresAt: "1700000000" })).not.toBe(base);
  });

  it("binds the listing snapshot hash into the challenge token", () => {
    const address = Keypair.random().publicKey();
    const snapshotHash = computeListingSnapshotHash(baseSnapshot());
    const challenge = createChallengeToken(SECRET, address, "42", ISSUED_AT, 60_000, {
      listingSnapshotHash: snapshotHash,
    });

    expect(() =>
      verifyChallengeToken(SECRET, challenge.token, address, "42", WITHIN_TTL, {
        listingSnapshotHash: snapshotHash,
      }),
    ).not.toThrow();
  });

  it("rejects a stale listing snapshot (price/owner/version drift)", () => {
    const address = Keypair.random().publicKey();
    const signedHash = computeListingSnapshotHash(baseSnapshot());
    const challenge = createChallengeToken(SECRET, address, "42", ISSUED_AT, 60_000, {
      listingSnapshotHash: signedHash,
    });

    const driftedHash = computeListingSnapshotHash({
      ...baseSnapshot(),
      priceStroops: "9999999",
    });

    expect(() =>
      verifyChallengeToken(SECRET, challenge.token, address, "42", WITHIN_TTL, {
        listingSnapshotHash: driftedHash,
      }),
    ).toThrow("Challenge token listing snapshot mismatch.");
  });

  it("does not enforce snapshot binding when no expected hash is supplied", () => {
    const address = Keypair.random().publicKey();
    const signedHash = computeListingSnapshotHash(baseSnapshot());
    const challenge = createChallengeToken(SECRET, address, "42", ISSUED_AT, 60_000, {
      listingSnapshotHash: signedHash,
    });

    expect(() =>
      verifyChallengeToken(SECRET, challenge.token, address, "42", WITHIN_TTL),
    ).not.toThrow();
  });
});
