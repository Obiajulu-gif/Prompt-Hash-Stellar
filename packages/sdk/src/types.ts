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
