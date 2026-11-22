import React from "react";
import { useTransactionFeedback } from "./useTransactionFeedback";

interface TransactionErrorBannerProps {
  onRetry?: () => void;
  /**
   * Element to focus after Retry is pressed. Retrying clears the error, which
   * unmounts this banner along with the focused button; without a target,
   * keyboard and screen-reader users are dropped back to the top of the page.
   */
  focusAfterRetry?: React.RefObject<HTMLElement | null>;
}

export const TransactionErrorBanner: React.FC<TransactionErrorBannerProps> = ({
  onRetry,
  focusAfterRetry,
}) => {
  const { status, error, clear } = useTransactionFeedback();
  if (status !== "error" || !error) return null;
  return (
    <div className="rounded-xl bg-red-900/80 text-red-100 px-4 py-2 mb-2 flex items-center gap-4" role="alert">
      <span>{error}</span>
      {onRetry && (
        <button
          type="button"
          className="retry-btn ml-auto px-3 py-1 rounded bg-red-700/80 text-white hover:bg-red-700"
          onClick={() => {
            clear();
            onRetry();
            focusAfterRetry?.current?.focus();
          }}
        >
          Retry
        </button>
      )}
    </div>
  );
};
