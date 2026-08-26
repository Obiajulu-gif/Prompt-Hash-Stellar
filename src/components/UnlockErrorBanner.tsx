import React from "react";
import { AlertCircle, LockKeyhole, Wallet } from "lucide-react";
import { classifyUnlockError } from "@/lib/api/errorCodes";

interface UnlockErrorBannerProps {
  message: string;
  onRetry?: () => void;
}

export const UnlockErrorBanner: React.FC<UnlockErrorBannerProps> = ({ message, onRetry }) => {
  const category = classifyUnlockError(message);

  const config = {
    wallet: {
      icon: <Wallet className="h-4 w-4 shrink-0 text-amber-400" />,
      label: "Wallet issue",
      classes: "bg-amber-900/20 border-amber-500/30 text-amber-200",
      labelClass: "text-amber-400",
      retryClass: "bg-amber-500/20 hover:bg-amber-500/40 text-amber-300",
    },
    access: {
      icon: <LockKeyhole className="h-4 w-4 shrink-0 text-red-400" />,
      label: "Access denied",
      classes: "bg-red-900/20 border-red-500/30 text-red-200",
      labelClass: "text-red-400",
      retryClass: "bg-red-500/20 hover:bg-red-500/40 text-red-300",
    },
    server: {
      icon: <AlertCircle className="h-4 w-4 shrink-0 text-slate-400" />,
      label: "Temporary error",
      classes: "bg-slate-800/60 border-slate-500/30 text-slate-300",
      labelClass: "text-slate-400",
      retryClass: "bg-slate-500/20 hover:bg-slate-500/40 text-slate-300",
    },
  }[category];

  return (
    <div
      className={`rounded-lg p-4 border flex items-start gap-3 w-full ${config.classes}`}
      role="alert"
      aria-live="polite"
    >
      {config.icon}
      <div className="flex-1 min-w-0">
        <p className={`text-xs font-semibold uppercase tracking-wide mb-1 ${config.labelClass}`}>
          {config.label}
        </p>
        <p className="text-sm">{message}</p>
      </div>
      {onRetry && (
        <button
          onClick={onRetry}
          className={`ml-2 shrink-0 px-3 py-1.5 text-sm font-bold rounded transition-colors ${config.retryClass}`}
        >
          Retry
        </button>
      )}
    </div>
  );
};
