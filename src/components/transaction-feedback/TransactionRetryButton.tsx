import React from "react";

/**
 * While a retry is in flight the button stays focusable (aria-disabled rather
 * than disabled): a natively disabled button drops keyboard focus to <body>,
 * so the user would lose their place right when the retry fails again.
 */
export const TransactionRetryButton: React.FC<{ onRetry: () => void; loading?: boolean }> = ({ onRetry, loading = false }) => (
  <button
    type="button"
    className="px-4 py-2 rounded bg-blue-700 text-white hover:bg-blue-800 aria-disabled:opacity-60 aria-disabled:cursor-not-allowed"
    onClick={() => {
      if (!loading) onRetry();
    }}
    aria-disabled={loading}
    aria-busy={loading}
  >
    {loading ? "Retrying..." : "Retry"}
  </button>
);
