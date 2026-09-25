import { describe, expect, it, beforeEach, vi } from "vitest";

const mockEntitlements: any[] = [];
const mockPurchases: any[] = [];

vi.mock("../models/Entitlement", () => {
  const MockEntitlementClass: any = function (data: any) {
    this._id = `ent_${Date.now()}_${Math.random()}`;
    this.userAddress = data.userAddress.toLowerCase();
    this.promptId = String(data.promptId);
    this.status = data.status || "active";
    this.grantedAt = data.grantedAt || new Date();
    this.sourceOfTruthRef = data.sourceOfTruthRef;
    this.createdAt = new Date();
    this.updatedAt = new Date();
  };

  MockEntitlementClass.findOne = async (query: any) => {
    return mockEntitlements.find(
      (e) =>
        e.userAddress === query.userAddress?.toLowerCase() &&
        String(e.promptId) === String(query.promptId),
    ) || null;
  };

  MockEntitlementClass.create = async (data: any) => {
    const inst = new MockEntitlementClass(data);
    mockEntitlements.push(inst);
    return inst;
  };

  MockEntitlementClass.findOneAndUpdate = async (query: any, update: any, options: any) => {
    let existing = await MockEntitlementClass.findOne(query);
    if (!existing && options?.upsert) {
      existing = new MockEntitlementClass({
        userAddress: query.userAddress,
        promptId: query.promptId,
        ...update,
      });
      mockEntitlements.push(existing);
      return existing;
    }
    if (existing) {
      if (update.status) existing.status = update.status;
      if (update.revokedAt) existing.revokedAt = update.revokedAt;
      if (update.revocationReason) existing.revocationReason = update.revocationReason;
      existing.updatedAt = new Date();
    }
    return existing;
  };

  return {
    Entitlement: MockEntitlementClass,
  };
});

vi.mock("../models/Purchase", () => {
  return {
    default: {
      findOne: async (query: any) => {
        return mockPurchases.find(
          (p) =>
            p.buyerWallet === query.buyerWallet?.toLowerCase() &&
            String(p.promptId) === String(query.promptId),
        ) || null;
      },
      find: () => ({
        lean: async () => mockPurchases,
      }),
    },
  };
});

import {
  getEntitlementState,
  grantEntitlement,
  revokeEntitlement,
  repairEntitlementState,
} from "../services/entitlementService";

describe("Entitlement Caching & Revocation Rules (#Task3)", () => {
  beforeEach(() => {
    mockEntitlements.length = 0;
    mockPurchases.length = 0;
  });

  it("handles cache miss by looking up Purchase record and populating entitlement cache", async () => {
    const buyer = "GBUYER1234567890";
    const promptId = "101";

    // Simulate existing purchase record
    mockPurchases.push({
      _id: "purch_1",
      buyerWallet: buyer.toLowerCase(),
      promptId: "101",
      txHash: "tx_hash_101",
      status: "completed",
    });

    // 1st call: Cache miss
    const res1 = await getEntitlementState(buyer, promptId);
    expect(res1.hasAccess).toBe(true);
    expect(res1.status).toBe("active");
    expect(res1.cacheHit).toBe(false);
    expect(mockEntitlements.length).toBe(1);

    // 2nd call: Cache hit
    const res2 = await getEntitlementState(buyer, promptId);
    expect(res2.hasAccess).toBe(true);
    expect(res2.status).toBe("active");
    expect(res2.cacheHit).toBe(true);
  });

  it("revokes entitlement reliably on refund or moderator action", async () => {
    const buyer = "GBUYER1234567890";
    const promptId = "102";

    // Grant initial active entitlement
    await grantEntitlement(buyer, promptId, "tx_102");

    const beforeRevoke = await getEntitlementState(buyer, promptId);
    expect(beforeRevoke.hasAccess).toBe(true);

    // Perform revocation
    await revokeEntitlement(buyer, promptId, "Purchase refunded by buyer request", "refunded");

    const afterRevoke = await getEntitlementState(buyer, promptId);
    expect(afterRevoke.hasAccess).toBe(false);
    expect(afterRevoke.status).toBe("refunded");
    expect(afterRevoke.revocationReason).toBe("Purchase refunded by buyer request");
  });

  it("executes idempotent repair job to align entitlements with purchase records", async () => {
    // Setup state:
    // Purchase 1: Active purchase missing from entitlement cache -> repair should grant
    mockPurchases.push({
      _id: "p1",
      buyerWallet: "gbuyer_1",
      promptId: "201",
      txHash: "tx_201",
      status: "completed",
    });

    // Purchase 2: Refunded purchase with active entitlement in cache -> repair should revoke
    mockPurchases.push({
      _id: "p2",
      buyerWallet: "gbuyer_2",
      promptId: "202",
      txHash: "tx_202",
      status: "refunded",
      disputeResolution: "refunded",
    });
    mockEntitlements.push({
      userAddress: "gbuyer_2",
      promptId: "202",
      status: "active",
      sourceOfTruthRef: "tx_202",
    });

    // 1st repair run
    const report1 = await repairEntitlementState();
    expect(report1.checkedPurchases).toBe(2);
    expect(report1.grantedCount).toBe(1);
    expect(report1.revokedCount).toBe(1);

    // 2nd repair run (idempotency check — no changes)
    const report2 = await repairEntitlementState();
    expect(report2.checkedPurchases).toBe(2);
    expect(report2.grantedCount).toBe(0);
    expect(report2.revokedCount).toBe(0);
    expect(report2.unchangedCount).toBe(2);
  });
});
