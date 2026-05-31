import {
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  LockKeyhole,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { shortenAddress } from "@/lib/utils";
import { formatPriceLabel } from "@/lib/stellar/format";
import type { PromptRecord } from "@/lib/stellar/promptHashClient";
import { StarRating } from "@/components/prompts/StarRating";
import { useQuery } from "@tanstack/react-query";
import { ReviewClient } from "@/lib/reviews/reviewClient";

export const PromptCard = ({
  prompt,
  hasAccess,
  openModal,
  isSaved,
  isSaving,
  onToggleSave,
}: {
  prompt: PromptRecord;
  hasAccess: boolean;
  openModal: (prompt: PromptRecord) => void;
  isSaved: boolean;
  isSaving: boolean;
  onToggleSave: (prompt: PromptRecord) => void;
}) => {
  const isBestSeller = prompt.salesCount >= 10;

  // Fetch review stats for this prompt
  const { data: reviewStats } = useQuery({
    queryKey: ["review-stats", prompt.id.toString()],
    queryFn: () => ReviewClient.getReviewStats(prompt.id.toString()),
    staleTime: 60_000, // Cache for 1 minute
  });

  return (
    <Card
      className="group relative flex flex-col border-white/5 bg-white/[0.02] hover:bg-white/[0.04] transition-all duration-300 hover:-translate-y-1 cursor-pointer overflow-hidden rounded-[24px]"
      onClick={() => openModal(prompt)}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openModal(prompt);
        }
      }}
      aria-label={`Open ${prompt.title}`}
    >
      {/* Visual Header */}
      <div className="relative aspect-[16/10] overflow-hidden">
        <img
          src={prompt.imageUrl || "/images/codeguru.png"}
          alt={prompt.title}
          className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
        />
        <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent opacity-60" />

        <div className="absolute top-4 left-4 flex gap-2">
          <Badge className="bg-slate-950/80 backdrop-blur-md border-white/10 text-slate-200 hover:bg-slate-900">
            {prompt.category}
          </Badge>
          {isBestSeller && (
            <Badge className="bg-emerald-500 text-slate-950 border-none font-bold">
              <TrendingUp className="h-3 w-3 mr-1" /> Best Seller
            </Badge>
          )}
        </div>
        <div className="absolute top-4 right-4">
          <Button
            size="sm"
            variant="secondary"
            className="h-8 rounded-full border border-white/10 bg-slate-950/75 px-3 text-xs text-white shadow-lg backdrop-blur-md hover:bg-slate-900"
            disabled={isSaving}
            onClick={(event) => {
              event.stopPropagation();
              onToggleSave(prompt);
            }}
          >
            {isSaved ? (
              <BookmarkCheck className="mr-1.5 h-3.5 w-3.5 text-emerald-300" />
            ) : (
              <Bookmark className="mr-1.5 h-3.5 w-3.5" />
            )}
            {isSaved ? "Saved" : "Save"}
          </Button>
        </div>
      </div>

      <CardContent className="flex flex-1 flex-col p-4 pt-4 sm:p-6 sm:pt-5">
        <div className="flex-1 space-y-3">
          <div className="flex items-start justify-between gap-3 sm:gap-4">
            <h3 className="text-base font-bold leading-tight transition-colors group-hover:text-emerald-400 sm:text-lg">
              {prompt.title}
            </h3>
            <div className="text-right shrink-0">
              <p className="text-lg font-black text-white sm:text-xl">
                {formatPriceLabel(prompt.priceStroops)}
              </p>
              <p className="text-[10px] text-slate-500 uppercase tracking-tighter">
                per license
              </p>
            </div>
          </div>

          <p className="line-clamp-2 text-sm text-slate-400 leading-relaxed">
            {prompt.previewText}
          </p>

          {/* Rating Display */}
          {reviewStats && reviewStats.total > 0 && (
            <div className="pt-2">
              <StarRating
                rating={reviewStats.averageRating}
                readonly
                size="sm"
                showCount
                reviewCount={reviewStats.total}
              />
            </div>
          )}
        </div>

        {/* Purchase Info Row */}
        <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4 sm:mt-6 sm:pt-5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <p className="truncate text-xs font-medium text-slate-400">
              {shortenAddress(prompt.creator)}
            </p>
          </div>

          {hasAccess ? (
            <Button
              size="sm"
              variant="ghost"
              className="text-emerald-400 hover:text-emerald-300 hover:bg-emerald-400/10 font-bold"
            >
              Owned <ArrowUpRight className="ml-1.5 h-4 w-4" />
            </Button>
          ) : (
            <div className="flex items-center gap-1 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
              <LockKeyhole className="h-3 w-3" /> Get Access
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
};
