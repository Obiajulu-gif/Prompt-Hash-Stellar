import { describe, expect, it, beforeEach, vi } from "vitest";

const mockBundles: any[] = [];
const mockBundlePurchases: any[] = [];
const mockPrompts: any[] = [
  { _id: "p1", onChainId: "p1", title: "Prompt 1", price: 10, status: "active", active: true, contentHash: "hash1" },
  { _id: "p2", onChainId: "p2", title: "Prompt 2", price: 20, status: "active", active: true, contentHash: "hash2" },
  { _id: "p_hidden", onChainId: "p_hidden", title: "Hidden Prompt", price: 15, status: "hidden", active: false, contentHash: "hash_h" },
];

vi.mock("../models/Prompt", () => ({
  default: {
    findOne: async (query: any) => {
      const pid = query.$or?.[0]?._id || query.$or?.[1]?.onChainId || query.$or?.[2]?.id;
      return mockPrompts.find((p) => p._id === pid || p.onChainId === pid) || null;
    },
  },
}));

vi.mock("../models/Bundle", () => {
  const MockBundleClass: any = function (data: any) {
    this._id = `bundle_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    this.title = data.title;
    this.description = data.description;
    this.creatorAddress = data.creatorAddress;
    this.promptIds = data.promptIds;
    this.bundlePrice = data.bundlePrice;
    this.status = data.status || "active";
    this.snapshots = data.snapshots;
    this.createdAt = new Date();
    this.save = async () => {
      mockBundles.push(this);
      return this;
    };
  };

  MockBundleClass.findById = async (id: string) => {
    return mockBundles.find((b) => String(b._id) === String(id)) || null;
  };

  return {
    Bundle: MockBundleClass,
  };
});

vi.mock("../models/BundlePurchase", () => {
  const MockPurchaseClass: any = function (data: any) {
    this._id = `bp_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
    this.buyerAddress = data.buyerAddress;
    this.bundleId = data.bundleId;
    this.bundlePricePaid = data.bundlePricePaid;
    this.txHash = data.txHash;
    this.promptSnapshot = data.promptSnapshot;
    this.entitlements = data.entitlements;
    this.recoveryStatus = data.recoveryStatus || "complete";
    this.createdAt = new Date();
    this.save = async () => {
      const idx = mockBundlePurchases.findIndex((p) => String(p._id) === String(this._id));
      if (idx >= 0) {
        mockBundlePurchases[idx] = this;
      } else {
        mockBundlePurchases.push(this);
      }
      return this;
    };
  };

  MockPurchaseClass.findOne = async (query: any) => {
    return mockBundlePurchases.find((p) => p.txHash === query.txHash) || null;
  };

  MockPurchaseClass.findById = async (id: string) => {
    return mockBundlePurchases.find((p) => String(p._id) === String(id)) || null;
  };

  return {
    BundlePurchase: MockPurchaseClass,
  };
});

vi.mock("../services/entitlementService", () => ({
  grantEntitlement: vi.fn(async (buyer: string, promptId: string, txHash: string) => {
    return { _id: `ent_${promptId}`, userAddress: buyer, promptId, status: "active" };
  }),
}));

vi.mock("../services/payoutLedgerService", () => ({
  recordLedgerEntry: vi.fn().mockResolvedValue({}),
}));

import {
  createBundle,
  purchaseBundle,
  recoverPartialBundleUnlock,
} from "../services/bundleService";

describe("Prompt Bundles & Atomic Purchase Recovery (#Task4)", () => {
  beforeEach(() => {
    mockBundles.length = 0;
    mockBundlePurchases.length = 0;
    vi.clearAllMocks();
  });

  it("creates prompt bundle with snapshots of included prompt listings", async () => {
    const bundle = await createBundle({
      title: "AI Starter Pack",
      description: "Top 2 prompts",
      creatorAddress: "GCREATOR_BUNDLE",
      promptIds: ["p1", "p2"],
      discountPercent: 10, // 10% off (30 - 3 = 27 XLM)
    });

    expect(bundle.title).toBe("AI Starter Pack");
    expect(bundle.promptIds).toEqual(["p1", "p2"]);
    expect(bundle.bundlePrice).toBe(27);
    expect(bundle.snapshots.length).toBe(2);
    expect(bundle.snapshots[0]).toMatchObject({ promptId: "p1", price: 10 });
    expect(bundle.snapshots[1]).toMatchObject({ promptId: "p2", price: 20 });
  });

  it("prevents hidden or deleted prompts from being newly bundled", async () => {
    await expect(
      createBundle({
        title: "Bad Bundle",
        creatorAddress: "GCREATOR_BUNDLE",
        promptIds: ["p1", "p_hidden"],
      }),
    ).rejects.toThrow("Listing is hidden, deleted, or inactive.");
  });

  it("creates entitlements for all prompts on bundle purchase", async () => {
    const bundle = await createBundle({
      title: "Bundle 1",
      creatorAddress: "GCREATOR1",
      promptIds: ["p1", "p2"],
      bundlePrice: 25,
    });

    const purchase = await purchaseBundle({
      buyerAddress: "GBUYER1",
      bundleId: String(bundle._id),
      txHash: "tx_bundle_1",
    });

    expect(purchase.recoveryStatus).toBe("complete");
    expect(purchase.entitlements.length).toBe(2);
    expect(purchase.entitlements.every((e) => e.status === "granted")).toBe(true);
  });

  it("tracks partial unlock failures and recovers without double-charging buyers", async () => {
    const bundle = await createBundle({
      title: "Bundle 2",
      creatorAddress: "GCREATOR1",
      promptIds: ["p1", "p2"],
      bundlePrice: 25,
    });

    // Simulate partial unlock failure for prompt 'p2'
    const purchase = await purchaseBundle({
      buyerAddress: "GBUYER1",
      bundleId: String(bundle._id),
      txHash: "tx_bundle_2",
      simulatePartialFailurePromptIds: ["p2"],
    });

    expect(purchase.recoveryStatus).toBe("partial_failure");
    expect(purchase.entitlements.find((e) => e.promptId === "p1")?.status).toBe("granted");
    expect(purchase.entitlements.find((e) => e.promptId === "p2")?.status).toBe("failed");

    // Recover partial unlock failure
    const recovered = await recoverPartialBundleUnlock("GBUYER1", String(purchase._id));

    expect(recovered.recoveryStatus).toBe("recovered");
    expect(recovered.entitlements.find((e) => e.promptId === "p2")?.status).toBe("granted");
    expect(recovered.bundlePricePaid).toBe(25); // No extra charge
  });
});
