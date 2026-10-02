/**
 * XLM Payment Gateway
 *
 * Implements the two-step on-chain purchase flow for buying prompts with XLM:
 *
 *   1. Approve: The buyer grants the PromptHash contract a one-time spending
 *      allowance on the XLM Stellar Asset Contract (SAC).  This uses Soroban's
 *      token `approve` call on the native asset contract.
 *
 *   2. Buy: The buyer calls `buy_prompt` on the PromptHash contract.  The
 *      contract pulls the approved XLM, splits it between the creator and the
 *      platform fee wallet, and records the purchase on-chain.
 *
 * The gateway returns a `txHash` on success so the UI can link to Stellar
 * Expert for confirmation.
 */

import {
  scValArg,
  prepareContractCall,
  submitPreparedTransaction,
  getRpcServer,
  type StellarNetworkConfig,
  type WalletTransactionSigner,
} from "./tx";
import { approveNativeAssetSpend } from "./nativeAssetClient";

export interface XlmPaymentConfig extends StellarNetworkConfig {
  promptHashContractId: string;
  nativeAssetContractId: string;
}

export interface XlmPaymentResult {
  txHash: string;
  success: true;
}

/**
 * Thrown when the XLM balance is too low to cover the purchase price.
 * The UI can catch this specific type to render a targeted "fund your wallet"
 * message instead of a generic error.
 */
export class InsufficientXlmBalanceError extends Error {
  constructor(message = "Insufficient XLM balance. Please add funds to your wallet and try again.") {
    super(message);
    this.name = "InsufficientXlmBalanceError";
  }
}

/**
 * Thrown when the user explicitly rejects the transaction in their wallet.
 */
export class UserRejectedTransactionError extends Error {
  constructor(message = "You rejected the transaction in your wallet. No funds were moved.") {
    super(message);
    this.name = "UserRejectedTransactionError";
  }
}

/**
 * Thrown when the Stellar network returns a hard error (e.g. tx_failed).
 */
export class TransactionSubmissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransactionSubmissionError";
  }
}

// ─── Approval TTL ────────────────────────────────────────────────────────────
// We ask for an allowance that expires in ~10 minutes worth of ledgers.
// Stellar produces a new ledger every ~5 seconds → 10 min ≈ 120 ledgers.
// We fetch the current ledger sequence and add this buffer so the approval is
// live long enough for the buy call to land but doesn't persist indefinitely.
const APPROVAL_LEDGER_BUFFER = 120;

async function getCurrentLedger(config: StellarNetworkConfig): Promise<number> {
  const server = getRpcServer(config);
  const info = await server.getLatestLedger();
  return info.sequence;
}

/** Normalise raw wallet/network errors into typed gateway errors. */
function normaliseError(err: unknown): never {
  const msg = err instanceof Error ? err.message : String(err);
  const lower = msg.toLowerCase();

  if (
    lower.includes("user rejected") ||
    lower.includes("user denied") ||
    lower.includes("user cancelled") ||
    lower.includes("user canceled") ||
    lower.includes("rejected by user") ||
    lower.includes("action rejected") ||
    lower.includes("request denied")
  ) {
    throw new UserRejectedTransactionError();
  }

  if (
    lower.includes("op_underfunded") ||
    lower.includes("tx_insufficient_balance") ||
    lower.includes("insufficient") ||
    lower.includes("underfunded") ||
    lower.includes("not enough")
  ) {
    throw new InsufficientXlmBalanceError();
  }

  throw new TransactionSubmissionError(msg || "Transaction submission failed.");
}

/**
 * Execute the full XLM purchase flow for a single prompt.
 *
 * @param config    Network + contract configuration (from `browserStellarConfig`)
 * @param signer    The connected wallet's `signTransaction` method
 * @param buyer     The buyer's Stellar public key (G… address)
 * @param promptId  Numeric prompt ID (bigint)
 * @param priceStroops The exact price the contract expects (in stroops)
 */
export async function purchasePromptWithXlm(
  config: XlmPaymentConfig,
  signer: WalletTransactionSigner,
  buyer: string,
  promptId: bigint,
  priceStroops: bigint,
): Promise<XlmPaymentResult> {
  // ── Validate configuration ────────────────────────────────────────────────
  if (!config.promptHashContractId) {
    throw new Error(
      "PromptHash contract ID is not configured. Set PUBLIC_PROMPT_HASH_CONTRACT_ID in your environment.",
    );
  }
  if (!config.nativeAssetContractId) {
    throw new Error(
      "Native asset contract ID is not configured. Set PUBLIC_STELLAR_NATIVE_ASSET_CONTRACT_ID in your environment.",
    );
  }

  // ── Step 1: Approve the contract to pull XLM from the buyer ──────────────
  // Fetch the current ledger so we can compute a short-lived expiry.
  let currentLedger: number;
  try {
    currentLedger = await getCurrentLedger(config);
  } catch (err) {
    normaliseError(err);
  }

  const expirationLedger = currentLedger! + APPROVAL_LEDGER_BUFFER;

  try {
    await approveNativeAssetSpend(
      { ...config, nativeAssetContractId: config.nativeAssetContractId },
      signer,
      buyer,
      config.promptHashContractId, // spender = the prompt-hash contract
      priceStroops,
      expirationLedger,
    );
  } catch (err) {
    normaliseError(err);
  }

  // ── Step 2: Call buy_prompt on the PromptHash contract ───────────────────
  // Contract signature (from contract.rs):
  //   fn buy_prompt(buyer, prompt_id: u128, referrer: Option<Address>,
  //                 payment_amount_stroops: i128, voucher: Option<Bytes>)
  let buyResult: Awaited<ReturnType<typeof submitPreparedTransaction>>;
  try {
    const prepared = await prepareContractCall(
      config,
      buyer,
      config.promptHashContractId,
      "buy_prompt",
      [
        scValArg(buyer, "address"),
        scValArg(BigInt(promptId), "u128"),
        // referrer = None
        scValArg(null, "void"),
        // payment_amount_stroops = i128
        scValArg(BigInt(priceStroops), "i128"),
        // voucher = None
        scValArg(null, "void"),
      ],
    );

    buyResult = await submitPreparedTransaction(config, prepared, signer, buyer);
  } catch (err) {
    normaliseError(err);
  }

  const txHash = (buyResult! as any).hash ?? "";

  return { txHash, success: true };
}
