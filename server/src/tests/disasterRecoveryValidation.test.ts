import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { disasterRecoveryValidationService } from "../services/disasterRecoveryValidation.js";
import Prompt from "../models/Prompt.js";
import Purchase from "../models/Purchase.js";
import { Entitlement } from "../models/Entitlement.js";
import { LedgerEntry } from "../models/LedgerEntry.js";
import { Bundle } from "../models/Bundle.js";
import Review from "../models/Review.js";
import { IndexerState } from "../models/IndexerState.js";


describe("DisasterRecoveryValidationService (Issue #816)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes validation when all records and relations are clean and valid", async () => {
    vi.spyOn(Prompt, "find").mockReturnValue({
      lean: async () => [
        { _id: "prompt-1", onChainId: "1", title: "Valid Prompt", creatorAddress: "GCREATOR1", price: 10 },
      ],
    } as any);

    vi.spyOn(Purchase, "find").mockReturnValue({
      lean: async () => [
        { _id: "purch-1", promptId: "prompt-1", buyerWallet: "GBUYER1", txHash: "tx_hash_1" },
      ],
    } as any);

    vi.spyOn(Entitlement, "find").mockReturnValue({
      lean: async () => [
        { _id: "ent-1", promptId: "prompt-1", buyerAddress: "GBUYER1" },
      ],
    } as any);

    vi.spyOn(LedgerEntry, "find").mockReturnValue({
      lean: async () => [
        { _id: "entry-1", creatorAddress: "GCREATOR1", amount: 9.5 },
      ],
    } as any);

    vi.spyOn(Bundle, "find").mockReturnValue({
      lean: async () => [
        { _id: "bundle-1", promptIds: ["prompt-1"], bundlePrice: 8 },
      ],
    } as any);

    vi.spyOn(IndexerState, "find").mockReturnValue({
      lean: async () => [{ key: "prompt_hash_contract", lastIndexedLedger: 5000 }],
    } as any);

    vi.spyOn(Review, "find").mockReturnValue({
      lean: async () => [{ _id: "rev-1", promptId: "prompt-1", rating: 5 }],
    } as any);

    const report = await disasterRecoveryValidationService.validateAllInvariants();

    expect(report.passed).toBe(true);
    expect(report.criticalViolationsCount).toBe(0);
    expect(report.highViolationsCount).toBe(0);
    expect(report.totalViolations).toBe(0);
  });

  it("detects invalid prompt records with empty title or missing creator", async () => {
    vi.spyOn(Prompt, "find").mockReturnValue({
      lean: async () => [
        { _id: "p-broken-1", title: "", creatorAddress: "GCREATOR", price: 10 },
        { _id: "p-broken-2", title: "No Creator", creatorAddress: "", price: 5 },
        { _id: "p-broken-3", title: "Negative Price", creatorAddress: "GCREATOR", price: -15 },
      ],
    } as any);

    const result = await disasterRecoveryValidationService.validatePromptIntegrity();

    expect(result.passed).toBe(false);
    expect(result.violationCount).toBe(3);
    expect(result.violations[0].severity).toBe("CRITICAL");
    expect(result.violations[1].severity).toBe("CRITICAL");
    expect(result.violations[2].severity).toBe("HIGH");
  });

  it("detects orphaned purchases and entitlements referencing missing prompts", async () => {
    vi.spyOn(Prompt, "find").mockReturnValue({
      lean: async () => [{ _id: "prompt-100", onChainId: "100" }],
    } as any);

    vi.spyOn(Purchase, "find").mockReturnValue({
      lean: async () => [
        { _id: "purch-orphan", promptId: "prompt-999-missing", buyerWallet: "GBUYER" },
      ],
    } as any);

    vi.spyOn(Entitlement, "find").mockReturnValue({
      lean: async () => [
        { _id: "ent-orphan", promptId: "prompt-888-missing", buyerAddress: "GBUYER" },
      ],
    } as any);

    const result = await disasterRecoveryValidationService.validatePurchaseAndEntitlementRefs();

    expect(result.passed).toBe(false);
    expect(result.violationCount).toBe(2);
    expect(result.violations[0].message).toContain("prompt-999-missing");
    expect(result.violations[1].message).toContain("prompt-888-missing");
  });

  it("detects duplicate on-chain transaction hashes across purchases", async () => {
    vi.spyOn(Purchase, "find").mockReturnValue({
      lean: async () => [
        { _id: "purch-1", txHash: "shared_tx_hash_123" },
        { _id: "purch-2", txHash: "shared_tx_hash_123" },
      ],
    } as any);

    const result = await disasterRecoveryValidationService.validateTransactionUniqueness();

    expect(result.passed).toBe(false);
    expect(result.violationCount).toBe(1);
    expect(result.violations[0].severity).toBe("CRITICAL");
    expect(result.violations[0].message).toContain("Duplicate on-chain transaction hash");
  });

  it("detects bundle invariant violations", async () => {
    vi.spyOn(Bundle, "find").mockReturnValue({
      lean: async () => [
        { _id: "b-empty", promptIds: [], bundlePrice: 50 },
        { _id: "b-neg", promptIds: ["prompt-1"], bundlePrice: -10 },
      ],
    } as any);

    const result = await disasterRecoveryValidationService.validateBundleComposition();

    expect(result.passed).toBe(false);
    expect(result.violationCount).toBe(2);
  });
});
