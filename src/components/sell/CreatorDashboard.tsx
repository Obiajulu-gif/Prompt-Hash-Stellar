import React from "react";
import { BarChart3, AlertCircle, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DashboardStats {
  totalListings: number;
  totalSales: number;
  totalRevenue: string;
  activeListings: number;
}

interface CreatorDashboardProps {
  stats: DashboardStats;
  isLoading: boolean;
  isError: boolean;
  onRefresh: () => Promise<void>;
}

export function CreatorDashboard({
  stats,
  isLoading,
  isError,
  onRefresh,
}: CreatorDashboardProps) {
  const [isRefreshing, setIsRefreshing] = React.useState(false);

  const handleRefresh = async () => {
    setIsRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setIsRefreshing(false);
    }
  };

  if (isLoading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-8 space-y-6">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-slate-400" />
          <h3 className="text-lg font-semibold text-white">Dashboard</h3>
        </div>
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-6 w-6 text-slate-400 animate-spin" />
          <span className="ml-3 text-slate-400">Loading dashboard...</span>
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="rounded-2xl border border-red-400/20 bg-red-500/10 p-6">
        <div className="flex items-start gap-3">
          <AlertCircle className="h-5 w-5 text-red-400 shrink-0 mt-0.5" />
          <div className="flex-1">
            <h3 className="font-semibold text-red-300 mb-1">Failed to load dashboard</h3>
            <p className="text-sm text-red-200 mb-4">
              We encountered an error loading your dashboard. Please try again.
            </p>
            <Button
              size="sm"
              className="bg-red-600 hover:bg-red-700 text-white"
              onClick={handleRefresh}
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Retrying...
                </>
              ) : (
                <>
                  <RefreshCw className="h-4 w-4 mr-2" />
                  Retry
                </>
              )}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-emerald-400/20 bg-emerald-500/5 p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-emerald-400" />
          <h3 className="text-lg font-semibold text-white">Sales Overview</h3>
        </div>
        <Button
          size="sm"
          variant="outline"
          className="border-emerald-400/20 hover:border-emerald-400/40 hover:bg-emerald-500/10"
          onClick={handleRefresh}
          disabled={isRefreshing}
        >
          {isRefreshing ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
            </>
          ) : (
            <>
              <RefreshCw className="h-4 w-4" />
            </>
          )}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-lg bg-slate-900/50 p-4 border border-emerald-400/10">
          <p className="text-xs uppercase tracking-[0.15em] text-slate-500 mb-2">
            Listings
          </p>
          <p className="text-2xl font-bold text-emerald-300">
            {stats.totalListings}
          </p>
        </div>

        <div className="rounded-lg bg-slate-900/50 p-4 border border-emerald-400/10">
          <p className="text-xs uppercase tracking-[0.15em] text-slate-500 mb-2">
            Active
          </p>
          <p className="text-2xl font-bold text-emerald-300">
            {stats.activeListings}
          </p>
        </div>

        <div className="rounded-lg bg-slate-900/50 p-4 border border-emerald-400/10">
          <p className="text-xs uppercase tracking-[0.15em] text-slate-500 mb-2">
            Total Sales
          </p>
          <p className="text-2xl font-bold text-emerald-300">
            {stats.totalSales}
          </p>
        </div>

        <div className="rounded-lg bg-slate-900/50 p-4 border border-emerald-400/10">
          <p className="text-xs uppercase tracking-[0.15em] text-slate-500 mb-2">
            Revenue
          </p>
          <p className="text-2xl font-bold text-emerald-300">
            {stats.totalRevenue}
          </p>
        </div>
      </div>
    </div>
  );
}
