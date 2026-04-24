import { type ReactNode } from "react";
import { useContractSync } from "@/hooks/useContractSync";

/**
 * Mounts the background contract-event polling loop once at app level.
 * Must be rendered inside QueryClientProvider.
 */
export function ContractSyncProvider({ children }: { children: ReactNode }) {
  useContractSync();
  return <>{children}</>;
}
