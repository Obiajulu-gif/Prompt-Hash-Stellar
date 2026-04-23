import { useTransactionFeedbackContext } from "./TransactionFeedbackProvider";

/**
 * Public hook for accessing transaction feedback functionality.
 * Wraps the context hook to provide a stable, cleaner API surface for consumers.
 */
export function useTransactionFeedback() {
  return useTransactionFeedbackContext();
}
