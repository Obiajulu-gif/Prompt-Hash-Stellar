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
 * A 404 from this endpoint means the backend has no indexed `Purchase`
 * record with a transaction hash for this buyer/prompt yet — which, for a
 * prompt that already appears in the buyer's on-chain library, reads as
 * "purchase confirmed on-chain, off-chain indexing still catching up"
 * rather than "never purchased". The entitlement panel treats that as its
 * distinct "pending" state instead of a hard failure.
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
  receipt: PurchaseReceiptData;
  signature: string;
  signerPublicKey: string;
  purchaseStatus?: string;
  disputeResolution?: string | null;
}

/**
 * Fetches the signed purchase receipt for a prompt/buyer pair.
 *
 * Returns `null` when the backend explicitly reports "not indexed yet" (404)
 * — callers should treat that as a pending-indexing signal, not an error.
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
