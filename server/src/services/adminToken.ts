/**
 * Admin session tokens (#542).
 *
 * Signed, expiring, scope-bound bearer tokens for privileged server
 * operations (integrity checks, moderation reports, secret rotation,
 * fulfillment recovery). Deliberately mirrors the HMAC token shape in
 * `src/lib/auth/challenge.ts` — same signing primitive, same
 * rotation-friendly multi-secret verification — but carries admin-specific
 * claims (role, scope, issuer, audience) instead of a buyer/promptId
 * binding. Kept as its own copy under `server/src` (rather than imported
 * from the root `src/lib`) because this package's tsconfig `rootDir` only
 * covers `server/src`.
 *
 * Tokens are minted out-of-band by whoever holds `ADMIN_TOKEN_SECRET`
 * (an operator CLI/script), not through a public HTTP endpoint — this
 * service has no staff-account database to authenticate a login request
 * against.
 */

import { createHmac, randomUUID, timingSafeEqual } from "crypto";
import { Buffer } from "buffer";

const DEFAULT_TTL_MS = 60 * 60 * 1000; // 1 hour

export interface AdminTokenPayload {
  /** Operator identifier, e.g. "ops-jane". Never a secret. */
  sub: string;
  role: "admin";
  /** Granted scopes, e.g. ["integrity:read", "integrity:write"]. */
  scope: string[];
  /** Who minted this token (informational, included in the signed payload). */
  iss: string;
  /** Which deployment/environment this token is valid for. */
  aud: string;
  nonce: string;
  issuedAt: number;
  expiresAt: number;
}

export type AdminTokenErrorCode =
  | "malformed"
  | "invalid_signature"
  | "wrong_role"
  | "wrong_audience"
  | "missing_issuer"
  | "expired"
  | "revoked"
  | "insufficient_scope";

export class AdminTokenError extends Error {
  constructor(
    public readonly code: AdminTokenErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AdminTokenError";
  }
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

export function createAdminToken(
  secret: string,
  params: { sub: string; scope: string[]; iss: string; aud: string; ttlMs?: number },
  now = Date.now(),
): { token: string; payload: AdminTokenPayload } {
  const payload: AdminTokenPayload = {
    sub: params.sub,
    role: "admin",
    scope: params.scope,
    iss: params.iss,
    aud: params.aud,
    nonce: randomUUID(),
    issuedAt: now,
    expiresAt: now + (params.ttlMs ?? DEFAULT_TTL_MS),
  };

  const encodedPayload = base64UrlEncode(JSON.stringify(payload));
  const signature = signPayload(secret, encodedPayload);

  return { token: `${encodedPayload}.${signature}`, payload };
}

/**
 * In-process revocation list, keyed by token nonce. A revoked token is
 * rejected immediately regardless of its stated expiry — the mechanism a
 * compromised or decommissioned operator token needs to be cut off before
 * it naturally expires.
 *
 * Production deployments running multiple instances should back this with
 * a shared store (Redis); for single-instance deploys and tests the
 * in-memory set is sufficient (matches `NonceLedger` in
 * `src/lib/auth/challenge.ts`).
 */
const revokedTokenIds = new Set<string>();

export function revokeAdminToken(nonce: string): void {
  revokedTokenIds.add(nonce);
}

export function isAdminTokenRevoked(nonce: string): boolean {
  return revokedTokenIds.has(nonce);
}

/** Test-only: clear the revocation set between test cases. */
export function __clearRevokedAdminTokensForTests(): void {
  revokedTokenIds.clear();
}

/**
 * Verify an admin bearer token's signature, expiry, issuer/audience
 * binding, role, and required scope. Throws `AdminTokenError` with a
 * stable `code` on any failure so callers can log a reason without
 * leaking token contents.
 */
export function verifyAdminToken(
  secrets: string | string[],
  token: string,
  opts: { audience: string; requiredScope: string },
  now = Date.now(),
): AdminTokenPayload {
  const parts = token.split(".");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new AdminTokenError("malformed", "Malformed admin token.");
  }
  const [encodedPayload, signature] = parts;

  const secretList = (Array.isArray(secrets) ? secrets : [secrets]).filter(Boolean);
  let validSignature = false;
  for (const sec of secretList) {
    const expectedSignature = signPayload(sec, encodedPayload);
    const received = Buffer.from(signature, "utf8");
    const expected = Buffer.from(expectedSignature, "utf8");
    if (received.length === expected.length && timingSafeEqual(received, expected)) {
      validSignature = true;
      break;
    }
  }
  if (!validSignature) {
    throw new AdminTokenError("invalid_signature", "Invalid admin token signature.");
  }

  let payload: AdminTokenPayload;
  try {
    payload = JSON.parse(base64UrlDecode(encodedPayload)) as AdminTokenPayload;
  } catch {
    throw new AdminTokenError("malformed", "Malformed admin token payload.");
  }

  if (payload.role !== "admin") {
    throw new AdminTokenError("wrong_role", "Token does not carry the admin role.");
  }
  if (!payload.iss) {
    throw new AdminTokenError("missing_issuer", "Token is missing an issuer.");
  }
  // Binds a token to the environment it was minted for, so a token issued
  // for staging cannot be replayed against production (confused-deputy /
  // cross-environment reuse).
  if (payload.aud !== opts.audience) {
    throw new AdminTokenError("wrong_audience", "Token audience does not match this environment.");
  }
  if (payload.expiresAt < now) {
    throw new AdminTokenError("expired", "Admin token has expired.");
  }
  if (isAdminTokenRevoked(payload.nonce)) {
    throw new AdminTokenError("revoked", "Admin token has been revoked.");
  }
  if (!Array.isArray(payload.scope) || !payload.scope.includes(opts.requiredScope)) {
    throw new AdminTokenError(
      "insufficient_scope",
      `Token lacks required scope: ${opts.requiredScope}`,
    );
  }

  return payload;
}
