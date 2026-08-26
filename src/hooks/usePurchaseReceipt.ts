import { useQuery } from "@tanstack/react-query";
import {
  fetchPurchaseReceipt,
  type SignedPurchaseReceiptData,
} from "@/lib/prompts/entitlementReceipt";

/**
 * Loads the signed purchase receipt for a prompt/buyer pair — Issue #490.
 *
 * `data === null` (query succeeded) means "no purchase indexed yet" (pending
 * indexing), which is distinct from `isError` (a real failure talking to the
 * receipt endpoint). Callers should branch on both.
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
