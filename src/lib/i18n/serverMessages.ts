/**
 * Server-side message keys and utilities for marketplace localization.
 * Backend logs stay in English; user-facing messages use i18n keys.
 *
 * Pattern: Export message key constants and lookup functions.
 * Frontend fetches these keys and translates via i18next.
 */

import { ErrorCode } from '../api/errorCodes';

/**
 * Receipt error message keys
 */
export const RECEIPT_ERROR_KEYS = {
  NOT_FOUND: 'receiptErrors.notFound',
  CONFIG_MISSING: 'receiptErrors.configMissing',
  BUILD_FAILED: 'receiptErrors.buildFailed',
} as const;

/**
 * Review validation error message keys
 */
export const REVIEW_ERROR_KEYS = {
  MISSING_FIELDS: 'reviewErrors.missingFields',
  SIGNATURE_REQUIRED: 'reviewErrors.signatureRequired',
  INVALID_RATING: 'reviewErrors.invalidRating',
  TEXT_TOO_SHORT: 'reviewErrors.textTooShort',
  TEXT_TOO_LONG: 'reviewErrors.textTooLong',
  INVALID_SIGNATURE: 'reviewErrors.invalidSignature',
  ACCESS_DENIED: 'reviewErrors.accessDenied',
  METHOD_NOT_ALLOWED: 'reviewErrors.methodNotAllowed',
} as const;

/**
 * Moderation status and reason keys (for UI display)
 */
export const MODERATION_KEYS = {
  STATUS: {
    RESTRICTED: 'moderationStatuses.restricted',
    ACTIVE: 'moderationStatuses.active',
    RETIRED: 'moderationStatuses.retired',
  },
  REASON: {
    COPYRIGHT: 'moderationReasons.copyright',
    ABUSE: 'moderationReasons.abuse',
    MALWARE: 'moderationReasons.malware',
    POLICY_VIOLATION: 'moderationReasons.policy_violation',
    OTHER: 'moderationReasons.other',
  },
} as const;

/**
 * Purchase status and dispute resolution keys
 */
export const PURCHASE_KEYS = {
  STATUS: {
    PURCHASED: 'purchaseStatuses.purchased',
    DISPUTED: 'purchaseStatuses.disputed',
    RESOLVED: 'purchaseStatuses.resolved',
  },
  RESOLUTION: {
    REFUNDED: 'disputeResolutions.refunded',
    REJECTED: 'disputeResolutions.rejected',
  },
} as const;

/**
 * Bulk purchase error keys
 */
export const BULK_PURCHASE_ERROR_KEYS = {
  PROMPT_NOT_FOUND: 'bulkPurchaseErrors.PromptNotFound',
  ALREADY_PURCHASED: 'bulkPurchaseErrors.AlreadyPurchased',
  CREATOR_CANNOT_BUY: 'bulkPurchaseErrors.CreatorCannotBuy',
  PROMPT_INACTIVE: 'bulkPurchaseErrors.PromptInactive',
  INVALID_PAYMENT_AMOUNT: 'bulkPurchaseErrors.InvalidPaymentAmount',
  LISTING_EXPIRED: 'bulkPurchaseErrors.ListingExpired',
  CONTRACT_IS_PAUSED: 'bulkPurchaseErrors.ContractIsPaused',
  BULK_PURCHASE_TOO_LARGE: 'bulkPurchaseErrors.BulkPurchaseTooLarge',
  DUPLICATE_PROMPT_ID: 'bulkPurchaseErrors.DuplicatePromptId',
  INVALID_PRICE: 'bulkPurchaseErrors.InvalidPrice',
  ARITHMETIC_OVERFLOW: 'bulkPurchaseErrors.ArithmeticOverflow',
} as const;

/**
 * Validation error keys
 */
export const VALIDATION_ERROR_KEYS = {
  PROMPT_NOT_FOUND: 'validationErrors.promptNotFound',
  ALREADY_PURCHASED: 'validationErrors.alreadyPurchased',
  INSUFFICIENT_BALANCE: 'validationErrors.insufficientBalance',
  PROMPT_INACTIVE: 'validationErrors.promptInactive',
  INSUFFICIENT_PAYMENT: 'validationErrors.insufficientPayment',
} as const;

/**
 * Map an unlock error code to its i18n key.
 * Frontend uses this to localize error messages.
 */
export function getUnlockErrorKey(code: ErrorCode): string {
  return `unlockErrors.codes.${code}`;
}

/**
 * Map a bulk purchase error code to its i18n key.
 * Returns the nested key path for title, message, and suggestion.
 */
export function getBulkPurchaseErrorKey(errorCode: string): {
  title: string;
  message: string;
  suggestion: string;
} {
  const baseKey = (BULK_PURCHASE_ERROR_KEYS as Record<string, string>)[
    Object.keys(BULK_PURCHASE_ERROR_KEYS)
      .find(key => BULK_PURCHASE_ERROR_KEYS[key as keyof typeof BULK_PURCHASE_ERROR_KEYS] === errorCode)
  ] || 'bulkPurchaseErrors.PromptNotFound';

  return {
    title: `${baseKey}.title`,
    message: `${baseKey}.message`,
    suggestion: `${baseKey}.suggestion`,
  };
}

/**
 * Map moderation action to status key.
 * Called server-side to determine the i18n key for the new status.
 */
export function mapActionToStatusKey(action: string): string {
  switch (action) {
    case 'restrict':
      return MODERATION_KEYS.STATUS.RESTRICTED;
    case 'reinstate':
      return MODERATION_KEYS.STATUS.ACTIVE;
    case 'retire':
      return MODERATION_KEYS.STATUS.RETIRED;
    default:
      throw new Error(`Invalid moderation action: ${action}`);
  }
}

/**
 * Map moderation reason to i18n key.
 */
export function mapReasonToKey(reason: string): string {
  switch (reason) {
    case 'copyright':
      return MODERATION_KEYS.REASON.COPYRIGHT;
    case 'abuse':
      return MODERATION_KEYS.REASON.ABUSE;
    case 'malware':
      return MODERATION_KEYS.REASON.MALWARE;
    case 'policy_violation':
      return MODERATION_KEYS.REASON.POLICY_VIOLATION;
    case 'other':
      return MODERATION_KEYS.REASON.OTHER;
    default:
      return MODERATION_KEYS.REASON.OTHER;
  }
}
