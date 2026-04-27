import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { Buffer } from "buffer";
import { Keypair } from "@stellar/stellar-sdk";

const DEFAULT_TTL_MS = 5 * 60 * 1000;

export interface ChallengePayload {
  address: string;
  promptId: string;
  nonce: string;
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
  return `prompt-hash unlock:${payload.address}:${payload.promptId}:${payload.nonce}:${payload.expiresAt}`;
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
    expiresAt: now + ttlMs,
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(secret, encodedPayload);

  return {
    token: `${encodedPayload}.${signature}`,
    challenge: buildChallengeMessage(payload),
    expiresAt: payload.expiresAt,
    nonce: payload.nonce,
  };
}

export function verifyChallengeToken(
  secret: string,
  token: string,
  address: string,
  promptId: string,
  now = Date.now(),
) {
  const [encodedPayload, signature] = token.split(".");
  if (!encodedPayload || !signature) {
    throw new Error("Malformed challenge token.");
  }

  const expectedSignature = signPayload(secret, encodedPayload);
  const received = Buffer.from(signature, "utf8");
  const expected = Buffer.from(expectedSignature, "utf8");
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) {
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

function decodeSignature(signature: string) {
  const candidates = [
    () => Buffer.from(signature, "base64"),
    () => Buffer.from(signature, "hex"),
    () => Buffer.from(signature, "utf8"),
  ];

  for (const candidate of candidates) {
    try {
      const value = candidate();
      if (value.length > 0) {
        return value;
      }
    } catch {
      // Try the next encoding.
    }
  }

  throw new Error("Invalid signed message encoding.");
}

export function verifyChallengeSignature(
  address: string,
  message: string,
  signedMessage: string,
) {
  return Keypair.fromPublicKey(address).verify(
    Buffer.from(message, "utf8"),
    decodeSignature(signedMessage),
  );
}

export function verifyUnlock(
  secret: string,
  token: string,
  address: string,
  promptId: string,
  signedMessage: string,
  now = Date.now()
) {
  // 1. Verify the token payload (checks expiry, promptId, address, and server signature)
  const payload = verifyChallengeToken(secret, token, address, promptId, now);

  // 2. Reconstruct the challenge message that the user was required to sign
  const message = buildChallengeMessage(payload);

  // 3. Verify the wallet's cryptographic signature over the message
  const isValid = verifyChallengeSignature(address, message, signedMessage);
  if (!isValid) {
    throw new Error("Invalid wallet signature for the unlock challenge.");
  }

  return payload;
}
