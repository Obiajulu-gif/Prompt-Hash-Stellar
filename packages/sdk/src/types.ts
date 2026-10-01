/** SDK configuration — Issue #110 */

export interface ClientConfig {
  /** PromptHash backend API base URL */
  apiUrl: string;
  /** Stellar network: "testnet" | "mainnet" */
  network?: "testnet" | "mainnet";
}

export interface PromptInfo {
  id: string;
  title: string;
  image: string;
  rating: number;
  upvotes: number;
  owner: string;
  priceUSDC?: number;
}

export interface PurchaseResult {
  success: boolean;
  txHash?: string;
  error?: string;
}

export interface VoteResult {
  success: boolean;
  upvotes: number;
}

/**
 * Canonical, independently-verifiable purchase receipt (#436).
 *
 * Every field is derived from finalized contract state and transaction
 * evidence — never from a mutable database row — so a receipt can be
 * re-verified against Stellar RPC alone, without trusting the PromptHash
 * API or database.
 */
export interface PurchaseReceipt {
  version: 1;
  network: {
    passphrase: string;
    rpcUrl: string;
  };
  contract: {
    id: string;
  };
  prompt: {
    id: string;
    revision: number;
  };
  buyer: string;
  asset: {
    contractId: string;
  };
  amount: {
    stroops: string;
  };
  transaction: {
    hash: string;
    ledger: number;
    createdAt: string;
  };
  event: {
    topic: string;
    index: number;
  };
  issuedAt: string;
}

export interface SignedPurchaseReceipt {
  receipt: PurchaseReceipt;
  signature: string;
  signerPublicKey: string;
}

export interface ReceiptCurrentEntitlement {
  hasAccess: boolean;
  disputeStatus?: "Open" | "Refunded" | "Rejected";
}

export interface ReceiptVerificationResult {
  valid: boolean;
  checks: {
    signatureValid: boolean;
    networkMatches: boolean;
    transactionFound: boolean;
    transactionSucceeded: boolean;
    eventMatches: boolean;
  };
  currentEntitlement?: ReceiptCurrentEntitlement;
  errors: string[];
}
