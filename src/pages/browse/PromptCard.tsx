import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import {
  ArrowUpRight,
  Bookmark,
  BookmarkCheck,
  LockKeyhole,
  ShieldCheck,
  TrendingUp,
  Check,
  Plus,
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
  isCompared = false,
  onToggleCompare,
}: {
  prompt: PromptRecord;
  hasAccess: boolean;
  // eslint-disable-next-line no-unused-vars
  openModal: (_prompt: PromptRecord) => void;
  isSaved: boolean;
  isSaving: boolean;
  // eslint-disable-next-line no-unused-vars
  onToggleSave: (_prompt: PromptRecord) => void;
  isCompared?: boolean;
  // eslint-disable-next-line no-unused-vars
  onToggleCompare?: (_prompt: PromptRecord) => void;
}) => {
  const isBestSeller = prompt.salesCount >= 10;
  const reducedMotion = useReducedMotion();

  // Fetch review stats for this prompt
  const { data: reviewStats } = useQuery({
    queryKey: ["review-stats", prompt.id.toString()],
    queryFn: () => ReviewClient.getReviewStats(prompt.id.toString()),
    staleTime: 60_000, // Cache for 1 minute
  });

  const hoverProps = reducedMotion
    ? {}
    : {
        whileHover: { y: -4, scale: 1.01 },
        whileTap: { scale: 0.98 },
        transition: { type: "spring", stiffness: 300, damping: 20 },
      };

  return (
    <motion.div {...hoverProps}>
    <Card
      className={`group relative flex flex-col cursor-pointer overflow-hidden rounded-[24px] ${
        isCompared
          ? "border-emerald-500 bg-emerald-950/5 ring-1 ring-emerald-500/30"
          : "border-white/5 bg-white/[0.02] hover:bg-white/[0.04]"
      }`}
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
        <div className="absolute top-4 right-4 flex flex-col gap-2 items-end z-10">
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
          {onToggleCompare && (
            <Button
              size="sm"
              variant="secondary"
              className={`h-8 rounded-full border shadow-lg backdrop-blur-md transition-all px-3 text-xs ${
                isCompared
                  ? "bg-emerald-500 text-slate-950 border-emerald-400 font-bold hover:bg-emerald-600"
                  : "bg-slate-950/75 text-white border-white/10 hover:bg-slate-900"
              }`}
              onClick={(event) => {
                event.stopPropagation();
                onToggleCompare(prompt);
              }}
            >
              {isCompared ? (
                <Check className="mr-1.5 h-3.5 w-3.5 text-slate-950" />
              ) : (
                <Plus className="mr-1.5 h-3.5 w-3.5" />
              )}
              {isCompared ? "Compared" : "Compare"}
            </Button>
          )}
        </div>
      </div>

      <CardContent className="flex flex-1 flex-col p-4 pt-4 sm:p-6 sm:pt-5">
        {/* Modern Stateful Badges Row */}
        <div className="flex flex-wrap gap-2 mb-3">
          {/* Active/Inactive Badge */}
          {prompt.active ? (
            <span
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20"
              data-testid="badge-active"
              title="This prompt is currently available for purchase"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              Active
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-slate-500/10 text-slate-400 border border-slate-500/20"
              data-testid="badge-inactive"
              title="This prompt is not currently available for purchase"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-slate-400" />
              Inactive
            </span>
          )}

          {/* Purchased/Unlockable Badge */}
          {hasAccess ? (
            <span
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20"
              data-testid="badge-purchased"
              title="You have purchased a license for this prompt"
            >
              Purchased
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-indigo-500/10 text-indigo-400 border border-indigo-500/20"
              data-testid="badge-unlockable"
              title="Purchase a license to unlock this prompt"
            >
              Unlockable
            </span>
          )}

          {/* Verification Badge */}
          {prompt.contentHash && (
            <span
              className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-amber-500/10 text-amber-400 border border-amber-500/20"
              data-testid="badge-verified"
              title="Content integrity verified on the Stellar blockchain"
            >
              <ShieldCheck className="h-3 w-3 text-amber-400" />
              Verified
            </span>
          )}
        </div>

        <div className="flex-1 space-y-3">
          <div className="flex items-start justify-between gap-3 sm:gap-4">
            <h3 className="text-base font-bold leading-tight transition-colors group-hover:text-emerald-400 sm:text-lg">
              {prompt.title}
            </h3>
            <div className="text-right shrink-0">
              <p
                className="text-lg font-black text-emerald-400 sm:text-xl font-mono tracking-tight"
                aria-label={`Price: ${formatPriceLabel(prompt.priceStroops)}`}
                data-testid="price-label"
              >
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

          {/* Quality Score Display */}
          <div className="pt-2">
            {reviewStats && reviewStats.total > 0 ? (
              <div className="flex items-center gap-2">
                <StarRating
                  rating={reviewStats.averageRating}
                  readonly
                  size="sm"
                  showCount
                  reviewCount={reviewStats.total}
                />
                <span
                  className="rounded-full border border-amber-500/20 bg-amber-500/10 px-2 py-0.5 text-[10px] font-bold text-amber-400"
                  title="Average quality score based on buyer reviews"
                >
                  {reviewStats.averageRating.toFixed(1)}
                </span>
              </div>
            ) : (
              <span className="text-[11px] text-slate-500 italic">
                No ratings yet
              </span>
            )}
          </div>
        </div>

        {/* Purchase Info Row */}
        <div className="mt-5 flex items-center justify-between border-t border-white/5 pt-4 sm:mt-6 sm:pt-5">
          <div className="flex min-w-0 items-center gap-2">
            <div className="h-6 w-6 rounded-full bg-emerald-500/20 flex items-center justify-center">
              <ShieldCheck className="h-3.5 w-3.5 text-emerald-400" />
            </div>
            <Link
              to={`/sellers/${encodeURIComponent(prompt.creator)}`}
              className="truncate text-xs font-medium text-slate-400 transition-colors hover:text-emerald-300"
              onClick={(event) => event.stopPropagation()}
              aria-label={`View seller ${prompt.creator}`}
            >
              {shortenAddress(prompt.creator)}
            </Link>
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
    </motion.div>
  );
};
