/**
 * Stable error codes for the challenge and unlock API endpoints.
 *
 * The frontend maps these codes to actionable recovery states.
 * Sensitive backend details are never included in user-facing responses.
 */

export const ErrorCode = {
  // ── Request errors (4xx) ──────────────────────────────────────────────────

  /** One or more required request fields are missing or malformed. */
  MISSING_FIELDS: "MISSING_FIELDS",

  /** The HTTP method is not allowed on this endpoint. */
  METHOD_NOT_ALLOWED: "METHOD_NOT_ALLOWED",

  // ── Auth / access errors (4xx) ────────────────────────────────────────────

  /** The challenge token has expired. The client should request a new one. */
  CHALLENGE_EXPIRED: "CHALLENGE_EXPIRED",

  /** The challenge token is invalid (bad signature, wrong address/promptId). */
  CHALLENGE_INVALID: "CHALLENGE_INVALID",

  /** The wallet signature does not match the challenge message. */
  INVALID_SIGNATURE: "INVALID_SIGNATURE",

  /** The wallet has not purchased access to this prompt. */
  ACCESS_NOT_PURCHASED: "ACCESS_NOT_PURCHASED",

  // ── Rate limiting (429) ───────────────────────────────────────────────────

  /** Too many requests from this IP address. */
  RATE_LIMIT_IP: "RATE_LIMIT_IP",

  /** Too many requests from this wallet address. */
  RATE_LIMIT_WALLET: "RATE_LIMIT_WALLET",

  // ── Server errors (5xx) ───────────────────────────────────────────────────

  /** The server is missing required configuration (never expose details). */
  CONFIGURATION_ERROR: "CONFIGURATION_ERROR",

  /** Prompt content integrity check failed (hash mismatch). */
  INTEGRITY_FAILURE: "INTEGRITY_FAILURE",

  /** A temporary backend failure occurred. The client may retry. */
  TEMPORARY_FAILURE: "TEMPORARY_FAILURE",
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

/**
 * Standard API error response shape.
 *
 * @example
 * { "error": "The challenge token has expired.", "code": "CHALLENGE_EXPIRED" }
 */
export interface ApiErrorResponse {
  /** Human-readable message safe to display to the user. */
  error: string;
  /** Stable machine-readable code the frontend uses for recovery logic. */
  code: ErrorCode;
  /** ISO timestamp of when the rate limit resets (only present on 429). */
  reset?: number;
}

/**
 * Build a standard error response body.
 */
export function apiError(
  code: ErrorCode,
  message: string,
  extra?: Partial<ApiErrorResponse>,
): ApiErrorResponse {
  return { error: message, code, ...extra };
}

/**
 * Frontend-friendly messages keyed by error code.
 * Import this in the frontend unlock client to map codes to UI copy.
 */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  MISSING_FIELDS: "Some required fields are missing. Please check your request.",
  METHOD_NOT_ALLOWED: "This action is not supported.",
  CHALLENGE_EXPIRED: "Your session has expired. Click Decrypt Content to try again.",
  CHALLENGE_INVALID: "The unlock session is no longer valid. Click Decrypt Content to start over.",
  INVALID_SIGNATURE: "Wallet signature did not match. Open your wallet and try signing again.",
  ACCESS_NOT_PURCHASED: "You have not purchased access to this prompt. Complete a purchase first.",
  RATE_LIMIT_IP: "Too many requests. Please wait a moment, then try again.",
  RATE_LIMIT_WALLET: "Too many unlock attempts for this wallet. Please wait a minute and try again.",
  CONFIGURATION_ERROR: "Something went wrong on our end. Please try again later.",
  INTEGRITY_FAILURE: "Prompt content could not be verified. Please contact support if this persists.",
  TEMPORARY_FAILURE: "A temporary error occurred. Please try again in a moment.",
};

export type UnlockErrorCategory = "wallet" | "access" | "server";

/**
 * Classify an unlock error message as a wallet issue, access/permission issue, or server error.
 * Used by the UI to show appropriate recovery guidance.
 */
export function classifyUnlockError(message: string): UnlockErrorCategory {
  const lower = message.toLowerCase();

  const accessPhrases = [
    "not purchased",
    "access to this prompt",
    "purchase access",
  ];
  if (accessPhrases.some((p) => lower.includes(p))) return "access";

  const walletPhrases = [
    "wallet",
    "signing",
    "signature",
    "session",
    "unlock session",
    "sign",
    "extension",
    "rejected",
    "cancelled",
    "wrong network",
    "insufficient",
    "balance",
    "transaction failed",
    "timed out",
    "connection",
  ];
  if (walletPhrases.some((p) => lower.includes(p))) return "wallet";

  return "server";
}
