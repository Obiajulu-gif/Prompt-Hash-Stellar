import { useQuery } from "@tanstack/react-query";
import { Zap, PackagePlus, RefreshCw, ShoppingBag, Clock } from "lucide-react";
import { getRecentPurchases } from "@/lib/stellar/promptHashClient";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { UserAvatar } from "@/components/UserAvatar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ActivityType = "new_listing" | "update" | "sale";

interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  category: string;
  actor: string; // truncated wallet address or display name
  timestamp: string; // ISO-8601
  priceXlm?: string;
}

// ---------------------------------------------------------------------------
// Mock data — replace with a real contract query when available
// ---------------------------------------------------------------------------

async function fetchActivityFeed(): Promise<ActivityItem[]> {
  try {
    const events = await getRecentPurchases(browserStellarConfig, 10);
    // Since getRecentPurchases might return an empty array if no events match, we could fallback 
    // to a single mock item just to show something in development, but per requirements we just return events
    return events as ActivityItem[];
  } catch (error) {
    console.error("Error fetching activity feed:", error);
    return [];
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const typeConfig: Record<
  ActivityType,
  { label: string; icon: React.ReactNode; color: string; bg: string; border: string }
> = {
  new_listing: {
    label: "New listing",
    icon: <PackagePlus className="h-3.5 w-3.5" />,
    color: "text-emerald-400",
    bg: "bg-emerald-500/10",
    border: "border-emerald-500/20",
  },
  update: {
    label: "Updated",
    icon: <RefreshCw className="h-3.5 w-3.5" />,
    color: "text-blue-400",
    bg: "bg-blue-500/10",
    border: "border-blue-500/20",
  },
  sale: {
    label: "Sold",
    icon: <ShoppingBag className="h-3.5 w-3.5" />,
    color: "text-violet-400",
    bg: "bg-violet-500/10",
    border: "border-violet-500/20",
  },
};

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function ActivitySkeleton() {
  return (
    <div className="space-y-3 animate-pulse">
      {Array.from({ length: 5 }).map((_, i) => (
        <div key={i} className="flex items-start gap-3 py-3 border-b border-white/5 last:border-0">
          <div className="mt-0.5 h-7 w-7 shrink-0 rounded-full bg-white/10" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-3/4 rounded bg-white/10" />
            <div className="h-3 w-1/2 rounded bg-white/5" />
          </div>
          <div className="h-3 w-10 rounded bg-white/5" />
        </div>
      ))}
    </div>
  );
}

function ActivityEmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-10 text-center gap-3">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5">
        <Zap className="h-5 w-5 text-slate-500" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">No recent activity</p>
        <p className="mt-1 text-xs text-slate-500">
          New listings and sales will appear here.
        </p>
      </div>
    </div>
  );
}

function ActivityRow({ item }: { item: ActivityItem }) {
  const cfg = typeConfig[item.type];
  return (
    <li className="flex items-start gap-3 py-3 border-b border-white/5 last:border-0">
      {/* Icon badge or Avatar */}
      <div className="mt-0.5 relative shrink-0">
        <UserAvatar address={item.actor} size={28} />
        <div
          className={`absolute -bottom-1 -right-1 flex h-4 w-4 items-center justify-center rounded-full border border-[#020617] ${cfg.bg} ${cfg.color}`}
          aria-hidden
        >
          {cfg.icon}
        </div>
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-white leading-snug">
          {item.title}
        </p>
        <p className="mt-0.5 text-xs text-slate-500 truncate">
          <span className={`font-medium ${cfg.color}`}>{cfg.label}</span>
          {" · "}
          {item.category}
          {item.priceXlm ? (
            <> · <span className="text-slate-400">{item.priceXlm} XLM</span></>
          ) : null}
        </p>
        <p className="mt-0.5 text-xs text-slate-600 font-mono">{item.actor}</p>
      </div>

      {/* Timestamp */}
      <span className="shrink-0 text-xs text-slate-600 tabular-nums mt-0.5">
        {relativeTime(item.timestamp)}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

interface MarketplaceActivityFeedProps {
  /** Max number of feed items to display. Defaults to 10. */
  limit?: number;
  className?: string;
}

export function MarketplaceActivityFeed({
  limit = 10,
  className = "",
}: MarketplaceActivityFeedProps) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["marketplace-activity-feed"],
    queryFn: fetchActivityFeed,
    refetchInterval: 30_000, // refresh every 30 s
    staleTime: 20_000,
  });

  const items = (data ?? []).slice(0, limit);

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-slate-950/70 ${className}`}
      aria-label="Marketplace activity feed"
      role="region"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
        <Zap className="h-4 w-4 text-violet-400" />
        <h2 className="text-sm font-semibold text-white">Live Activity</h2>
        {!isLoading && !isError && items.length > 0 && (
          <span className="ml-auto flex items-center gap-1 text-xs text-slate-500">
            <Clock className="h-3 w-3" />
            Updates every 30s
          </span>
        )}
      </div>

      {/* Body */}
      <div className="px-5 py-2">
        {isLoading ? (
          <ActivitySkeleton />
        ) : isError ? (
          <div className="py-8 text-center text-sm text-red-400">
            Failed to load activity. Try refreshing.
          </div>
        ) : items.length === 0 ? (
          <ActivityEmptyState />
        ) : (
          <ul role="list">
            {items.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
