/**
 * @prompthash/sdk — Issue #110
 *
 * Lightweight JS/TS SDK for interacting with the PromptHash Stellar protocol.
 * Covers: fetching prompts, buying prompts, and verifying license ownership.
 */

export { PromptHashClient } from "./client.js";
export type { PromptInfo, PurchaseResult, ClientConfig } from "./types.js";
export { verifyReceipt, canonicalizeReceipt } from "./receipts.js";
export { decodeEvent } from "./events/decode.js";
export type { DecodedEvent, UnrecognizedEvent, DecodeResult } from "./events/decode.js";
export { EVENT_SCHEMAS, CURRENT_EVENT_SCHEMA_VERSION } from "./events/schema.js";
export type { EventSchema, EventFieldSpec, EventFieldType } from "./events/schema.js";
export type {
  PurchaseReceipt,
  SignedPurchaseReceipt,
  ReceiptCurrentEntitlement,
  ReceiptVerificationResult,
} from "./types.js";
export type { VerifyReceiptOptions } from "./receipts.js";
