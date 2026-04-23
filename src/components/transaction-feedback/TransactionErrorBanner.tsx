import React from "react";
import { useTransactionFeedback } from "./useTransactionFeedback";

export const TransactionErrorBanner: React.FC<{ onRetry?: () => void }> = ({ onRetry }) => {
  const { status, error, clear } = useTransactionFeedback();
  if (status !== "error" || !error) return null;
  return (
    <div className="rounded-xl bg-red-900/80 text-red-100 px-4 py-2 mb-2 flex items-center gap-4" role="alert">
      <span>{error}</span>
      {onRetry && (
        <button type="button" className="retry-btn ml-auto px-3 py-1 rounded bg-red-700/80 text-white hover:bg-red-700" onClick={() => { clear(); onRetry(); }}>
          Retry
        </button>
      )}
    </div>
  );
};
