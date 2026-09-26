import {
  ErrorCode,
  classifyUnlockError,
  type UnlockErrorCategory,
} from "@/lib/api/errorCodes";

/** Reserved code used when the API response does not carry a stable code. */
export const NETWORK_ERROR_CODE = "NETWORK_ERROR";

export type UnlockErrorCode =
  | (typeof ErrorCode)[keyof typeof ErrorCode]
  | typeof NETWORK_ERROR_CODE;

export interface UnlockErrorMeta {
  code: UnlockErrorCode;
  category: UnlockErrorCategory;
  retryable: boolean;
  /** i18n key under `unlockErrors.codes`, e.g. `ACCESS_NOT_PURCHASED`. */
  i18nKey: string;
}

const UNLOCK_ERROR_META: Record<UnlockErrorCode, Omit<UnlockErrorMeta, "code">> = {
  MISSING_FIELDS: { category: "server", retryable: false, i18nKey: "MISSING_FIELDS" },
  METHOD_NOT_ALLOWED: { category: "server", retryable: false, i18nKey: "METHOD_NOT_ALLOWED" },
  CHALLENGE_EXPIRED: { category: "wallet", retryable: true, i18nKey: "CHALLENGE_EXPIRED" },
  CHALLENGE_INVALID: { category: "wallet", retryable: true, i18nKey: "CHALLENGE_INVALID" },
  INVALID_SIGNATURE: { category: "wallet", retryable: true, i18nKey: "INVALID_SIGNATURE" },
  ACCESS_NOT_PURCHASED: { category: "access", retryable: false, i18nKey: "ACCESS_NOT_PURCHASED" },
  STALE_PROMPT_TERMS: { category: "access", retryable: true, i18nKey: "STALE_PROMPT_TERMS" },
  RATE_LIMIT_IP: { category: "server", retryable: true, i18nKey: "RATE_LIMIT_IP" },
  RATE_LIMIT_WALLET: { category: "server", retryable: true, i18nKey: "RATE_LIMIT_WALLET" },
  CONFIGURATION_ERROR: { category: "server", retryable: false, i18nKey: "CONFIGURATION_ERROR" },
  INTEGRITY_FAILURE: { category: "server", retryable: false, i18nKey: "INTEGRITY_FAILURE" },
  TEMPORARY_FAILURE: { category: "server", retryable: true, i18nKey: "TEMPORARY_FAILURE" },
  IDEMPOTENCY_CONFLICT: { category: "server", retryable: false, i18nKey: "IDEMPOTENCY_CONFLICT" },
  [NETWORK_ERROR_CODE]: { category: "server", retryable: true, i18nKey: "NETWORK_ERROR" },
};

export function getUnlockErrorMeta(code: unknown): UnlockErrorMeta | null {
  if (typeof code !== "string") return null;
  const entry = UNLOCK_ERROR_META[code as UnlockErrorCode];
  if (!entry) return null;
  return { code: code as UnlockErrorCode, ...entry };
}

export function isUnlockErrorCode(code: unknown): code is UnlockErrorCode {
  return getUnlockErrorMeta(code) !== null;
}

interface UnlockErrorOptions {
  code: UnlockErrorCode;
  message: string;
  correlationId?: string;
}

/**
 * Structured unlock failure carrying the stable API error code, correlation
 * id for support, and a category + retry hint derived from the code. The
 * UI renders it with localized copy instead of English substring matching.
 */
export class UnlockError extends Error {
  readonly code: UnlockErrorCode;
  readonly category: UnlockErrorCategory;
  readonly retryable: boolean;
  readonly correlationId?: string;

  constructor(options: UnlockErrorOptions) {
    super(options.message);
    this.name = "UnlockError";
    this.code = options.code;
    this.correlationId = options.correlationId;
    const meta = getUnlockErrorMeta(options.code);
    this.category = meta?.category ?? classifyUnlockError(options.message);
    this.retryable = meta?.retryable ?? true;
  }
}