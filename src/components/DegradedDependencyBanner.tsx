import React, { useState } from "react";
import { AlertTriangle, AlertCircle, RefreshCw, X, ExternalLink } from "lucide-react";
import { Link } from "react-router-dom";
import { useDegradedServiceStatus } from "../hooks/useDegradedServiceStatus";
import { fallbackManager } from "../lib/observability/degradedServiceFallback";

export const DegradedDependencyBanner: React.FC = () => {
  const { degradedServices, isAnyUnavailable, retryServiceProbes } =
    useDegradedServiceStatus();
  const [dismissed, setDismissed] = useState(false);
  const [retrying, setRetrying] = useState(false);

  if (dismissed || degradedServices.length === 0) {
    return null;
  }

  const handleRetry = async () => {
    setRetrying(true);
    try {
      await retryServiceProbes();
    } finally {
      setRetrying(false);
    }
  };

  const primaryService = degradedServices[0];
  const userMessage = fallbackManager.getFallbackMessage(primaryService.service);

  const containerClasses = isAnyUnavailable
    ? "bg-rose-500/10 border-b border-rose-500/20 text-rose-300"
    : "bg-amber-500/10 border-b border-amber-500/20 text-amber-300";

  const iconClasses = isAnyUnavailable
    ? "text-rose-400 shrink-0 h-5 w-5"
    : "text-amber-400 shrink-0 h-5 w-5";

  const retryButtonClasses = isAnyUnavailable
    ? "bg-rose-500/20 text-rose-300 hover:bg-rose-500/30"
    : "bg-amber-500/20 text-amber-300 hover:bg-amber-500/30";

  return (
    <div
      role="alert"
      aria-live="polite"
      className={`${containerClasses} px-4 py-3 sm:px-6 lg:px-8 transition-colors`}
    >
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-3 min-w-0 flex-1">
          {isAnyUnavailable ? (
            <AlertCircle className={iconClasses} />
          ) : (
            <AlertTriangle className={iconClasses} />
          )}
          <div className="text-sm font-medium leading-relaxed truncate">
            <span>{userMessage}</span>
            {degradedServices.length > 1 && (
              <span className="ml-2 text-xs opacity-75">
                (+{degradedServices.length - 1} other{" "}
                {degradedServices.length - 1 === 1 ? "dependency" : "dependencies"})
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0 ml-auto">
          <Link
            to="/status"
            className="flex items-center gap-1.5 rounded-md px-2.5 py-1 text-xs font-medium hover:underline opacity-80 hover:opacity-100 transition-opacity"
          >
            <span>Status</span>
            <ExternalLink className="h-3.5 w-3.5" />
          </Link>

          <button
            onClick={handleRetry}
            disabled={retrying}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1 text-xs font-semibold ${retryButtonClasses} transition-colors disabled:opacity-50`}
          >
            <RefreshCw className={`h-3.5 w-3.5 ${retrying ? "animate-spin" : ""}`} />
            <span>Retry</span>
          </button>

          <button
            onClick={() => setDismissed(true)}
            aria-label="Dismiss dependency warning"
            className="p-1 rounded-md opacity-70 hover:opacity-100 transition-opacity hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
