import { createHash, createHmac, randomUUID, timingSafeEqual } from "crypto";
import { Buffer } from "buffer";
import { Keypair } from "@stellar/stellar-sdk";
import { hashKey, nonceStore } from "../observability/sharedStore";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export interface ChallengePayload {
  address: string;
  promptId: string;
  origin: string;
  networkPassphrase: string;
  contractId: string;
  action: string;
  promptVersion?: string;
  expectedPriceStroops?: string;
  /** Canonical hash of the listing snapshot this challenge is bound to. */
  listingSnapshotHash?: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export interface ChallengeContext {
  origin?: string;
  networkPassphrase?: string;
  contractId?: string;
  action?: string;
  promptVersion?: string;
  expectedPriceStroops?: string;
  /** Canonical hash of the marketplace listing snapshot the buyer signed. */
  listingSnapshotHash?: string;
}

/**
 * The exact marketplace listing fields a purchase challenge must bind to so the
 * buyer's signature cannot be replayed against a drifted listing (price, owner,
 * asset, version, or expiry changes between challenge creation and submission).
 */
export interface ListingSnapshot {
  promptId: string;
  owner: string;
  priceStroops: string;
  asset: string;
  version: string;
  expiresAt: string;
}

/**
 * Deterministic SHA-256 hash of a listing snapshot.
 *
 * The canonical string includes a fixed `listing` domain tag and every field in
 * a stable order. Address-like fields (owner, asset) are lower-cased; numeric
 * fields are normalized to their string form so the same listing always hashes
 * to the same value regardless of client/precision differences.
 */
export function computeListingSnapshotHash(snapshot: ListingSnapshot): string {
  const normalize = (value: unknown): string =>
    value === undefined || value === null ? "" : String(value).trim();
  const parts = [
    normalize(snapshot.promptId),
    normalize(snapshot.owner).toLowerCase(),
    normalize(snapshot.priceStroops),
    normalize(snapshot.asset).toLowerCase(),
    normalize(snapshot.version),
    normalize(snapshot.expiresAt),
  ];
  const canonical = `listing|${parts.join("|")}`;
  return createHash("sha256").update(canonical).digest("hex");
}

function base64UrlEncode(value: string) {
  return Buffer.from(value, "utf8")
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function base64UrlDecode(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(`${normalized}${padding}`, "base64").toString("utf8");
}

function signPayload(secret: string, body: string) {
  return createHmac("sha256", secret).update(body).digest("base64url");
}

export function buildChallengeMessage(payload: ChallengePayload) {
  return [
    "prompt-hash",
    payload.action,
    payload.origin,
    payload.networkPassphrase,
    payload.contractId,
    payload.address,
    payload.promptId,
    payload.promptVersion ?? "",
    payload.expectedPriceStroops ?? "",
    payload.listingSnapshotHash ?? "",
    payload.nonce,
    payload.issuedAt,
    payload.expiresAt,
  ].join(":");
}

export function createChallengeToken(
  secret: string,
  address: string,
  promptId: string,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
  context: ChallengeContext = {},
) {
  const payload: ChallengePayload = {
    address,
    promptId,
    origin: context.origin ?? "*",
    networkPassphrase: context.networkPassphrase ?? "",
    contractId: context.contractId ?? "",
    action: context.action ?? "unlock",
    promptVersion: context.promptVersion,
    expectedPriceStroops: context.expectedPriceStroops,
    listingSnapshotHash: context.listingSnapshotHash,
    nonce: randomUUID(),
    issuedAt: now,
    expiresAt: now + ttlMs,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(secret, encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    challenge: buildChallengeMessage(payload),
    issuedAt: payload.issuedAt,
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
  };
}

export function verifyChallengeToken(
  secret: string | string[],
  token: string,
  address: string,
  promptId: string,
  now = Date.now(),
  expectedContext: ChallengeContext = {},
) {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Malformed challenge token.");
  }

  // Support multiple secrets for rotation grace period
  const secrets = Array.isArray(secret) ? secret : [secret];
  let validSignature = false;

  for (const sec of secrets) {
    const expectedSignature = signPayload(sec, encodedPayload);
    const received = Buffer.from(signature, "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");

    if (received.length === expected.length && timingSafeEqual(received, expected)) {
      validSignature = true;
      break;
    }
  }

  if (!validSignature) {
    throw new Error("Invalid challenge token signature.");
  }

  const payload = JSON.parse(base64UrlDecode(encodedPayload)) as ChallengePayload;
  if (payload.address !== address || payload.promptId !== promptId) {
    throw new Error("Challenge token does not match the requested prompt unlock.");
  }
  if (
    expectedContext.origin !== undefined &&
    expectedContext.origin !== "" &&
    payload.origin !== "*" &&
    payload.origin !== expectedContext.origin
  ) {
    throw new Error("Challenge token origin mismatch.");
  }
  if (
    expectedContext.networkPassphrase !== undefined &&
    expectedContext.networkPassphrase !== "" &&
    payload.networkPassphrase !== "" &&
    payload.networkPassphrase !== expectedContext.networkPassphrase
  ) {
    throw new Error("Challenge token network mismatch.");
  }
  if (
    expectedContext.contractId !== undefined &&
    expectedContext.contractId !== "" &&
    payload.contractId !== "" &&
    payload.contractId !== expectedContext.contractId
  ) {
    throw new Error("Challenge token contract mismatch.");
  }
  if (
    expectedContext.action !== undefined &&
    payload.action !== expectedContext.action
  ) {
    throw new Error("Challenge token action mismatch.");
  }
  if (
    expectedContext.promptVersion !== undefined &&
    payload.promptVersion !== expectedContext.promptVersion
  ) {
    throw new Error("Challenge token prompt version mismatch.");
  }
  if (
    expectedContext.expectedPriceStroops !== undefined &&
    payload.expectedPriceStroops !== expectedContext.expectedPriceStroops
  ) {
    throw new Error("Challenge token prompt price mismatch.");
  }
  if (
    expectedContext.listingSnapshotHash !== undefined &&
    payload.listingSnapshotHash !== expectedContext.listingSnapshotHash
  ) {
    throw new Error("Challenge token listing snapshot mismatch.");
  }

  if (payload.expiresAt < now) {
    throw new Error("Challenge token has expired.");
  }

  return payload;
}

export function verifyChallengeSignature(
  address: string,
  message: string,
  signatureBase64: string,
): boolean {
  try {
    const keypair = Keypair.fromPublicKey(address);
    return keypair.verify(Buffer.from(message, "utf8"), Buffer.from(signatureBase64, "base64"));
  } catch {
    return false;
  }
}

/**
 * Shared nonce ledger backed by an atomic SETNX store (Redis).
 *
 * Replaces the previous in-memory Map-based implementation to provide
 * consistent replay protection across multi-replica deployments.
 *
 * Fail-closed: if the shared store (Redis) is unreachable in production,
 * consumption requests are *rejected* — they do NOT fall back to
 * in-process memory.
 */
export class NonceLedger {
  /**
   * Attempt to consume a nonce. Returns `true` the first time a given nonce
   * is seen, `false` on any subsequent call with the same nonce (replay).
   * Fail-closed: throws in production if shared store is unreachable.
   */
  async consume(nonce: string, expiresAt: number): Promise<boolean> {
    const ttlMs = Math.max(expiresAt - Date.now(), 60_000);
    return nonceStore.consume(hashKey(nonce), ttlMs);
  }

  /**
   * Check whether a nonce has already been consumed without consuming it.
   * Useful for diagnostics and tests.
   */
  async isConsumed(nonce: string): Promise<boolean> {
    return nonceStore.isConsumed(hashKey(nonce));
  }

  /** Remove all tracked nonces (intended for test teardown). */
  clear(): void {
    // Shared store cannot be cleared from a single instance.
    // Tests should use a dedicated nonce namespace (e.g., unique test prefix).
  }
}

export const globalNonceLedger = new NonceLedger();
