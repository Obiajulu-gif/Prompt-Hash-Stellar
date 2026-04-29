import React, { createContext, useContext, useState, useCallback, useEffect, ReactNode } from "react";
import { StatusBanner } from "./StatusBanner";
import "./TransactionProvider.css";

export type TransactionStatus = "idle" | "pending" | "success" | "error";

export interface TransactionState {
  id: string;
  status: TransactionStatus;
  message: string;
  retryAction?: () => void;
}

interface TransactionContextType {
  transactions: TransactionState[];
  addTransaction: (tx: TransactionState) => void;
  updateTransaction: (id: string, updates: Partial<TransactionState>) => void;
  removeTransaction: (id: string) => void;
}

const TransactionContext = createContext<TransactionContextType | undefined>(undefined);

export const TransactionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [transactions, setTransactions] = useState<TransactionState[]>([]);

  const addTransaction = useCallback((tx: TransactionState) => {
    setTransactions((prev) => [...prev, tx]);
  }, []);

  const updateTransaction = useCallback((id: string, updates: Partial<TransactionState>) => {
    setTransactions((prev) =>
      prev.map((tx) => {
        if (tx.id === id) {
          const updated = { ...tx, ...updates };
          return updated;
        }
        return tx;
      })
    );
  }, []);

  const removeTransaction = useCallback((id: string) => {
    setTransactions((prev) => prev.filter((tx) => tx.id !== id));
  }, []);

  // Programmatic accessibility focus check
  useEffect(() => {
    if (transactions.some((tx) => tx.status === "error")) {
      // Allow DOM to finish rendering the Retry button before querying it
      setTimeout(() => {
        const retryBtn = document.querySelector(".retry-btn") as HTMLButtonElement | null;
        if (retryBtn) retryBtn.focus();
      }, 0);
    }
  }, [transactions]);

  return (
    <TransactionContext.Provider value={{ transactions, addTransaction, updateTransaction, removeTransaction }}>
      {children}
      <div className="notification-container">
        {transactions.map((tx) => (
          <div key={tx.id} className={`notification ${tx.status} slide-in`}>
            <StatusBanner
              status={tx.status}
              message={tx.message}
              onRetry={tx.retryAction}
              onDismiss={() => removeTransaction(tx.id)}
            />
          </div>
        ))}
      </div>
    </TransactionContext.Provider>
  );
};

export const useTransactionFeedback = () => {
  const context = useContext(TransactionContext);
  if (!context) {
    throw new Error("useTransactionFeedback must be used within a TransactionProvider");
  }
  return context;
};