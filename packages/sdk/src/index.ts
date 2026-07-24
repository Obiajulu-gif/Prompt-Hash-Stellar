/**
 * @prompthash/sdk — Issue #110
 *
 * Lightweight JS/TS SDK for interacting with the PromptHash Stellar protocol.
 * Covers: fetching prompts, buying prompts, and verifying license ownership.
 */

export { PromptHashClient } from "./client.js";
export type { PromptInfo, PurchaseResult, ClientConfig } from "./types.js";
export { verifyReceipt, canonicalizeReceipt } from "./receipts.js";
export type {
  PurchaseReceipt,
  SignedPurchaseReceipt,
  ReceiptCurrentEntitlement,
  ReceiptVerificationResult,
} from "./types.js";
export type { VerifyReceiptOptions } from "./receipts.js";
