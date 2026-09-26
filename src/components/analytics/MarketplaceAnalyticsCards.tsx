import { useQuery } from "@tanstack/react-query";
import { TrendingUp, Package, ShoppingCart, Coins } from "lucide-react";
import { Skeleton } from "@/components/Skeleton";
import { getAllPrompts } from "@/lib/stellar/promptHashClient";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { stroopsToXlmString } from "@/lib/stellar/format";

interface AnalyticsCardProps {
  title: string;
  value: string | number;
  icon: React.ReactNode;
  description?: string;
  isLoading?: boolean;
  isUnavailable?: boolean;
}

const AnalyticsCard: React.FC<AnalyticsCardProps> = ({
  title,
  value,
  icon,
  description,
  isLoading,
  isUnavailable,
}) => {
  if (isLoading) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-white/5">
            {icon}
          </div>
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-8 w-16 mb-2" />
        {description && <Skeleton className="h-3 w-32" />}
      </div>
    );
  }

  if (isUnavailable) {
    return (
      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 opacity-50">
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-lg bg-white/5">
            {icon}
          </div>
          <p className="text-xs uppercase tracking-wider text-slate-400">{title}</p>
        </div>
        <p className="text-2xl font-bold text-slate-500">—</p>
        <p className="text-xs text-slate-500 mt-2">Data unavailable</p>
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-white/10 bg-white/5 p-6 hover:bg-white/[0.07] transition-colors">
      <div className="flex items-center gap-3 mb-4">
        <div className="p-2 rounded-lg bg-white/5">
          {icon}
        </div>
        <p className="text-xs uppercase tracking-wider text-slate-400">{title}</p>
      </div>
      <p className="text-3xl font-bold text-white">{value}</p>
      {description && (
        <p className="text-xs text-slate-400 mt-2">{description}</p>
      )}
    </div>
  );
};

export const MarketplaceAnalyticsCards: React.FC = () => {
  const { data: prompts, isLoading, isError } = useQuery({
    queryKey: ["marketplace-analytics"],
    queryFn: async () => {
      try {
        return await getAllPrompts(browserStellarConfig);
      } catch (error) {
        console.error("Failed to fetch marketplace analytics:", error);
        return [];
      }
    },
    staleTime: 30_000, // Cache for 30 seconds
  });

  const analytics = {
    totalListings: prompts?.length ?? 0,
    activeListings: prompts?.filter((p) => p.active).length ?? 0,
    totalSales: prompts?.reduce((sum, p) => sum + p.salesCount, 0) ?? 0,
    estimatedVolume: prompts?.reduce(
      (sum, p) => sum + Number(stroopsToXlmString(p.priceStroops)) * p.salesCount,
      0
    ) ?? 0,
  };

  const isUnavailable = isError || (!isLoading && prompts?.length === 0);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      <AnalyticsCard
        title="Total Listings"
        value={analytics.totalListings}
        icon={<Package className="h-5 w-5 text-blue-400" />}
        description="All prompts on marketplace"
        isLoading={isLoading}
        isUnavailable={isUnavailable}
      />
      <AnalyticsCard
        title="Active Listings"
        value={analytics.activeListings}
        icon={<TrendingUp className="h-5 w-5 text-emerald-400" />}
        description="Currently available for purchase"
        isLoading={isLoading}
        isUnavailable={isUnavailable}
      />
      <AnalyticsCard
        title="Total Sales"
        value={analytics.totalSales}
        icon={<ShoppingCart className="h-5 w-5 text-purple-400" />}
        description="Completed transactions"
        isLoading={isLoading}
        isUnavailable={isUnavailable}
      />
      <AnalyticsCard
        title="Volume (XLM)"
        value={analytics.estimatedVolume.toFixed(2)}
        icon={<Coins className="h-5 w-5 text-amber-400" />}
        description="Estimated marketplace volume"
        isLoading={isLoading}
        isUnavailable={isUnavailable}
      />
    </div>
  );
};
