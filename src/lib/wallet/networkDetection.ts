import { stellarWalletNetwork } from "@/lib/env";

export type NetworkMismatchType = 
  | "correct"
  | "wrong-network"
  | "unavailable"
  | "disconnected";

export interface NetworkMismatchState {
  type: NetworkMismatchType;
  message?: string;
  recoveryInstructions?: string;
}

/**
 * Detects wallet/network mismatch states and provides user-friendly recovery instructions
 */
export function detectNetworkMismatch(
  walletConnected: boolean,
  walletNetwork?: string,
  walletStatus?: string,
): NetworkMismatchState {
  // User hasn't connected wallet yet
  if (!walletConnected || walletStatus === "idle" || walletStatus === "error") {
    return {
      type: "disconnected",
      message: "Wallet not connected",
      recoveryInstructions: "Connect your Stellar wallet to continue",
    };
  }

  // Wallet is connecting or reconnecting
  if (walletStatus === "connecting" || walletStatus === "reconnecting") {
    return {
      type: "unavailable",
      message: "Connecting to wallet...",
      recoveryInstructions: "Please wait while we establish connection",
    };
  }

  // Wallet network is unavailable (some wallets don't expose network info)
  if (!walletNetwork) {
    return {
      type: "correct",
      message: "Network verification unavailable",
    };
  }

  // Check if wallet network matches configured app network
  const expectedNetwork = stellarWalletNetwork.toUpperCase();
  const actualNetwork = walletNetwork.toUpperCase();

  if (actualNetwork !== expectedNetwork) {
    return {
      type: "wrong-network",
      message: `Wrong network: Connected to ${actualNetwork}`,
      recoveryInstructions: `Please switch your wallet to ${expectedNetwork} network and reconnect`,
    };
  }

  return {
    type: "correct",
  };
}

/**
 * Maps common technical errors to user-facing messages
 */
export function mapTechnicalError(error: Error | string): string {
  const errorMessage = typeof error === "string" ? error : error.message;
  const lowerError = errorMessage.toLowerCase();

  // Common Stellar/Soroban errors
  if (lowerError.includes("op_underfunded")) {
    return "Insufficient XLM balance. Please add funds to your wallet.";
  }

  if (lowerError.includes("op_no_trust")) {
    return "Asset trustline not established. Please add the asset to your wallet.";
  }

  if (lowerError.includes("tx_bad_auth")) {
    return "Transaction authorization failed. Please check your wallet signature.";
  }

  if (lowerError.includes("tx_failed") || lowerError.includes("transaction failed")) {
    return "Transaction failed on the network. Please try again.";
  }

  if (lowerError.includes("timeout") || lowerError.includes("timed out")) {
    return "Network request timed out. Please check your connection and try again.";
  }

  if (lowerError.includes("user rejected") || lowerError.includes("user denied")) {
    return "Transaction was rejected in your wallet.";
  }

  if (lowerError.includes("network") || lowerError.includes("connection")) {
    return "Network connection issue. Please check your internet and try again.";
  }

  // Return original message if no mapping found
  return errorMessage;
}
