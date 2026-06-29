import { stellarNetwork } from "@/lib/env";

const EXPLORER_BASE = "https://stellar.expert/explorer";

/**
 * Maps the configured Stellar network to a Stellar Expert path segment.
 * Stellar Expert only hosts `public` and `testnet`; non-public networks
 * (testnet/futurenet/local) fall back to `testnet`.
 */
function explorerNetwork(): "public" | "testnet" {
  return stellarNetwork === "PUBLIC" ? "public" : "testnet";
}

/** Builds a Stellar Expert link for a transaction hash. */
export function stellarExpertTxUrl(txHash: string): string {
  return `${EXPLORER_BASE}/${explorerNetwork()}/tx/${txHash}`;
}

/** Builds a Stellar Expert link for an account/contract address. */
export function stellarExpertAccountUrl(address: string): string {
  return `${EXPLORER_BASE}/${explorerNetwork()}/account/${address}`;
}
