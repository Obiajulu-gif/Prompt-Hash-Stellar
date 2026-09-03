import { useQuery } from "@tanstack/react-query";
import {
  BarChart3,
  PackageX,
  RefreshCcw,
  ShieldCheck,
  Star,
  TrendingUp,
  Users,
} from "lucide-react";
import { Skeleton } from "@/components/Skeleton";
import { Badge } from "@/components/ui/badge";
import type { SellerAnalytics } from "@/lib/analytics/sellerAnalytics";

const fmtPct = (value: number | null) =>
  value === null ? "—" : `${(value * 100).toFixed(1)}%`;

interface SellerAnalyticsFetchResponse {
  success: boolean;
  analytics: SellerAnalytics | null;
  error?: string;
}

async function fetchSellerAnalytics(
  walletAddress: string,
): Promise<SellerAnalytics | null> {
  const response = await fetch(
    `/api/prompts/creator/${encodeURIComponent(walletAddress)}/analytics/support-metrics`,
  );
  if (!response.ok) return null;
  const body = (await response.json()) as SellerAnalyticsFetchResponse;
  return body.success ? body.analytics : null;
}

const pctToTone = (value: number | null) => {
  if (value === null) return "slate";
  if (value >= 0.5) return "emerald";
  if (value >= 0.2) return "amber";
  return "rose";
};

const toneClasses: Record<string, string> = {
  emerald: "border-emerald-400/30 bg-emerald-400/10 text-emerald-200",
  amber: "border-amber-400/30 bg-amber-400/10 text-amber-200",
  rose: "border-rose-400/30 bg-rose-400/10 text-rose-200",
  slate: "border-white/10 bg-white/[0.04] text-slate-300",
};

function MetricTile({
  label,
  value,
  tone,
  icon,
  description,
}: {
  label: string;
  value: string;
  tone: string;
  icon: React.ReactNode;
  description: string;
}) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center gap-2">
        {icon}
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {label}
        </p>
      </div>
      <div className="mt-2 flex items-baseline gap-2">
        <span className="text-2xl font-bold tabular-nums text-white">{value}</span>
        <Badge className={toneClasses[tone]}>
          {tone === "emerald"
            ? "Healthy"
            : tone === "rose"
              ? "At risk"
              : tone === "amber"
                ? "Watch"
                : "No data"}
        </Badge>
      </div>
      <p className="mt-1 text-xs text-slate-500">{description}</p>
    </div>
  );
}

export function SellerAnalyticsWidget({
  walletAddress,
}: {
  walletAddress: string;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ["seller-analytics", walletAddress],
    queryFn: () => fetchSellerAnalytics(walletAddress),
    staleTime: 60_000,
    enabled: Boolean(walletAddress),
  });

  if (isLoading) {
    return (
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        {[...Array(4)].map((_, i) => (
          <div key={i} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-2 h-7 w-14" />
          </div>
        ))}
      </div>
    );
  }

  if (!data) {
    return (
      <div className="rounded-xl border border-dashed border-white/15 bg-white/[0.02] p-6 text-center">
        <BarChart3 className="mx-auto h-5 w-5 text-slate-500" />
        <p className="mt-2 text-sm text-slate-400">
          Conversion &amp; support metrics are computed from off-chain purchases,
          refunds, unlocks, and reviews once data is available.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex items-center gap-2">
          <TrendingUp className="h-4 w-4 text-emerald-300" />
          <h3 className="text-sm font-semibold uppercase tracking-widest text-slate-400">
            Conversion &amp; Support
          </h3>
        </div>
        <Badge className="border-white/10 bg-white/[0.04] text-slate-300">
          <ShieldCheck className="mr-1 h-3 w-3" />
          Buyer identities redacted
        </Badge>
        <Badge className="border-white/10 bg-white/[0.04] text-slate-300">
          <Users className="mr-1 h-3 w-3" />
          {data.cohort.activeBuyers} active buyers
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <MetricTile
          label="Conversion"
          value={fmtPct(data.metrics.conversionRate)}
          tone={pctToTone(data.metrics.conversionRate)}
          icon={<BarChart3 className="h-3.5 w-3.5 text-cyan-200" />}
          description={`${data.totals.purchases} purchases / ${data.totals.views} views`}
        />
        <MetricTile
          label="Refund rate"
          value={fmtPct(data.metrics.refundRate)}
          tone={pctToTone(data.metrics.refundRate)}
          icon={<RefreshCcw className="h-3.5 w-3.5 text-amber-200" />}
          description={`${data.totals.refunds} refunds / ${data.totals.purchases} purchases`}
        />
        <MetricTile
          label="Unlock success"
          value={fmtPct(data.metrics.unlockSuccessRate)}
          tone={pctToTone(data.metrics.unlockSuccessRate)}
          icon={<PackageX className="h-3.5 w-3.5 text-rose-200" />}
          description={`${data.totals.unlockFailures} failures recorded`}
        />
        <MetricTile
          label="Satisfaction"
          value={fmtPct(data.metrics.satisfactionRate)}
          tone={data.metrics.averageRating === null ? "slate" : "emerald"}
          icon={<Star className="h-3.5 w-3.5 text-amber-200" />}
          description={
            data.metrics.averageRating === null
              ? `${data.totals.reviews} reviews`
              : `${data.metrics.averageRating.toFixed(1)} avg rating · ${data.totals.reviews}`
          }
        />
      </div>

      {Object.keys(data.unlockFailuresByReason).length > 0 && (
        <div className="flex flex-wrap gap-2">
          {Object.entries(data.unlockFailuresByReason).map(([reason, count]) => (
            <Badge
              key={reason}
              className="border-rose-400/20 bg-rose-400/[0.07] text-rose-200"
            >
              {reason}: {count}
            </Badge>
          ))}
        </div>
      )}

      <p className="text-xs text-slate-500">
        Metrics are aggregated across a {data.windowDays}-day window. Individual
        buyer identities are never returned or stored in analytics output.
      </p>
    </div>
  );
}