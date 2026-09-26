/**
 * PayoutReadinessBanner - Compact banner for payout readiness status
 */

import React from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ChevronRight,
  Settings,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { usePayoutReadiness } from "@/hooks/usePayoutReadiness";

interface PayoutReadinessBannerProps {
  className?: string;
  showWhenReady?: boolean;
}

export function PayoutReadinessBanner({ 
  className = "",
  showWhenReady = false,
}: PayoutReadinessBannerProps) {
  const { readiness, isLoading, shouldBlock } = usePayoutReadiness();

  // Don't show anything while loading
  if (isLoading) {
    return null;
  }

  // Don't show if readiness check failed
  if (!readiness) {
    return null;
  }

  // Don't show if ready and showWhenReady is false
  if (readiness.isReady && !showWhenReady) {
    return null;
  }

  const getStatusConfig = () => {
    if (readiness.isReady) {
      return {
        icon: CheckCircle2,
        bgColor: "bg-emerald-500/10",
        borderColor: "border-emerald-400/20",
        iconColor: "text-emerald-400",
        textColor: "text-emerald-100",
        title: "Payout setup complete",
        description: "You can now publish paid prompts",
      };
    }
    
    if (shouldBlock) {
      return {
        icon: XCircle,
        bgColor: "bg-red-500/10",
        borderColor: "border-red-400/20",
        iconColor: "text-red-400",
        textColor: "text-red-100",
        title: "Payout setup required",
        description: `${readiness.blockers.length} issue${readiness.blockers.length !== 1 ? "s" : ""} blocking paid publication`,
      };
    }

    return {
      icon: AlertTriangle,
      bgColor: "bg-amber-500/10",
      borderColor: "border-amber-400/20",
      iconColor: "text-amber-400",
      textColor: "text-amber-100",
      title: "Payout setup needs attention",
      description: `${readiness.warnings.length} recommendation${readiness.warnings.length !== 1 ? "s" : ""} for better setup`,
    };
  };

  const config = getStatusConfig();
  const StatusIcon = config.icon;

  return (
    <div className={`rounded-2xl border ${config.borderColor} ${config.bgColor} p-4 ${className}`}>
      <div className="flex items-center gap-3">
        <StatusIcon className={`h-5 w-5 ${config.iconColor} flex-shrink-0`} />
        
        <div className="flex-1 min-w-0">
          <h3 className={`text-sm font-semibold ${config.textColor}`}>
            {config.title}
          </h3>
          <p className="text-xs text-slate-400 mt-0.5">
            {config.description}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {readiness.isReady ? (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 text-xs"
            >
              <Link to="/sell" className="flex items-center gap-1.5">
                Create Prompt
                <ChevronRight className="h-3 w-3" />
              </Link>
            </Button>
          ) : (
            <Button
              asChild
              variant="outline"
              size="sm"
              className="h-8 text-xs"
            >
              <Link to="/profile/payout-settings" className="flex items-center gap-1.5">
                <Settings className="h-3 w-3" />
                Fix Setup
              </Link>
            </Button>
          )}
        </div>
      </div>

      {/* Quick issue list for blocking cases */}
      {shouldBlock && readiness.blockers.length > 0 && readiness.blockers.length <= 3 && (
        <div className="mt-3 pt-3 border-t border-white/10">
          <div className="space-y-1">
            {readiness.blockers.slice(0, 3).map((blocker, index) => (
              <div key={index} className="flex items-center gap-2 text-xs text-red-200">
                <span className="w-1 h-1 bg-red-400 rounded-full flex-shrink-0" />
                <span className="truncate">{blocker}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}