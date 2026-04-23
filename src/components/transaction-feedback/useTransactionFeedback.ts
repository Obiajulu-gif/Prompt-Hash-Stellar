import { useTransactionFeedbackContext } from "./TransactionFeedbackProvider";

export function useTransactionFeedback() {
  return useTransactionFeedbackContext();
}
