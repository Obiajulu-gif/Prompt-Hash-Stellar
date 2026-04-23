import React, { createContext, useContext, useState, useCallback, useMemo, ReactNode } from "react";

export type TransactionStatus = "idle" | "pending" | "success" | "error";

interface TransactionFeedbackContextType {
  status: TransactionStatus;
  error: string | null;
  setStatus: (status: TransactionStatus) => void;
  setError: (error: string | null) => void;
  clear: () => void;
  retry?: () => void;
}

const TransactionFeedbackContext = createContext<TransactionFeedbackContextType | undefined>(undefined);

export const TransactionFeedbackProvider = ({ children }: { children: ReactNode }) => {
  const [status, setStatus] = useState<TransactionStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [retry, setRetry] = useState<(() => void) | undefined>(undefined);

  const clear = useCallback(() => {
    setStatus("idle");
    setError(null);
    setRetry(undefined);
  }, []);

  const contextValue = useMemo(() => ({
    status,
    error,
    setStatus,
    setError,
    clear,
    retry,
  }), [status, error, clear, retry]);

  return (
    <TransactionFeedbackContext.Provider value={contextValue}>
      <div aria-live="polite" aria-atomic="true" className="sr-only">
        {/* Accessible live region for screen readers */}
        {status === "pending" && "Transaction in progress."}
        {status === "success" && "Transaction successful."}
        {status === "error" && error}
      </div>
      {children}
    </TransactionFeedbackContext.Provider>
  );
};

export function useTransactionFeedbackContext() {
  const ctx = useContext(TransactionFeedbackContext);
  if (!ctx) throw new Error("useTransactionFeedbackContext must be used within TransactionFeedbackProvider");
  return ctx;
}
