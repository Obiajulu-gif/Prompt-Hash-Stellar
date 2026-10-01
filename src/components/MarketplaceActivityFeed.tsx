import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Zap, PackagePlus, RefreshCw, ShoppingBag, Clock, Sparkles } from "lucide-react";
import {
  getAllPrompts,
  getRecentPurchases,
  type PromptRecord,
} from "@/lib/stellar/promptHashClient";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { UserAvatar } from "@/components/UserAvatar";
import { shortenAddress } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ActivityType = "new_listing" | "update" | "sale";

export interface ActivityItem {
  id: string;
  type: ActivityType;
  title: string;
  category: string;
  actor: string; // wallet address or display name
  timestamp: string; // ISO-8601
  priceXlm?: string;
  promptId?: string;
}

// ---------------------------------------------------------------------------
// Data Fetching: Aggregates listings, revisions, and sales
// ---------------------------------------------------------------------------

export async function fetchActivityFeed(): Promise<ActivityItem[]> {
  const activities: ActivityItem[] = [];

  try {
    // 1. Fetch prompts to generate recent listings and updates
    const prompts = await getAllPrompts(browserStellarConfig).catch(() => [] as PromptRecord[]);

    // Sort prompts by ID descending (newest first)
    const sortedPrompts = [...prompts].sort((a, b) => {
      if (a.id > b.id) return -1;
      if (a.id < b.id) return 1;
      return 0;
    });

    for (const prompt of sortedPrompts) {
      const idStr = prompt.id.toString();
      const price = prompt.priceStroops
        ? (Number(prompt.priceStroops) / 10_000_000).toFixed(2)
        : undefined;

      // If prompt has revisions/updates, record update event
      if (prompt.revision && prompt.revision > 1) {
        activities.push({
          id: `update-${idStr}-rev-${prompt.revision}`,
          type: "update",
          title: prompt.title || `Prompt #${idStr}`,
          category: prompt.category || "General",
          actor: prompt.creator || "Anonymous",
          timestamp: new Date(Date.now() - 3600_000).toISOString(),
          priceXlm: price,
          promptId: idStr,
        });
      }

      // Add listing event
      activities.push({
        id: `listing-${idStr}`,
        type: "new_listing",
        title: prompt.title || `Prompt #${idStr}`,
        category: prompt.category || "General",
        actor: prompt.creator || "Anonymous",
        timestamp: new Date(Date.now() - 7200_000).toISOString(),
        priceXlm: price,
        promptId: idStr,
      });
    }

    // 2. Fetch recent sales / purchase events from the ledger
    const recentSales = await getRecentPurchases(browserStellarConfig, 10).catch(() => []);
    if (Array.isArray(recentSales)) {
      for (const sale of recentSales) {
        if (sale && sale.id) {
          activities.push({
            id: sale.id,
            type: "sale",
            title: sale.title || "Licensed Prompt",
            category: sale.category || "Marketplace",
            actor: sale.actor || "Buyer",
            timestamp: sale.timestamp || new Date().toISOString(),
            priceXlm: sale.priceXlm,
          });
        }
      }
    }
  } catch (error) {
    console.error("Error fetching activity feed:", error);
  }

  // Sort unified activities chronologically (newest first)
  return activities.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
  );
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

export function ActivitySkeleton() {
  return (
    <div className="space-y-3 animate-pulse" role="status" aria-label="Loading activity feed">
      {Array.from({ length: 4 }).map((_, i) => (
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

export function ActivityEmptyState({ filter }: { filter?: string }) {
  return (
    <div
      className="flex flex-col items-center justify-center py-10 text-center gap-3"
      data-testid="activity-empty-state"
    >
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-white/10 bg-white/5">
        <Sparkles className="h-5 w-5 text-slate-500" />
      </div>
      <div>
        <p className="text-sm font-semibold text-white">No recent activity</p>
        <p className="mt-1 text-xs text-slate-500">
          {filter && filter !== "all"
            ? `No ${filter.replace("_", " ")} events recorded yet.`
            : "New listings, prompt updates, and license sales will appear here."}
        </p>
      </div>
    </div>
  );
}

export function ActivityRow({ item }: { item: ActivityItem }) {
  const cfg = typeConfig[item.type];
  const formattedActor = item.actor.startsWith("G") && item.actor.length > 10
    ? shortenAddress(item.actor)
    : item.actor;

  return (
    <li
      className="flex items-start gap-3 py-3 border-b border-white/5 last:border-0"
      data-testid={`activity-item-${item.id}`}
    >
      {/* Icon badge and avatar */}
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
        <p className="mt-0.5 text-xs text-slate-500 font-mono">{formattedActor}</p>
      </div>

      {/* Timestamp */}
      <span className="shrink-0 text-xs text-slate-600 tabular-nums mt-0.5">
        {relativeTime(item.timestamp)}
      </span>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

interface MarketplaceActivityFeedProps {
  /** Max number of feed items to display. Defaults to 10. */
  limit?: number;
  className?: string;
  showFilters?: boolean;
}

export function MarketplaceActivityFeed({
  limit = 10,
  className = "",
  showFilters = true,
}: MarketplaceActivityFeedProps) {
  const [filter, setFilter] = useState<"all" | ActivityType>("all");

  const { data, isLoading, isError } = useQuery({
    queryKey: ["marketplace-activity-feed"],
    queryFn: fetchActivityFeed,
    refetchInterval: 30_000,
    staleTime: 15_000,
  });

  const allItems = data ?? [];
  const filteredItems = filter === "all"
    ? allItems
    : allItems.filter((item) => item.type === filter);

  const displayedItems = filteredItems.slice(0, limit);

  return (
    <div
      className={`rounded-2xl border border-white/10 bg-slate-950/70 ${className}`}
      aria-label="Marketplace activity feed"
      role="region"
    >
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-white/10 px-5 py-4">
        <div className="flex items-center gap-2">
          <Zap className="h-4 w-4 text-violet-400" />
          <h2 className="text-sm font-semibold text-white">Live Activity</h2>
        </div>

        {/* Filter Pills */}
        {showFilters && !isLoading && allItems.length > 0 && (
          <div className="flex items-center gap-1.5" role="tablist" aria-label="Filter activity">
            {(["all", "new_listing", "update", "sale"] as const).map((tab) => (
              <button
                key={tab}
                type="button"
                onClick={() => setFilter(tab)}
                role="tab"
                aria-selected={filter === tab}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${
                  filter === tab
                    ? "bg-white/15 text-white"
                    : "text-slate-400 hover:bg-white/5 hover:text-slate-200"
                }`}
              >
                {tab === "all"
                  ? "All"
                  : tab === "new_listing"
                    ? "Listings"
                    : tab === "update"
                      ? "Updates"
                      : "Sales"}
              </button>
            ))}
          </div>
        )}

        {!isLoading && !isError && allItems.length > 0 && !showFilters && (
          <span className="flex items-center gap-1 text-xs text-slate-500">
            <Clock className="h-3 w-3" />
            Live
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
        ) : displayedItems.length === 0 ? (
          <ActivityEmptyState filter={filter} />
        ) : (
          <ul role="list" className="divide-y divide-white/5">
            {displayedItems.map((item) => (
              <ActivityRow key={item.id} item={item} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
