/**
 * Lightweight JWT implementation for the Stellar wallet auth system.
 *
 * Uses HMAC-SHA256 (HS256) implemented with Node's built-in `crypto` module.
 * No external JWT library is required, matching the project's approach of
 * using custom HMAC tokens.
 *
 * Tokens are:
 *  - Signed with JWT_SECRET (env var, min 32 chars)
 *  - Valid for JWT_TTL_HOURS (default 24 h)
 *  - Bound to a Stellar public key (sub claim)
 *  - Uniquely identified by `jti` (for future revocation support)
 *
 * Node-only module. Do NOT import in the browser bundle.
 */

import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { Buffer } from "buffer";
import type { AuthJwtPayload } from "./stellarAuth";

/** JWT validity window in seconds (default: 24 hours). */
export const JWT_TTL_SECONDS = parseInt(process.env.JWT_TTL_SECONDS ?? "86400", 10);

function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "JWT_SECRET must be set in environment variables and be at least 32 characters long.",
    );
  }
  return secret;
}

// ─── Encoding helpers ─────────────────────────────────────────────────────────

function b64url(value: string | Buffer): string {
  const buf = typeof value === "string" ? Buffer.from(value, "utf8") : value;
  return buf.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(value: string): string {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
  return Buffer.from(normalized + padding, "base64").toString("utf8");
}

// ─── JWT header ───────────────────────────────────────────────────────────────

const HEADER = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));

// ─── Sign / verify ────────────────────────────────────────────────────────────

function sign(headerPayload: string, secret: string): string {
  return b64url(createHmac("sha256", secret).update(headerPayload).digest());
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Issue a new signed JWT for the given Stellar address.
 * Returns the compact token string (header.payload.signature).
 */
export function issueJwt(address: string): string {
  const secret = getJwtSecret();
  const now = Math.floor(Date.now() / 1000);

  const payload: AuthJwtPayload = {
    sub: address,
    iat: now,
    exp: now + JWT_TTL_SECONDS,
    jti: randomUUID(),
  };

  const encodedPayload = b64url(JSON.stringify(payload));
  const headerPayload = `${HEADER}.${encodedPayload}`;
  const signature = sign(headerPayload, secret);

  return `${headerPayload}.${signature}`;
}

/**
 * Verify a JWT and return its decoded payload.
 * Throws a descriptive error if the token is invalid, expired, or tampered.
 */
export function verifyJwt(token: string): AuthJwtPayload {
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed JWT: expected 3 parts.");
  }

  const [header, encodedPayload, signature] = parts;
  const secret = getJwtSecret();

  // Timing-safe signature comparison
  const expected = sign(`${header}.${encodedPayload}`, secret);
  const receivedBuf = Buffer.from(signature, "utf8");
  const expectedBuf = Buffer.from(expected, "utf8");

  if (
    receivedBuf.length !== expectedBuf.length ||
    !timingSafeEqual(receivedBuf, expectedBuf)
  ) {
    throw new Error("JWT signature verification failed.");
  }

  let payload: AuthJwtPayload;
  try {
    payload = JSON.parse(fromB64url(encodedPayload)) as AuthJwtPayload;
  } catch {
    throw new Error("Malformed JWT payload.");
  }

  const now = Math.floor(Date.now() / 1000);
  if (payload.exp < now) {
    throw new Error("JWT has expired.");
  }
  if (!payload.sub) {
    throw new Error("JWT missing sub (Stellar address).");
  }

  return payload;
}

/**
 * Extract the Stellar address from an auth cookie/header value without
 * throwing (returns null on any error). Useful for optional auth checks.
 */
export function extractAddressFromJwt(token: string): string | null {
  try {
    return verifyJwt(token).sub;
  } catch {
    return null;
  }
}

/** Epoch milliseconds when this JWT expires. */
export function jwtExpiresAtMs(token: string): number | null {
  try {
    const payload = verifyJwt(token);
    return payload.exp * 1000;
  } catch {
    return null;
  }
}
