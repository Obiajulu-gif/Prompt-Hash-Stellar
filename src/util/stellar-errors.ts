import { TransactionBuilder } from "@stellar/stellar-sdk";

export type StellarErrorType = 
  | "USER_CANCELLED"
  | "NETWORK_MISMATCH"
  | "INSUFFICIENT_FUNDS"
  | "TRANSACTION_EXPIRED"
  | "SIMULATION_FAILED"
  | "CONTRACT_ERROR"
  | "UNKNOWN_ERROR";

export interface ParsedStellarError {
  type: StellarErrorType;
  message: string;
  originalError: any;
}

export function parseStellarError(error: any): ParsedStellarError {
  const message = error?.message || String(error);

  if (
    message.includes("User closed") || 
    message.includes("User rejected") || 
    message.includes("User cancelled") ||
    message.includes("exit")
  ) {
    return {
      type: "USER_CANCELLED",
      message: "Transaction was cancelled by the user.",
      originalError: error,
    };
  }

  if (message.includes("Network mismatch") || message.includes("wrong network")) {
    return {
      type: "NETWORK_MISMATCH",
      message: "Your wallet is connected to the wrong Stellar network.",
      originalError: error,
    };
  }

  if (message.includes("insufficient") || message.includes("op_underfunded")) {
    return {
      type: "INSUFFICIENT_FUNDS",
      message: "Insufficient XLM to complete the transaction.",
      originalError: error,
    };
  }

  if (message.includes("simulation failed") || message.includes("simulation_failed")) {
    return {
      type: "SIMULATION_FAILED",
      message: "Transaction simulation failed. This could be due to invalid parameters or contract logic.",
      originalError: error,
    };
  }

  return {
    type: "UNKNOWN_ERROR",
    message: message || "An unexpected error occurred during the transaction.",
    originalError: error,
  };
}
