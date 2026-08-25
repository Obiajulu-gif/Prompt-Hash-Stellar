/**
 * Purchase receipt construction & signing — Issue #436.
 *
 * Builds a canonical purchase receipt from finalized transaction and
 * contract-event evidence (never from the mutable `Purchase` database row)
 * and signs it so it can be independently re-verified against Stellar RPC —
 * via `@prompthash/sdk`'s `verifyReceipt` — without needing API or database
 * access.
 */
import { scValToNative } from "@stellar/stellar-sdk";
import sodium from "libsodium-wrappers";
import { getRpcServer, type StellarNetworkConfig } from "./tx";

export interface ReceiptContractConfig extends StellarNetworkConfig {
  promptHashContractId: string;
  nativeAssetContractId: string;
}

export interface BuildReceiptInput {
  config: ReceiptContractConfig;
  promptId: string;
  buyerWallet: string;
  txHash: string;
}

export interface BuiltReceipt {
  receipt: Record<string, unknown>;
  signature: string;
  signerPublicKey: string;
  signerKeyId: string;
}

const PURCHASE_EVENT_TOPICS = new Set(["PromptPurchased", "LicenseTransferred"]);

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value !== null && typeof value === "object") {
    return Object.keys(value as Record<string, unknown>)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortKeysDeep((value as Record<string, unknown>)[key]);
        return acc;
      }, {});
  }
  return value;
}

/** Deterministic (sorted-key) JSON serialization — must match the SDK verifier's canonicalizer. */
export function canonicalizeReceipt(receipt: Record<string, unknown>): string {
  return JSON.stringify(sortKeysDeep(receipt));
}

export interface ReceiptSigningKeys {
  keyId: string;
  publicKey: string;
  privateKey: string;
  notBefore?: string;
  notAfter?: string;
  issueBefore?: string;
  revokedAt?: string;
}

function parseReceiptSigningKeys(): ReceiptSigningKeys[] {
  const keySetJson = process.env.RECEIPT_SIGNING_KEYS_JSON;
  if (keySetJson) {
    const parsed = JSON.parse(keySetJson) as ReceiptSigningKeys[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      throw new Error("RECEIPT_SIGNING_KEYS_JSON must be a non-empty array.");
    }
    return parsed;
  }

  const publicKey = process.env.RECEIPT_SIGNING_PUBLIC_KEY;
  const privateKey = process.env.RECEIPT_SIGNING_PRIVATE_KEY;
  if (!publicKey || !privateKey) {
    throw new Error(
      "RECEIPT_SIGNING_PUBLIC_KEY / RECEIPT_SIGNING_PRIVATE_KEY are not configured.",
    );
  }
  return [{
    keyId: process.env.RECEIPT_SIGNING_KEY_ID ?? "default",
    publicKey,
    privateKey,
  }];
}

function isAfter(value: string | undefined, now: Date) {
  return value !== undefined && now.getTime() >= Date.parse(value);
}

function isBefore(value: string | undefined, now: Date) {
  return value !== undefined && now.getTime() < Date.parse(value);
}

export function selectReceiptSigningKey(now = new Date()): ReceiptSigningKeys {
  const keyId = process.env.RECEIPT_SIGNING_ACTIVE_KEY_ID;
  const candidates = parseReceiptSigningKeys().filter((key) => !keyId || key.keyId === keyId);
  const active = candidates.find(
    (key) =>
      key.privateKey &&
      !key.revokedAt &&
      !isBefore(key.notBefore, now) &&
      !isAfter(key.notAfter, now) &&
      !isAfter(key.issueBefore, now),
  );

  if (!active) {
    throw new Error("No active receipt signing key is available under the configured policy.");
  }
  return active;
}

/** Reads the active Ed25519 receipt-signing keypair from the environment. Throws if unconfigured. */
export function getReceiptSigningKeys(): ReceiptSigningKeys {
  return selectReceiptSigningKey();
}

/**
 * Builds and signs a purchase receipt for a confirmed transaction.
 *
 * Looks the transaction up on-chain (never trusts a caller-supplied amount
 * or prompt state) and locates the matching `PromptPurchased` /
 * `LicenseTransferred` event to derive every receipt field.
 */
export async function buildAndSignReceipt(input: BuildReceiptInput): Promise<BuiltReceipt> {
  const { config, promptId, buyerWallet, txHash } = input;
  const server = getRpcServer(config);

  const tx = await server.getTransaction(txHash);
  if (tx.status !== "SUCCESS") {
    throw new Error(`Cannot issue a receipt for a transaction with status "${tx.status}".`);
  }
  if (!("ledger" in tx) || typeof tx.ledger !== "number") {
    throw new Error("Transaction result is missing ledger information.");
  }

  const events = await server.getEvents({
    startLedger: tx.ledger,
    filters: [{ type: "contract", contractIds: [config.promptHashContractId] }],
    limit: 200,
  });

  const buyerLower = buyerWallet.toLowerCase();
  const matchIndex = events.events
    .filter((event) => event.txHash === txHash)
    .findIndex((event) => {
      const topic = scValToNative(event.topic[0]);
      if (typeof topic !== "string" || !PURCHASE_EVENT_TOPICS.has(topic)) return false;
      const data = scValToNative(event.value) as Record<string, unknown>;
      const eventPromptId = data.prompt_id !== undefined ? String(data.prompt_id) : undefined;
      const eventBuyer = data.buyer !== undefined ? String(data.buyer).toLowerCase() : undefined;
      return eventPromptId === promptId && eventBuyer === buyerLower;
    });

  if (matchIndex === -1) {
    throw new Error(
      "No matching PromptPurchased/LicenseTransferred event found for this transaction.",
    );
  }

  const sameTxEvents = events.events.filter((event) => event.txHash === txHash);
  const event = sameTxEvents[matchIndex];
  const topic = scValToNative(event.topic[0]) as string;
  const data = scValToNative(event.value) as Record<string, unknown>;
  const createdAt =
    "createdAt" in tx && typeof (tx as { createdAt?: number }).createdAt === "number"
      ? new Date((tx as { createdAt: number }).createdAt * 1000).toISOString()
      : new Date().toISOString();

  const receipt = {
    version: 1 as const,
    network: {
      passphrase: config.networkPassphrase,
      rpcUrl: config.rpcUrl,
    },
    contract: { id: config.promptHashContractId },
    prompt: {
      id: promptId,
      revision: typeof data.revision === "number" ? data.revision : 0,
    },
    buyer: buyerWallet,
    asset: { contractId: config.nativeAssetContractId },
    amount: {
      stroops: String(data.price_stroops ?? data.resale_price ?? "0"),
    },
    transaction: {
      hash: txHash,
      ledger: tx.ledger,
      createdAt,
    },
    event: { topic, index: matchIndex },
    issuedAt: new Date().toISOString(),
    expiresAt: new Date(
      Date.now() + Number(process.env.RECEIPT_TTL_MS ?? 365 * 24 * 60 * 60 * 1000),
    ).toISOString(),
  };

  const { keyId, publicKey, privateKey } = getReceiptSigningKeys();
  await sodium.ready;
  const message = sodium.from_string(canonicalizeReceipt(receipt));
  const secretKeyBytes = sodium.from_base64(privateKey, sodium.base64_variants.ORIGINAL);
  const signatureBytes = sodium.crypto_sign_detached(message, secretKeyBytes);

  return {
    receipt,
    signature: sodium.to_base64(signatureBytes, sodium.base64_variants.ORIGINAL),
    signerPublicKey: publicKey,
    signerKeyId: keyId,
  };
}
