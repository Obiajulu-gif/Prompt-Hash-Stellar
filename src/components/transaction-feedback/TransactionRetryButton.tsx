import React from "react";
import { useTransactionFeedback } from "./useTransactionFeedback";

export const TransactionRetryButton: React.FC<{ onRetry: () => void; loading?: boolean }> = ({ onRetry, loading }) => (
  <button
    className="px-4 py-2 rounded bg-blue-700 text-white hover:bg-blue-800 disabled:opacity-60"
    onClick={onRetry}
    disabled={loading}
    aria-busy={loading}
  >
    {loading ? "Retrying..." : "Retry"}
  </button>
);
