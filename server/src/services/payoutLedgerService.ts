import { LedgerEntry, LedgerEntryType, ILedgerEntry } from "../models/LedgerEntry";
import { DomainInvariantsService } from "./domainInvariants";

/**
 * Upper bound on rows materialised by a single ledger export or balance scan
 * (#983). `GET /api/payouts/admin/export` with no `creatorAddress` used to
 * `find()` the ENTIRE collection into memory before serialising it, so a
 * high-cardinality ledger could OOM the process on one admin request. Callers
 * needing the full history should page by date range rather than widening this.
 */
export const LEDGER_SCAN_MAX_ENTRIES = 50_000;

/** Clamp a caller/page-derived scan size into `(0, LEDGER_SCAN_MAX_ENTRIES]`. */
export function clampLedgerScanSize(limit: number | undefined): number {
  const n = Number(limit);
  if (!Number.isFinite(n) || n < 1) return LEDGER_SCAN_MAX_ENTRIES;
  return Math.min(Math.floor(n), LEDGER_SCAN_MAX_ENTRIES);
}

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

function canonicalLedgerAmount(
  entryType: LedgerEntryType,
  amount: number,
): number {
  if (!Number.isFinite(amount)) {
    DomainInvariantsService.requireInvariant(
      DomainInvariantsService.assertLedgerBalanceEntry(entryType, amount),
    );
  }

  if (entryType === "sale" && amount < 0) {
    DomainInvariantsService.requireInvariant(
      DomainInvariantsService.assertLedgerBalanceEntry(entryType, amount),
    );
  }

  const canonicalAmount =
    entryType === "fee" || entryType === "refund" || entryType === "payout"
      ? -Math.abs(amount)
      : amount;
  DomainInvariantsService.requireInvariant(
    DomainInvariantsService.assertLedgerBalanceEntry(entryType, canonicalAmount),
  );
  return round4(canonicalAmount);
}

/**
 * Append an immutable ledger entry.
 */
export async function recordLedgerEntry(input: CreateLedgerEntryInput): Promise<ILedgerEntry> {
  const amount = canonicalLedgerAmount(input.entryType, input.amount);

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
    amount,
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
 *
 * `precomputedSummary` lets a caller that already ran `recalculateCreatorBalance`
 * for this creator avoid a second full scan of their entries — the admin
 * summary view computes both back to back, so without it every creator costs
 * an extra unbounded `find()` (#983). Omitting it preserves the original
 * behaviour exactly.
 */
export async function reconcileCreatorLedger(
  creatorAddress: string,
  stellarTxRecords?: Array<{ txHash: string; amount: number; type: string }>,
  precomputedSummary?: CreatorBalanceSummary,
): Promise<ReconciliationReport> {
  const normalizedAddress = creatorAddress.toLowerCase();
  const summary = precomputedSummary ?? await recalculateCreatorBalance(normalizedAddress);
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
 *
 * Per creator this runs exactly two entry scans — one for the balance summary,
 * one for reconciliation — instead of the three it used to run (the
 * reconciliation path recomputed a summary that had just been computed). The
 * ceiling is 2N+1 model calls for N creators and is enforced by
 * `server/src/tests/resourceBudget.test.ts` (#983).
 */
export async function getAdminPayoutSummaryView() {
  const creators = await LedgerEntry.distinct("creatorAddress");
  const reports = [];

  for (const creator of creators) {
    const summary = await recalculateCreatorBalance(creator);
    const reconciliation = await reconcileCreatorLedger(creator, undefined, summary);
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
 *
 * `exportLedgerReport` keeps its original signature (returns rows only). The
 * bounded variant additionally reports whether the scan hit
 * `LEDGER_SCAN_MAX_ENTRIES`, so callers can surface truncation instead of
 * silently handing accounting an incomplete file (#983).
 */
export async function exportLedgerReport(creatorAddress?: string): Promise<AccountingExportRow[]> {
  const { rows } = await exportLedgerReportBounded(creatorAddress);
  return rows;
}

export interface BoundedLedgerExport {
  rows: AccountingExportRow[];
  /** True when the scan stopped at the ceiling and older rows were omitted. */
  truncated: boolean;
  /** The ceiling that was applied to this scan. */
  scanLimit: number;
}

export async function exportLedgerReportBounded(
  creatorAddress?: string,
  scanLimit: number = LEDGER_SCAN_MAX_ENTRIES,
): Promise<BoundedLedgerExport> {
  const query = creatorAddress ? { creatorAddress: creatorAddress.toLowerCase() } : {};
  const limit = clampLedgerScanSize(scanLimit);

  // Read one extra row purely to detect truncation without a second count query.
  const entries = await LedgerEntry.find(query)
    .sort({ createdAt: 1 })
    .limit(limit + 1)
    .lean();
  const truncated = entries.length > limit;
  const page = truncated ? entries.slice(0, limit) : entries;

  return {
    truncated,
    scanLimit: limit,
    rows: page.map((e) => ({
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
    })),
  };
}
