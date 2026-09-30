/**
 * Bulk purchase error handling and per-item error surfacing.
 * Issue #438: Clear error messages for atomicity failures.
 *
 * Uses i18n keys for user-facing messages; backend logs stay in English.
 */

import { BULK_PURCHASE_ERROR_KEYS } from "../i18n/serverMessages";

/**
 * Maps validation results to user-friendly error messages.
 * Helps creators understand why specific items failed.
 */
export interface BulkPurchaseValidationError {
  promptId: bigint;
  reason: string;
}

/**
 * Determine why a specific item failed validation.
 * Frontend can use this to provide targeted guidance to the user.
 */
export function describeValidationFailure(
  promptId: bigint,
  isValid: boolean,
  reasons?: {
    alreadyPurchased?: boolean;
    insufficientBalance?: boolean;
    inactive?: boolean;
    notFound?: boolean;
    insufficientPayment?: boolean;
  },
): BulkPurchaseValidationError | null {
  if (isValid) return null;

  let reason = "validationErrors.unknown";

  if (reasons?.notFound) {
    reason = "validationErrors.promptNotFound";
  } else if (reasons?.alreadyPurchased) {
    reason = "validationErrors.alreadyPurchased";
  } else if (reasons?.insufficientBalance) {
    reason = "validationErrors.insufficientBalance";
  } else if (reasons?.inactive) {
    reason = "validationErrors.promptInactive";
  } else if (reasons?.insufficientPayment) {
    reason = "validationErrors.insufficientPayment";
  }

  return { promptId, reason };
}

/**
 * Contract error code to i18n key mapping for bulk purchases.
 * When a bulk purchase fails, these error codes map to localized messages.
 */
export const BULK_PURCHASE_ERROR_CODES: Record<string, string> = {
  PromptNotFound: BULK_PURCHASE_ERROR_KEYS.PROMPT_NOT_FOUND,
  AlreadyPurchased: BULK_PURCHASE_ERROR_KEYS.ALREADY_PURCHASED,
  CreatorCannotBuy: BULK_PURCHASE_ERROR_KEYS.CREATOR_CANNOT_BUY,
  PromptInactive: BULK_PURCHASE_ERROR_KEYS.PROMPT_INACTIVE,
  InvalidPaymentAmount: BULK_PURCHASE_ERROR_KEYS.INVALID_PAYMENT_AMOUNT,
  ListingExpired: BULK_PURCHASE_ERROR_KEYS.LISTING_EXPIRED,
  ContractIsPaused: BULK_PURCHASE_ERROR_KEYS.CONTRACT_IS_PAUSED,
  BulkPurchaseTooLarge: BULK_PURCHASE_ERROR_KEYS.BULK_PURCHASE_TOO_LARGE,
  DuplicatePromptId: BULK_PURCHASE_ERROR_KEYS.DUPLICATE_PROMPT_ID,
  InvalidPrice: BULK_PURCHASE_ERROR_KEYS.INVALID_PRICE,
  ArithmeticOverflow: BULK_PURCHASE_ERROR_KEYS.ARITHMETIC_OVERFLOW,
};

/**
 * Helper to provide user-friendly guidance when bulk purchase fails.
 * Returns i18n keys for title, message, and suggestion.
 * Frontend localizes these keys via i18next.
 */
export function interpretBulkPurchaseError(errorCode: string): {
  titleKey: string;
  messageKey: string;
  suggestionKey: string;
} {
  const baseKey =
    BULK_PURCHASE_ERROR_CODES[errorCode] ||
    BULK_PURCHASE_ERROR_KEYS.PROMPT_NOT_FOUND;

  return {
    titleKey: `${baseKey}.title`,
    messageKey: `${baseKey}.message`,
    suggestionKey: `${baseKey}.suggestion`,
  };
}
