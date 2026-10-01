import { describe, expect, it, beforeEach, vi } from "vitest";

// Mock Mongoose model for isolated unit testing
const mockEntries: any[] = [];

vi.mock("../models/LedgerEntry", () => {
  const MockLedgerEntryClass: any = function (data: any) {
    this._id = `entry_${Date.now()}_${Math.random()}`;
    this.entryType = data.entryType;
    this.creatorAddress = data.creatorAddress.toLowerCase();
    this.promptId = data.promptId;
    this.amount = data.amount;
    this.currency = data.currency || "XLM";
    this.stellarTxRef = data.stellarTxRef;
    this.referenceId = data.referenceId;
    this.description = data.description;
    this.metadata = data.metadata || {};
    this.reconciled = data.reconciled || false;
    this.createdAt = new Date();

    this.save = async () => {
      mockEntries.push(this);
      return this;
    };
  };

  MockLedgerEntryClass.findOne = async (query: any) => {
    return mockEntries.find((e) => {
      if (query.referenceId) return e.referenceId === query.referenceId;
      return false;
    }) || null;
  };

  MockLedgerEntryClass.find = (query: any) => {
    let result = [...mockEntries];
    if (query.creatorAddress) {
      result = result.filter((e) => e.creatorAddress === query.creatorAddress.toLowerCase());
    }
    return {
      sort: () => ({
        limit: () => ({
          lean: async () => result,
        }),
        lean: async () => result,
      }),
      lean: async () => result,
    };
  };

  MockLedgerEntryClass.distinct = async (field: string) => {
    if (field === "creatorAddress") {
      return Array.from(new Set(mockEntries.map((e) => e.creatorAddress)));
    }
    return [];
  };

  return {
    LedgerEntry: MockLedgerEntryClass,
  };
});

import {
  recordLedgerEntry,
  recalculateCreatorBalance,
  reconcileCreatorLedger,
  getCreatorPayoutSummaryView,
  getAdminPayoutSummaryView,
  exportLedgerReport,
} from "../services/payoutLedgerService";

describe("Payout Ledger & Stellar Settlement Reconciliation (#Task2)", () => {
  beforeEach(() => {
    mockEntries.length = 0;
  });

  it("creates immutable append-only ledger entries for sale, fee, refund, adjustment, and payout", async () => {
    const creator = "GCREATOR1234567890";

    await recordLedgerEntry({
      entryType: "sale",
      creatorAddress: creator,
      promptId: "prompt_1",
      amount: 100, // 100 XLM sale
      referenceId: "ref_sale_1",
      description: "Prompt sale #1",
      stellarTxRef: "tx_hash_1",
    });

    await recordLedgerEntry({
      entryType: "fee",
      creatorAddress: creator,
      promptId: "prompt_1",
      amount: -5, // 5 XLM platform fee
      referenceId: "ref_fee_1",
      description: "Platform fee 5%",
      stellarTxRef: "tx_hash_1",
    });

    await recordLedgerEntry({
      entryType: "refund",
      creatorAddress: creator,
      promptId: "prompt_1",
      amount: -20, // 20 XLM refund
      referenceId: "ref_refund_1",
      description: "Partial refund",
      stellarTxRef: "tx_hash_refund_1",
    });

    await recordLedgerEntry({
      entryType: "adjustment",
      creatorAddress: creator,
      amount: 10, // 10 XLM bonus adjustment
      referenceId: "ref_adj_1",
      description: "Creator bonus",
    });

    await recordLedgerEntry({
      entryType: "payout",
      creatorAddress: creator,
      amount: -30, // 30 XLM payout settlement
      referenceId: "ref_payout_1",
      description: "Payout to bank",
      stellarTxRef: "tx_hash_payout_1",
    });

    expect(mockEntries.length).toBe(5);
  });

  it("recalculates creator balance strictly from immutable entries", async () => {
    const creator = "GCREATOR1234567890";

    await recordLedgerEntry({
      entryType: "sale",
      creatorAddress: creator,
      amount: 100,
      referenceId: "sale_1",
      description: "Sale 1",
    });

    await recordLedgerEntry({
      entryType: "fee",
      creatorAddress: creator,
      amount: 5,
      referenceId: "fee_1",
      description: "Fee 1",
    });

    await recordLedgerEntry({
      entryType: "refund",
      creatorAddress: creator,
      amount: 15,
      referenceId: "refund_1",
      description: "Refund 1",
    });

    await recordLedgerEntry({
      entryType: "payout",
      creatorAddress: creator,
      amount: 40,
      referenceId: "payout_1",
      description: "Payout 1",
    });

    const summary = await recalculateCreatorBalance(creator);

    expect(summary.grossSales).toBe(100);
    expect(summary.platformFees).toBe(5);
    expect(summary.refunds).toBe(15);
    expect(summary.payouts).toBe(40);
    // Net balance = 100 - 5 - 15 - 40 = 40
    expect(summary.netBalance).toBe(40);
    expect(summary.entryCount).toBe(4);
  });

  it("detects reconciliation drift between ledger and Stellar chain records", async () => {
    const creator = "GCREATOR_DRIFT";

    await recordLedgerEntry({
      entryType: "sale",
      creatorAddress: creator,
      amount: 100,
      referenceId: "s1",
      description: "Sale",
      stellarTxRef: "tx1",
    });

    // Case 1: Matching Stellar on-chain records (no drift)
    const reportMatch = await reconcileCreatorLedger(creator, [
      { txHash: "tx1", amount: 100, type: "sale" },
    ]);
    expect(reportMatch.balanced).toBe(true);
    expect(reportMatch.status).toBe("balanced");
    expect(reportMatch.driftAmount).toBe(0);

    // Case 2: Mismatched on-chain record (reconciliation drift detected)
    const reportDrift = await reconcileCreatorLedger(creator, [
      { txHash: "tx1", amount: 80, type: "sale" }, // 80 on-chain vs 100 calculated
    ]);
    expect(reportDrift.balanced).toBe(false);
    expect(reportDrift.status).toBe("mismatch");
    expect(reportDrift.driftAmount).toBe(20);
    expect(reportDrift.remediationNotes).toContain("Drift detected");
  });

  it("provides export-ready data shape for accounting review", async () => {
    const creator = "GCREATOR_EXPORT";

    await recordLedgerEntry({
      entryType: "sale",
      creatorAddress: creator,
      promptId: "p123",
      amount: 50,
      referenceId: "ref_exp_1",
      description: "Export test sale",
      stellarTxRef: "tx_exp_1",
    });

    const rows = await exportLedgerReport(creator);
    expect(rows.length).toBe(1);
    expect(rows[0]).toMatchObject({
      creatorAddress: creator.toLowerCase(),
      entryType: "sale",
      promptId: "p123",
      amount: 50,
      currency: "XLM",
      stellarTxRef: "tx_exp_1",
      referenceId: "ref_exp_1",
    });
  });

  it("generates creator and admin payout summary views", async () => {
    const creator = "GCREATOR_VIEWS";
    await recordLedgerEntry({
      entryType: "sale",
      creatorAddress: creator,
      amount: 200,
      referenceId: "view_s1",
      description: "View sale",
    });

    const creatorView = await getCreatorPayoutSummaryView(creator);
    expect(creatorView.summary.grossSales).toBe(200);
    expect(creatorView.recentEntries.length).toBe(1);

    const adminView = await getAdminPayoutSummaryView();
    expect(adminView.totalCreators).toBeGreaterThanOrEqual(1);
    expect(adminView.creators.some((c) => c.creatorAddress === creator.toLowerCase())).toBe(true);
  });
});
