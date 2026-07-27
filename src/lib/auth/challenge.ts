import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { Buffer } from "buffer";
import { Keypair } from "@stellar/stellar-sdk";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export interface ChallengePayload {
  address: string;
  promptId: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
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
  return `prompt-hash unlock:${payload.address}:${payload.promptId}:${payload.nonce}:${payload.issuedAt}:${payload.expiresAt}`;
}

export function createChallengeToken(
  secret: string,
  address: string,
  promptId: string,
  now = Date.now(),
  ttlMs = DEFAULT_TTL_MS,
) {
  const payload: ChallengePayload = {
    address,
    promptId,
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
 * In-process nonce ledger for tracking consumed challenge nonces.
 * One nonce corresponds to exactly one unlock request; consuming it a second
 * time indicates a replay attack. Entries are evicted once their TTL expires
 * (matching the challenge expiry) so memory stays bounded.
 *
 * Production deployments running multiple server instances should back this
 * with a shared store (Redis); for single-instance deploys and tests the
 * in-memory ledger is sufficient.
 */
export class NonceLedger {
  private readonly used = new Map<string, number>();

  /**
   * Attempt to consume a nonce. Returns `true` the first time a given nonce
   * is seen, `false` on any subsequent call with the same nonce (replay).
   * Expired entries are pruned before each check to keep memory bounded.
   */
  consume(nonce: string, expiresAt: number): boolean {
    const now = Date.now();
    this.prune(now);

    if (this.used.has(nonce)) {
      return false;
    }

    this.used.set(nonce, expiresAt);
    return true;
  }

  private prune(now: number): void {
    for (const [nonce, expiresAt] of this.used) {
      if (expiresAt < now) {
        this.used.delete(nonce);
      }
    }
  }
}

export const globalNonceLedger = new NonceLedger();
