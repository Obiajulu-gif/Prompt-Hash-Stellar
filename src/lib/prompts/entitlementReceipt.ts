/**
 * Purchase receipt client for the buyer entitlement panel — Issue #490.
 *
 * Wraps the existing `GET /api/prompts/receipt` endpoint (built for Issue
 * #436's independently-verifiable receipts, see `api/prompts/receipt.ts` and
 * `src/lib/stellar/receipts.ts`). That endpoint returns a `SignedReceipt`
 * shaped exactly like `packages/sdk/src/types.ts`'s `PurchaseReceipt` /
 * `SignedPurchaseReceipt` — this file mirrors those shapes locally rather
 * than importing them, because `packages/sdk` is a standalone publishable
 * package that isn't wired into this app's tsconfig project references or
 * listed as a workspace dependency (see root `tsconfig.json`, which
 * explicitly excludes `packages`).
 *
 * The response carries a separate current-ledger entitlement verdict. A
 * pending receipt reference is not itself proof of access; callers must use
 * the entitlement status before presenting a purchase as current.
 */

export interface PurchaseReceiptData {
  version: number;
  prompt: {
    id: string;
    /** Licence/content revision at the time of purchase. */
    revision: number;
  };
  buyer: string;
  transaction: {
    hash: string;
    ledger: number;
    createdAt: string;
  };
  amount: {
    stroops: string;
  };
  issuedAt: string;
}

export interface SignedPurchaseReceiptData {
  receipt: PurchaseReceiptData | null;
  signature?: string;
  signerPublicKey?: string;
  receiptStatus: "ready" | "pending";
  entitlement: {
    status: "verified" | "not_entitled" | "unverifiable";
    ledgerSequence?: number;
    ledgerHash?: string;
    networkId?: string;
    contractId?: string;
    checkedAt: number;
    reason?: string;
  };
  purchaseStatus?: string;
  disputeResolution?: string | null;
}

/**
 * Fetches the signed purchase receipt for a prompt/buyer pair.
 *
 * Returns `null` only for a legacy not-indexed 404. Current API responses
 * include an explicit pending receipt state and verified entitlement status.
 * Throws for any other non-OK response (misconfiguration, server error).
 */
export async function fetchPurchaseReceipt(
  promptId: string,
  buyerWallet: string,
): Promise<SignedPurchaseReceiptData | null> {
  const params = new URLSearchParams({ promptId, buyerWallet });
  const response = await fetch(`/api/prompts/receipt?${params.toString()}`);

  if (response.status === 404) {
    return null;
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;
    throw new Error(payload?.error || "Failed to load purchase receipt.");
  }

  return (await response.json()) as SignedPurchaseReceiptData;
}
