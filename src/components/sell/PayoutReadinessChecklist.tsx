/**
 * PayoutReadinessChecklist - Interactive checklist component for creator payout setup
 */

import React from "react";
import { Link } from "react-router-dom";
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  ExternalLink,
  Wallet,
  CreditCard,
  User,
  Coins,
  ChevronRight,
  RefreshCw,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { usePayoutReadiness } from "@/hooks/usePayoutReadiness";
import type { PayoutReadinessCheck } from "@/lib/validation/payoutReadiness";

interface PayoutReadinessChecklistProps {
  showTitle?: boolean;
  className?: string;
  onRefresh?: () => void;
}

const statusConfig = {
  pass: {
    icon: CheckCircle2,
    color: "text-emerald-400",
    bgColor: "bg-emerald-500/10",
    borderColor: "border-emerald-400/20",
    badgeVariant: "secondary" as const,
    badgeColor: "bg-emerald-500/20 text-emerald-300",
  },
  fail: {
    icon: XCircle,
    color: "text-red-400",
    bgColor: "bg-red-500/10",
    borderColor: "border-red-400/20",
    badgeVariant: "destructive" as const,
    badgeColor: "bg-red-500/20 text-red-300",
  },
  warn: {
    icon: AlertTriangle,
    color: "text-amber-400",
    bgColor: "bg-amber-500/10",
    borderColor: "border-amber-400/20",
    badgeVariant: "secondary" as const,
    badgeColor: "bg-amber-500/20 text-amber-300",
  },
};

const checkIcons = {
  "wallet-connection": Wallet,
  "payout-destination": CreditCard,
  "creator-profile": User,
  "settlement-readiness": Coins,
};

interface CheckItemProps {
  check: PayoutReadinessCheck;
  isExpanded: boolean;
  onToggleExpanded: () => void;
}

function CheckItem({ check, isExpanded, onToggleExpanded }: CheckItemProps) {
  const config = statusConfig[check.status];
  const StatusIcon = config.icon;
  const CheckIcon = checkIcons[check.id as keyof typeof checkIcons] || User;
  
  const statusText = {
    pass: "Complete",
    fail: "Required",
    warn: "Attention",
  };

  return (
    <div
      className={`rounded-xl border ${config.borderColor} ${config.bgColor} p-4 transition-all duration-200`}
    >
      <div className="flex items-start gap-3">
        <div className="flex-shrink-0">
          <CheckIcon className={`h-5 w-5 ${config.color}`} />
        </div>
        
        <div className="flex-1 min-w-0">
          <div className="flex items-center justify-between gap-3 mb-2">
            <div className="flex items-center gap-2">
              <h3 className="font-semibold text-white text-sm">
                {check.name}
              </h3>
              <Badge 
                variant={config.badgeVariant}
                className={`text-xs ${config.badgeColor}`}
              >
                {statusText[check.status]}
              </Badge>
            </div>
            
            <div className="flex items-center gap-2">
              <StatusIcon className={`h-4 w-4 ${config.color}`} />
              {(check.description || check.actionUrl) && (
                <button
                  onClick={onToggleExpanded}
                  className="text-slate-400 hover:text-white transition-colors"
                  aria-label={isExpanded ? "Collapse details" : "Expand details"}
                >
                  <ChevronRight 
                    className={`h-4 w-4 transition-transform duration-200 ${
                      isExpanded ? "rotate-90" : ""
                    }`} 
                  />
                </button>
              )}
            </div>
          </div>

          <p className={`text-sm ${check.status === "fail" ? "text-red-200" : check.status === "warn" ? "text-amber-200" : "text-slate-300"}`}>
            {check.message}
          </p>

          {isExpanded && (
            <div className="mt-3 space-y-3 border-t border-white/10 pt-3">
              {check.description && (
                <p className="text-xs text-slate-400 leading-relaxed">
                  {check.description}
                </p>
              )}
              
              {check.actionUrl && check.actionText && (
                <div className="flex justify-end">
                  {check.actionUrl.startsWith("/") ? (
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                    >
                      <Link to={check.actionUrl} className="flex items-center gap-1.5">
                        {check.actionText}
                        <ChevronRight className="h-3 w-3" />
                      </Link>
                    </Button>
                  ) : (
                    <Button
                      asChild
                      size="sm"
                      variant="outline"
                      className="h-8 text-xs"
                    >
                      <a
                        href={check.actionUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-1.5"
                      >
                        {check.actionText}
                        <ExternalLink className="h-3 w-3" />
                      </a>
                    </Button>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export function PayoutReadinessChecklist({ 
  showTitle = true, 
  className = "",
  onRefresh,
}: PayoutReadinessChecklistProps) {
  const { readiness, isLoading, refreshReadiness } = usePayoutReadiness();
  const [expandedChecks, setExpandedChecks] = React.useState<Set<string>>(new Set());

  const toggleExpanded = (checkId: string) => {
    setExpandedChecks(prev => {
      const next = new Set(prev);
      if (next.has(checkId)) {
        next.delete(checkId);
      } else {
        next.add(checkId);
      }
      return next;
    });
  };

  const handleRefresh = () => {
    refreshReadiness();
    onRefresh?.();
  };

  if (isLoading) {
    return (
      <Card className={`border-white/10 bg-slate-950/40 ${className}`}>
        <CardContent className="flex items-center justify-center py-8">
          <div className="flex items-center gap-2 text-slate-400">
            <RefreshCw className="h-4 w-4 animate-spin" />
            <span className="text-sm">Checking payout readiness...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!readiness) {
    return (
      <Card className={`border-white/10 bg-slate-950/40 ${className}`}>
        <CardContent className="py-6">
          <div className="text-center">
            <p className="text-sm text-slate-400 mb-3">
              Unable to check payout readiness
            </p>
            <Button
              onClick={handleRefresh}
              variant="outline"
              size="sm"
              className="gap-2"
            >
              <RefreshCw className="h-4 w-4" />
              Try Again
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  const completedCount = readiness.checks.filter(c => c.status === "pass").length;
  const totalCount = readiness.checks.length;
  const progressPercentage = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  return (
    <Card className={`border-white/10 bg-slate-950/40 ${className}`}>
      {showTitle && (
        <CardHeader className="pb-4">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-lg font-semibold text-white">
                Payout Readiness
              </CardTitle>
              <p className="text-sm text-slate-400 mt-1">
                Complete setup to publish paid prompts
              </p>
            </div>
            <Button
              onClick={handleRefresh}
              variant="ghost"
              size="sm"
              className="gap-2 text-slate-400 hover:text-white"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </Button>
          </div>

          {/* Progress Bar */}
          <div className="mt-4">
            <div className="flex items-center justify-between text-xs mb-2">
              <span className="text-slate-400">
                {completedCount} of {totalCount} checks complete
              </span>
              <span className={`font-semibold ${
                readiness.isReady ? "text-emerald-400" : "text-amber-400"
              }`}>
                {progressPercentage}%
              </span>
            </div>
            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
              <div
                className={`h-full transition-all duration-500 ${
                  readiness.isReady 
                    ? "bg-emerald-400" 
                    : progressPercentage > 0 
                      ? "bg-amber-400" 
                      : "bg-slate-600"
                }`}
                style={{ width: `${progressPercentage}%` }}
              />
            </div>
          </div>

          {/* Status Summary */}
          {readiness.isReady ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-emerald-300">
              <CheckCircle2 className="h-4 w-4" />
              <span>Ready to publish paid prompts!</span>
            </div>
          ) : readiness.blockers.length > 0 ? (
            <div className="mt-4 flex items-center gap-2 text-sm text-red-300">
              <XCircle className="h-4 w-4" />
              <span>{readiness.blockers.length} issue{readiness.blockers.length !== 1 ? "s" : ""} blocking publication</span>
            </div>
          ) : (
            <div className="mt-4 flex items-center gap-2 text-sm text-amber-300">
              <AlertTriangle className="h-4 w-4" />
              <span>Some items need attention</span>
            </div>
          )}
        </CardHeader>
      )}

      <CardContent className="space-y-3">
        {readiness.checks.map((check) => (
          <CheckItem
            key={check.id}
            check={check}
            isExpanded={expandedChecks.has(check.id)}
            onToggleExpanded={() => toggleExpanded(check.id)}
          />
        ))}

        {/* Additional Help */}
        {!readiness.isReady && (
          <div className="mt-6 pt-4 border-t border-white/10">
            <p className="text-xs text-slate-400 mb-3">
              Need help getting set up? 
            </p>
            <div className="flex flex-wrap gap-2">
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-7 text-xs"
              >
                <Link to="/profile">
                  Manage Profile
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-7 text-xs"
              >
                <Link to="/profile/payout-settings">
                  Payout Settings
                </Link>
              </Button>
              <Button
                asChild
                variant="outline"
                size="sm"
                className="h-7 text-xs"
              >
                <a
                  href="https://stellar.org/developers/reference/testnet"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1"
                >
                  Get XLM
                  <ExternalLink className="h-3 w-3" />
                </a>
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}