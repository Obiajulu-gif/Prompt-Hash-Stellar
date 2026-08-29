import { describe, expect, it } from "vitest";
import { evaluateEntitlementQuorum, type EntitlementProviderSample } from "./promptHashClient";

const baseSample = {
  hasAccess: true,
  ledgerSequence: 100,
  ledgerHash: "hash-100",
  ledgerClosedAt: 1_000,
};

function evaluate(samples: EntitlementProviderSample[]) {
  return evaluateEntitlementQuorum(samples, {
    quorum: 2,
    maxLedgerAge: 5,
    networkId: "testnet",
    contractId: "CPROMPT",
    checkedAt: 1_005,
  });
}

describe("entitlement RPC quorum policy", () => {
  it("accepts a matching quorum for a critical authorization read", () => {
    const result = evaluate([
      { ...baseSample, providerUrl: "https://rpc-a.test" },
      { ...baseSample, providerUrl: "https://rpc-b.test" },
    ]);

    expect(result).toMatchObject({
      hasAccess: true,
      ledgerSequence: 100,
      ledgerHash: "hash-100",
      providerCount: 2,
      quorum: 2,
    });
    expect(result.divergenceReason).toBeUndefined();
  });

  it("denies access when providers disagree on ledger identity or result", () => {
    const result = evaluate([
      { ...baseSample, providerUrl: "https://rpc-a.test" },
      {
        ...baseSample,
        providerUrl: "https://rpc-b.test",
        ledgerHash: "forked-hash",
      },
    ]);

    expect(result.hasAccess).toBe(false);
    expect(result.divergenceReason).toBe("provider_divergence");
  });

  it("denies access when the quorum is stale", () => {
    const result = evaluate([
      { ...baseSample, providerUrl: "https://rpc-a.test", ledgerClosedAt: 900 },
      { ...baseSample, providerUrl: "https://rpc-b.test", ledgerClosedAt: 901 },
    ]);

    expect(result.hasAccess).toBe(false);
    expect(result.divergenceReason).toBe("stale_ledger");
  });
});
