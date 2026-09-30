/**
 * Payout statement reconciliation (#716).
 *
 * Turns indexed purchase/refund events into balanced statement lines plus a
 * summary that satisfies:
 *
 *   grossAmount - platformFee - refunds === netSettlement
 *
 * Settlement status is derived from the on-chain transaction hash and the
 * purchase's dispute state so that pending and failed settlements are clearly
 * represented instead of being silently mixed into the payout total.
 */

export const PLATFORM_FEE_RATE = 0.05;

export type SettlementStatus = "settled" | "pending" | "failed";
export type StatementLineKind = "sale" | "refund";

export interface PayoutStatementLine {
  id: string;
  kind: StatementLineKind;
  saleDate: string;
  promptTitle: string;
  promptId: string;
  buyerAddress: string;
  grossAmount: number;
  platformFee: number;
  creatorAmount: number;
  txHash: string;
  settlementStatus: SettlementStatus;
}

export interface PayoutStatementSummary {
  grossAmount: number;
  platformFee: number;
  refunds: number;
  netSettlement: number;
  settlementStatus: SettlementStatus;
}

export interface ReconciledStatement {
  statement: PayoutStatementLine[];
  summary: PayoutStatementSummary;
  status: SettlementStatus;
  balanced: boolean;
}

export interface PayoutEventSource {
  _id: unknown;
  promptId: string;
  buyerWallet?: string;
  txHash?: string;
  status?: string;
  disputeResolution?: string | null;
  createdAt?: Date | string;
}

export interface PayoutPromptSource {
  _id?: unknown;
  onChainId?: string | null;
  title?: string;
  price?: number;
}

const round4 = (value: number): number => Number(value.toFixed(4));

/** Detect whether a purchase event represents a refunded sale. */
export function isRefund(source: PayoutEventSource): boolean {
  return source.disputeResolution === "refunded";
}

/**
 * Classify the settlement status of a purchase/refund event:
 *  - settled: an on-chain transaction hash exists.
 *  - failed: the event was resolved (or refunded) without landing on-chain.
 *  - pending: an in-flight sale awaiting final settlement/indexing.
 */
export function settlementStatusFor(
  source: PayoutEventSource,
): SettlementStatus {
  if (source.txHash) return "settled";
  if (source.status === "resolved" || source.disputeResolution) return "failed";
  return "pending";
}

/** Build a single statement line from a purchase event and its prompt. */
export function buildStatementLine(
  source: PayoutEventSource,
  prompt: PayoutPromptSource | undefined,
): PayoutStatementLine {
  const refund = isRefund(source);
  const price = typeof prompt?.price === "number" ? prompt.price : 0;
  const direction = refund ? -1 : 1;
  const grossAmount = round4(price * direction);
  const platformFee = round4(grossAmount * PLATFORM_FEE_RATE);
  const creatorAmount = round4(grossAmount - platformFee);

  return {
    id: String(source._id),
    kind: refund ? "refund" : "sale",
    saleDate: source.createdAt
      ? new Date(source.createdAt).toISOString()
      : new Date().toISOString(),
    promptTitle: prompt?.title ?? "Prompt",
    promptId: prompt?.onChainId ?? String(source.promptId),
    buyerAddress: source.buyerWallet ?? "",
    grossAmount,
    platformFee,
    creatorAmount,
    txHash: source.txHash ?? "",
    settlementStatus: settlementStatusFor(source),
  };
}

/**
 * Reconcile purchase/refund events into a balanced statement. Lines carry
 * negative amounts for refunds so the summary stays internally consistent.
 */
export function reconcilePayoutEvents(
  purchases: PayoutEventSource[],
  promptByKey: Map<string, PayoutPromptSource>,
): ReconciledStatement {
  const statement = purchases.map((purchase) =>
    buildStatementLine(purchase, promptByKey.get(String(purchase.promptId))),
  );

  let grossAmount = 0;
  let platformFee = 0;
  let refunds = 0;
  let netSettlement = 0;
  let hasFailed = false;
  let hasPending = false;

  for (const line of statement) {
    const magnitude = line.kind === "refund" ? line.grossAmount * -1 : line.grossAmount;
    if (line.kind === "refund") refunds += magnitude;
    else grossAmount += magnitude;

    platformFee += line.platformFee;
    netSettlement += line.creatorAmount;

    if (line.settlementStatus === "failed") hasFailed = true;
    if (line.settlementStatus === "pending") hasPending = true;
  }

  grossAmount = round4(grossAmount);
  platformFee = round4(platformFee);
  refunds = round4(refunds);
  netSettlement = round4(netSettlement);

  const settlementStatus: SettlementStatus = hasFailed
    ? "failed"
    : hasPending
      ? "pending"
      : "settled";

  const balanced =
    Math.abs(grossAmount - platformFee - refunds - netSettlement) < 0.00001;

  return {
    statement,
    summary: {
      grossAmount,
      platformFee,
      refunds,
      netSettlement,
      settlementStatus,
    },
    status: settlementStatus,
    balanced,
  };
}