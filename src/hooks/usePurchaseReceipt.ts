import { useQuery } from "@tanstack/react-query";
import {
  fetchPurchaseReceipt,
  type SignedPurchaseReceiptData,
} from "@/lib/prompts/entitlementReceipt";

/**
 * Loads the signed purchase receipt for a prompt/buyer pair — Issue #490.
 *
 * `data.receiptStatus === "pending"` means the transaction reference/event
 * is not indexed yet; `data.entitlement.status` independently reports whether
 * current on-chain access is verified. `isError` is a failure talking to the
 * receipt endpoint.
 */
export function usePurchaseReceipt(
  promptId: string,
  buyerWallet: string | undefined,
) {
  return useQuery<SignedPurchaseReceiptData | null>({
    queryKey: ["purchase-receipt", promptId, buyerWallet],
    queryFn: () => fetchPurchaseReceipt(promptId, buyerWallet as string),
    enabled: Boolean(promptId && buyerWallet),
    retry: false,
    staleTime: 30_000,
  });
}
