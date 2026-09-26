export interface PurchaseTransaction {
  id: string;
  promptId: string;
  promptTitle: string;
  promptImage: string;
  /** Amount paid in XLM, or null when the listing price is unknown. */
  amountXlm: number | null;
  versionIndex: number | null;
  txHash: string;
  /** ISO timestamp of the purchase. */
  createdAt: string;
}

interface PurchaseTransactionApiResponse {
  id?: string;
  promptId?: string;
  promptTitle?: string;
  promptImage?: string;
  amountXlm?: number | null;
  versionIndex?: number | null;
  txHash?: string;
  createdAt?: string;
}

const toPurchaseTransaction = (
  record: PurchaseTransactionApiResponse,
  index: number,
): PurchaseTransaction => ({
  id: String(record.id ?? `${record.txHash ?? "tx"}-${index}`),
  promptId: String(record.promptId ?? ""),
  promptTitle: record.promptTitle ?? "Prompt",
  promptImage: record.promptImage ?? "",
  amountXlm:
    typeof record.amountXlm === "number" ? record.amountXlm : null,
  versionIndex:
    typeof record.versionIndex === "number" ? record.versionIndex : null,
  txHash: record.txHash ?? "",
  createdAt: record.createdAt ?? new Date(0).toISOString(),
});

/**
 * Fetches the connected wallet's licensing/purchase transaction history from
 * the off-chain indexer API. Each record links a prompt to the amount paid,
 * the Stellar transaction hash, and the purchase date.
 */
export async function fetchPurchaseTransactions(
  walletAddress: string,
): Promise<PurchaseTransaction[]> {
  const response = await fetch(
    `/api/prompts/buyer/${encodeURIComponent(walletAddress)}/transactions`,
  );

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      payload && typeof payload === "object" && "error" in payload
        ? String((payload as { error?: unknown }).error ?? "Request failed")
        : "Failed to load transaction history";
    throw new Error(message);
  }

  const transactions = (payload as { transactions?: PurchaseTransactionApiResponse[] })
    ?.transactions;
  return (transactions ?? []).map(toPurchaseTransaction);
}
