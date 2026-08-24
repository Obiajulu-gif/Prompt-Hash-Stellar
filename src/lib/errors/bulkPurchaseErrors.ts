/**
 * Bulk purchase error handling and per-item error surfacing.
 * Issue #438: Clear error messages for atomicity failures.
 */

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

  let reason = "Unknown error";

  if (reasons?.notFound) {
    reason = "Prompt does not exist or has been removed";
  } else if (reasons?.alreadyPurchased) {
    reason = "You already own this prompt";
  } else if (reasons?.insufficientBalance) {
    reason = "Insufficient balance to complete all purchases";
  } else if (reasons?.inactive) {
    reason = "This prompt is no longer for sale";
  } else if (reasons?.insufficientPayment) {
    reason = "Payment amount is below the prompt price";
  }

  return { promptId, reason };
}

/**
 * Contract error code documentation for bulk purchases.
 * When a bulk purchase fails, these error codes explain why.
 */
export const BULK_PURCHASE_ERROR_CODES: Record<string, string> = {
  PromptNotFound:
    "One or more prompts in the batch do not exist or have been archived.",
  AlreadyPurchased:
    "You have already purchased one of these prompts. You cannot buy the same prompt twice.",
  CreatorCannotBuy:
    "You cannot purchase prompts you created. Try a different batch.",
  PromptInactive:
    "One or more prompts are no longer for sale. Check their status and try again.",
  InvalidPaymentAmount:
    "The payment for one or more prompts is insufficient. Recalculate prices and retry.",
  ListingExpired:
    "One or more prompts have reached their expiration date and are no longer available.",
  ContractIsPaused:
    "The marketplace is temporarily paused. Please try again later.",
  BulkPurchaseTooLarge:
    "Your batch size exceeds the maximum allowed (20 prompts per transaction). Split into smaller batches.",
  DuplicatePromptId:
    "The same prompt ID appears multiple times in the batch. Remove duplicates and retry.",
  InvalidPrice:
    "The number of payment amounts does not match the number of prompts. Both lists must be equal length.",
  ArithmeticOverflow:
    "One or more prices are too large to process. Contact support if this persists.",
};

/**
 * Helper to provide user-friendly guidance when bulk purchase fails.
 * Splits error into: what went wrong + how to fix it.
 */
export function interpretBulkPurchaseError(errorCode: string): {
  title: string;
  message: string;
  suggestion: string;
} {
  const description = BULK_PURCHASE_ERROR_CODES[errorCode] || "";

  if (errorCode === "BulkPurchaseTooLarge") {
    return {
      title: "Batch Too Large",
      message: description,
      suggestion:
        "Try purchasing in groups of 10-15 prompts per transaction for better success rates.",
    };
  }

  if (errorCode === "PromptNotFound" || errorCode === "AlreadyPurchased") {
    return {
      title: "Batch Contains Invalid Items",
      message: description,
      suggestion:
        "Use the validation tool to check each item before retrying. Remove invalid items and purchase the rest.",
    };
  }

  if (errorCode === "InvalidPaymentAmount" || errorCode === "InvalidPrice") {
    return {
      title: "Payment Mismatch",
      message: description,
      suggestion:
        "Ensure each prompt price is paid in full. Recalculate totals and retry.",
    };
  }

  if (errorCode === "ContractIsPaused") {
    return {
      title: "Marketplace Temporarily Paused",
      message: description,
      suggestion: "Check back in a few moments and try again.",
    };
  }

  return {
    title: "Purchase Failed",
    message: description || "An error occurred during the bulk purchase.",
    suggestion:
      "Try again with a smaller batch or individual purchases. Contact support if the problem persists.",
  };
}
