export type WalletErrorCode =
  | "EXTENSION_NOT_FOUND"
  | "USER_REJECTED"
  | "WRONG_NETWORK"
  | "TRANSACTION_FAILED"
  | "INSUFFICIENT_BALANCE"
  | "CONTRACT_ERROR"
  | "TIMEOUT"
  | "NETWORK_ERROR"
  | "UNKNOWN";

export interface WalletErrorInfo {
  code: WalletErrorCode;
  title: string;
  message: string;
  recoveryAction?: string;
  retryable: boolean;
}

export function classifyWalletError(error: unknown): WalletErrorInfo {
  const msg = extractMessage(error).toLowerCase();

  if (isExtensionMissing(msg)) {
    return {
      code: "EXTENSION_NOT_FOUND",
      title: "Wallet not found",
      message: "The selected wallet extension is not installed in your browser.",
      recoveryAction: "Install the wallet extension and refresh the page.",
      retryable: false,
    };
  }

  if (isUserRejected(msg)) {
    return {
      code: "USER_REJECTED",
      title: "Connection cancelled",
      message: "You declined the wallet connection request.",
      recoveryAction: "Click Connect Wallet to try again.",
      retryable: true,
    };
  }

  if (isWrongNetwork(msg)) {
    return {
      code: "WRONG_NETWORK",
      title: "Wrong network",
      message: "Your wallet is connected to a different Stellar network.",
      recoveryAction: "Switch your wallet to the correct network and reconnect.",
      retryable: true,
    };
  }

  if (isInsufficientBalance(msg)) {
    return {
      code: "INSUFFICIENT_BALANCE",
      title: "Insufficient balance",
      message: "Your account does not have enough XLM to complete this transaction.",
      recoveryAction: "Add funds to your wallet and try again.",
      retryable: true,
    };
  }

  if (isTransactionFailed(msg)) {
    return {
      code: "TRANSACTION_FAILED",
      title: "Transaction failed",
      message: "The transaction could not be submitted to the Stellar network.",
      recoveryAction: "Check your wallet and try again.",
      retryable: true,
    };
  }

  if (isContractError(msg)) {
    return {
      code: "CONTRACT_ERROR",
      title: "Contract error",
      message: "The smart contract returned an error. The operation could not be completed.",
      recoveryAction: "Please verify the transaction details and try again.",
      retryable: true,
    };
  }

  if (isTimeout(msg)) {
    return {
      code: "TIMEOUT",
      title: "Request timed out",
      message: "The wallet did not respond in time.",
      recoveryAction: "Check that your wallet extension is open and try again.",
      retryable: true,
    };
  }

  if (isNetworkError(msg)) {
    return {
      code: "NETWORK_ERROR",
      title: "Network error",
      message: "Could not reach the Stellar network.",
      recoveryAction: "Check your internet connection and try again.",
      retryable: true,
    };
  }

  return {
    code: "UNKNOWN",
    title: "Connection failed",
    message: "Something went wrong while connecting your wallet.",
    recoveryAction: "Please try again or use a different wallet.",
    retryable: true,
  };
}

function extractMessage(error: unknown): string {
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    return String((error as { message: unknown }).message);
  }
  return "";
}

function isExtensionMissing(msg: string): boolean {
  return (
    msg.includes("not installed") ||
    msg.includes("not found") ||
    msg.includes("no provider") ||
    msg.includes("wallet not available") ||
    msg.includes("extension not") ||
    msg.includes("cannot find module") ||
    msg.includes("is not defined") ||
    msg.includes("freighter is not") ||
    msg.includes("xbull is not")
  );
}

function isUserRejected(msg: string): boolean {
  return (
    msg.includes("user rejected") ||
    msg.includes("user denied") ||
    msg.includes("user cancelled") ||
    msg.includes("user canceled") ||
    msg.includes("rejected by user") ||
    msg.includes("cancelled by user") ||
    msg.includes("request denied") ||
    msg.includes("action rejected")
  );
}

function isWrongNetwork(msg: string): boolean {
  return (
    msg.includes("wrong network") ||
    msg.includes("network mismatch") ||
    msg.includes("network not supported") ||
    msg.includes("different network")
  );
}

function isInsufficientBalance(msg: string): boolean {
  return (
    msg.includes("insufficient") ||
    msg.includes("underfunded") ||
    msg.includes("op_underfunded") ||
    msg.includes("tx_insufficient_balance") ||
    msg.includes("not enough")
  );
}

function isTransactionFailed(msg: string): boolean {
  return (
    msg.includes("tx_failed") ||
    msg.includes("tx_bad_auth") ||
    msg.includes("transaction failed") ||
    msg.includes("op_not_authorized") ||
    msg.includes("op_no_trust")
  );
}

function isContractError(msg: string): boolean {
  return (
    msg.includes("contract error") ||
    msg.includes("host invocation failed") ||
    msg.includes("contracterror") ||
    msg.includes("wasm trap")
  );
}

function isTimeout(msg: string): boolean {
  return (
    msg.includes("timeout") ||
    msg.includes("timed out") ||
    msg.includes("request took too long")
  );
}

function isNetworkError(msg: string): boolean {
  return (
    msg.includes("network error") ||
    msg.includes("failed to fetch") ||
    msg.includes("networkerror") ||
    msg.includes("econnrefused") ||
    msg.includes("enotfound") ||
    msg.includes("connection refused")
  );
}
