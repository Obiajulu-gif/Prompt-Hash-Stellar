import { LedgerEntry, LedgerEntryType, ILedgerEntry } from "../models/LedgerEntry";

export interface CreateLedgerEntryInput {
  entryType: LedgerEntryType;
  creatorAddress: string;
  promptId?: string;
  amount: number;
  currency?: string;
  stellarTxRef?: string;
  referenceId: string;
  description: string;
  metadata?: Record<string, unknown>;
}

export interface CreatorBalanceSummary {
  creatorAddress: string;
  grossSales: number;
  platformFees: number;
  refunds: number;
  adjustments: number;
  payouts: number;
  netBalance: number;
  entryCount: number;
}

export interface ReconciliationReport {
  creatorAddress: string;
  balanced: boolean;
  status: "balanced" | "mismatch" | "pending_settlement";
  calculatedNetBalance: number;
  stellarConfirmedBalance: number;
  driftAmount: number;
  unsettledEntriesCount: number;
  remediationNotes?: string;
  checkedAt: string;
}

export interface AccountingExportRow {
  entryId: string;
  createdAt: string;
  creatorAddress: string;
  entryType: LedgerEntryType;
  promptId: string;
  amount: number;
  currency: string;
  stellarTxRef: string;
  referenceId: string;
  description: string;
}

const round4 = (val: number): number => Number(val.toFixed(4));

/**
 * Append an immutable ledger entry.
 */
export async function recordLedgerEntry(input: CreateLedgerEntryInput): Promise<ILedgerEntry> {
  const existing = await LedgerEntry.findOne({ referenceId: input.referenceId });
  if (existing) {
    // If settlement reference exists, ensure we do not overwrite or duplicate it
    if (input.stellarTxRef && !existing.stellarTxRef) {
      // Intentionally immutable: throw or preserve reference
      throw new Error(`Ledger entry for referenceId ${input.referenceId} already exists. Settlement references cannot be overwritten.`);
    }
    return existing;
  }

  const entry = new LedgerEntry({
    ...input,
    creatorAddress: input.creatorAddress.toLowerCase(),
    currency: input.currency || "XLM",
    amount: round4(input.amount),
  });

  return await entry.save();
}

/**
 * Recalculate creator ledger balance strictly from immutable entries.
 */
export async function recalculateCreatorBalance(creatorAddress: string): Promise<CreatorBalanceSummary> {
  const normalizedAddress = creatorAddress.toLowerCase();
  const entries = await LedgerEntry.find({ creatorAddress: normalizedAddress }).sort({ createdAt: 1 }).lean();

  let grossSales = 0;
  let platformFees = 0;
  let refunds = 0;
  let adjustments = 0;
  let payouts = 0;

  for (const entry of entries) {
    const amt = round4(entry.amount);
    switch (entry.entryType) {
      case "sale":
        grossSales += amt;
        break;
      case "fee":
        platformFees += Math.abs(amt);
        break;
      case "refund":
        refunds += Math.abs(amt);
        break;
      case "adjustment":
        adjustments += amt;
        break;
      case "payout":
        payouts += Math.abs(amt);
        break;
    }
  }

  grossSales = round4(grossSales);
  platformFees = round4(platformFees);
  refunds = round4(refunds);
  adjustments = round4(adjustments);
  payouts = round4(payouts);

  // Net balance = grossSales - platformFees - refunds + adjustments - payouts
  const netBalance = round4(grossSales - platformFees - refunds + adjustments - payouts);

  return {
    creatorAddress: normalizedAddress,
    grossSales,
    platformFees,
    refunds,
    adjustments,
    payouts,
    netBalance,
    entryCount: entries.length,
  };
}

/**
 * Reconcile ledger state with Stellar transaction references and detect drift.
 */
export async function reconcileCreatorLedger(
  creatorAddress: string,
  stellarTxRecords?: Array<{ txHash: string; amount: number; type: string }>,
): Promise<ReconciliationReport> {
  const normalizedAddress = creatorAddress.toLowerCase();
  const summary = await recalculateCreatorBalance(normalizedAddress);
  const entries = await LedgerEntry.find({ creatorAddress: normalizedAddress }).lean();

  let unsettledCount = 0;
  let stellarConfirmedSum = 0;

  for (const entry of entries) {
    if (!entry.stellarTxRef) {
      unsettledCount++;
    } else {
      // Count settled transactions
      if (entry.entryType === "sale") {
        stellarConfirmedSum += entry.amount - (entry.metadata?.feeAmount as number || 0);
      } else if (entry.entryType === "payout") {
        stellarConfirmedSum -= Math.abs(entry.amount);
      }
    }
  }

  if (stellarTxRecords && stellarTxRecords.length > 0) {
    // If external Stellar records provided, verify match
    const txSum = stellarTxRecords.reduce((acc, tx) => acc + tx.amount, 0);
    stellarConfirmedSum = round4(txSum);
  } else {
    stellarConfirmedSum = round4(stellarConfirmedSum);
  }

  const driftAmount = round4(summary.netBalance - stellarConfirmedSum);
  const isDrift = Math.abs(driftAmount) > 0.0001;

  let status: "balanced" | "mismatch" | "pending_settlement" = "balanced";
  let remediationNotes: string | undefined = undefined;

  if (isDrift) {
    status = "mismatch";
    remediationNotes = `Drift detected: Calculated balance (${summary.netBalance} XLM) differs from Stellar chain record (${stellarConfirmedSum} XLM) by ${driftAmount} XLM. Remediation: Inspect un-indexed Stellar tx references or process pending manual adjustments.`;
  } else if (unsettledCount > 0) {
    status = "pending_settlement";
    remediationNotes = `${unsettledCount} entries await on-chain transaction hash confirmation.`;
  }

  return {
    creatorAddress: normalizedAddress,
    balanced: !isDrift,
    status,
    calculatedNetBalance: summary.netBalance,
    stellarConfirmedBalance: stellarConfirmedSum,
    driftAmount,
    unsettledEntriesCount: unsettledCount,
    remediationNotes,
    checkedAt: new Date().toISOString(),
  };
}

/**
 * Creator payout summary view.
 */
export async function getCreatorPayoutSummaryView(creatorAddress: string) {
  const normalizedAddress = creatorAddress.toLowerCase();
  const summary = await recalculateCreatorBalance(normalizedAddress);
  const entries = await LedgerEntry.find({ creatorAddress: normalizedAddress })
    .sort({ createdAt: -1 })
    .limit(50)
    .lean();
  const reconciliation = await reconcileCreatorLedger(normalizedAddress);

  return {
    summary,
    reconciliation,
    recentEntries: entries.map((e) => ({
      id: String(e._id),
      entryType: e.entryType,
      promptId: e.promptId,
      amount: e.amount,
      currency: e.currency,
      stellarTxRef: e.stellarTxRef || null,
      referenceId: e.referenceId,
      description: e.description,
      createdAt: e.createdAt,
    })),
  };
}

/**
 * Admin payout summary view across creators.
 */
export async function getAdminPayoutSummaryView() {
  const creators = await LedgerEntry.distinct("creatorAddress");
  const reports = [];

  for (const creator of creators) {
    const summary = await recalculateCreatorBalance(creator);
    const reconciliation = await reconcileCreatorLedger(creator);
    reports.push({
      creatorAddress: creator,
      summary,
      reconciliation,
    });
  }

  const mismatches = reports.filter((r) => !r.reconciliation.balanced);

  return {
    totalCreators: creators.length,
    mismatchesCount: mismatches.length,
    creators: reports,
    mismatches,
  };
}

/**
 * Export-ready data shape for accounting review.
 */
export async function exportLedgerReport(creatorAddress?: string): Promise<AccountingExportRow[]> {
  const query = creatorAddress ? { creatorAddress: creatorAddress.toLowerCase() } : {};
  const entries = await LedgerEntry.find(query).sort({ createdAt: 1 }).lean();

  return entries.map((e) => ({
    entryId: String(e._id),
    createdAt: new Date(e.createdAt).toISOString(),
    creatorAddress: e.creatorAddress,
    entryType: e.entryType,
    promptId: e.promptId || "",
    amount: e.amount,
    currency: e.currency,
    stellarTxRef: e.stellarTxRef || "",
    referenceId: e.referenceId,
    description: e.description,
  }));
}
