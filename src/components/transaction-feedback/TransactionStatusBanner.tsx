import React from "react";
import { useTransactionFeedback } from "./useTransactionFeedback";

export const TransactionStatusBanner: React.FC = () => {
  const { status, error } = useTransactionFeedback();
  if (status === "idle") return null;
  if (status === "pending")
    return (
      <div className="rounded-xl bg-blue-900/80 text-blue-100 px-4 py-2 mb-2" role="status">
        Transaction in progress...
      </div>
    );
  if (status === "success")
    return (
      <div className="rounded-xl bg-emerald-900/80 text-emerald-100 px-4 py-2 mb-2" role="status">
        Transaction successful!
      </div>
    );
  if (status === "error")
    return (
      <div className="rounded-xl bg-red-900/80 text-red-100 px-4 py-2 mb-2" role="alert">
        {error || "Transaction failed."}
      </div>
    );
  return null;
};
