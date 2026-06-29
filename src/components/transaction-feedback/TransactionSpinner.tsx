import React from "react";
import { Loader2 } from "lucide-react";
import { useTransactionFeedback } from "./useTransactionFeedback";

export const TransactionSpinner: React.FC<{ label?: string }> = ({ label }) => {
  const { status } = useTransactionFeedback();
  if (status !== "pending") return null;
  return (
    <div className="flex items-center gap-2" aria-live="polite" aria-busy="true">
      <Loader2 className="animate-spin h-5 w-5 text-blue-300" />
      <span>{label || "Processing..."}</span>
    </div>
  );
};
