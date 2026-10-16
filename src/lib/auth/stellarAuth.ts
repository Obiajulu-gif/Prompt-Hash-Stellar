/**
 * Stellar wallet authentication types and utilities.
 *
 * This module provides the shared type contracts and cryptographic helpers used
 * by both the frontend hooks (wallet connection / signing) and the backend
 * verification endpoints (/api/auth/nonce, /api/auth/verify).
 *
 * Auth strategy: nonce-based challenge-response (similar to SEP-10 but adapted
 * for a custom JWT-issuing backend):
 *   1. Browser requests a one-time nonce for a given Stellar address.
 *   2. Browser signs the nonce payload with the Freighter wallet.
 *   3. Backend verifies the signature using stellar-sdk Keypair.verify().
 *   4. On success, backend issues an HTTP-only JWT bound to that public key.
 *
 * The resulting JWT is used as the session credential for all subsequent
 * protected API calls (middleware: isAuthenticated / hasAssetAccess).
 */

// ─── Challenge message format ────────────────────────────────────────────────

/** Fixed prefix so wallets display a recognisable human-readable message. */
export const AUTH_CHALLENGE_PREFIX = "PromptHash Authentication";

/**
 * Build the exact string that will be signed by the wallet and must be
 * reconstructed server-side before signature verification.
 *
 * Format:
 *   "PromptHash Authentication\nAddress: <stellarAddress>\nNonce: <nonce>\nDomain: <domain>\nIssuedAt: <timestamp>"
 */
export function buildAuthChallengeMessage(params: {
  address: string;
  nonce: string;
  domain: string;
  issuedAt: number;
}): string {
  return (
    `${AUTH_CHALLENGE_PREFIX}\n` +
    `Address: ${params.address}\n` +
    `Nonce: ${params.nonce}\n` +
    `Domain: ${params.domain}\n` +
    `IssuedAt: ${params.issuedAt}`
  );
}

// ─── API payload shapes ──────────────────────────────────────────────────────

/** Response from GET /api/auth/nonce */
export interface AuthNonceResponse {
  nonce: string;
  expiresAt: number;
  issuedAt: number;
  message: string; // fully-assembled challenge string, ready to sign
}

/** Request body for POST /api/auth/verify */
export interface AuthVerifyRequest {
  address: string;
  nonce: string;
  signature: string; // base64-encoded Ed25519 signature over message bytes
}

/** Successful response from POST /api/auth/verify */
export interface AuthVerifyResponse {
  token: string;        // JWT returned in body (also set as HTTP-only cookie)
  address: string;
  expiresAt: number;   // epoch ms
}

/** Shape stored in the JWT payload */
export interface AuthJwtPayload {
  sub: string;         // Stellar public key (G…)
  iat: number;         // issued-at (seconds)
  exp: number;         // expiry (seconds)
  jti: string;         // unique token id (for revocation)
}

// ─── Asset-access check types ────────────────────────────────────────────────

/**
 * Describes the asset requirement the `hasAssetAccess` middleware will verify
 * against the Stellar Horizon account data.
 */
export interface AssetRequirement {
  /**
   * "native" → minimum XLM balance check.
   * "credit_alphanum4" | "credit_alphanum12" → custom Stellar asset.
   */
  assetType: "native" | "credit_alphanum4" | "credit_alphanum12";
  /** Issuer address (omit for native XLM). */
  issuer?: string;
  /** Asset code e.g. "USDC" (omit for native XLM). */
  code?: string;
  /**
   * Minimum balance required in asset units (not stroops).
   * Defaults to > 0 when omitted.
   */
  minimumBalance?: number;
}

/** Result of an on-chain asset ownership check. */
export interface AssetAccessResult {
  hasAccess: boolean;
  balance: string | null;
  reason?: string;
}

// ─── Session shape exposed to React context ──────────────────────────────────

export type AuthStatus =
  | "idle"
  | "authenticating"
  | "authenticated"
  | "error"
  | "unauthenticated";

export interface AuthSession {
  /** Stellar public key bound to this session. */
  address: string;
  /** JWT (also in HTTP-only cookie, kept in memory for API calls). */
  token: string;
  /** Epoch ms when the JWT expires. */
  expiresAt: number;
}

export interface AuthContextType {
  status: AuthStatus;
  session: AuthSession | null;
  error: string | null;
  /** Trigger the full nonce → sign → verify flow. */
  authenticate: (
    address: string,
    signMessage: (msg: string) => Promise<{ signedMessage?: string } | string>,
  ) => Promise<void>;
  /** Clear the session and remove the auth cookie. */
  logout: () => Promise<void>;
  /** True when the session JWT is still valid (not expired). */
  isAuthenticated: boolean;
}
