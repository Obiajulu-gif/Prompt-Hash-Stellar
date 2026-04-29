import React, { useEffect, useRef } from "react";
import { AlertCircle, CheckCircle, Loader2, X } from "lucide-react";
import { TransactionStatus } from "./TransactionProvider";

interface StatusBannerProps {
  status: TransactionStatus;
  message: string;
  onRetry?: () => void;
  onDismiss?: () => void;
}

export const StatusBanner: React.FC<StatusBannerProps> = ({ status, message, onRetry, onDismiss }) => {
  const retryButtonRef = useRef<HTMLButtonElement>(null);

  // Accessibility: Focus management on error recovery
  useEffect(() => {
    if (status === "error" && retryButtonRef.current) {
      retryButtonRef.current.focus();
    }
  }, [status]);

  if (status === "idle") return null;

  const baseClasses = "rounded-lg p-4 flex items-center gap-3 w-full shadow-sm border transition-all";
  const statusClasses = {
    pending: "bg-blue-900/20 border-blue-500/30 text-blue-200",
    success: "bg-emerald-900/20 border-emerald-500/30 text-emerald-200",
    error: "bg-red-900/20 border-red-500/30 text-red-200",
  };

  const icons = {
    pending: <Loader2 className="animate-spin h-5 w-5 text-blue-400 shrink-0" />,
    success: <CheckCircle className="h-5 w-5 text-emerald-400 shrink-0" />,
    error: <AlertCircle className="h-5 w-5 text-red-400 shrink-0" />
  };

  return (
    <div className={`${baseClasses} ${statusClasses[status]}`} role="alert" aria-live="polite">
      {icons[status]}
      <span className="flex-1 text-sm font-medium">{message}</span>
      {status === "error" && onRetry && (
        <button
          ref={retryButtonRef}
          onClick={onRetry}
          className="retry-btn ml-auto px-3 py-1.5 text-sm font-bold rounded bg-red-500/20 hover:bg-red-500/40 text-red-300 transition-colors outline-none"
        >
          Retry
        </button>
      )}
    </div>
  );
};