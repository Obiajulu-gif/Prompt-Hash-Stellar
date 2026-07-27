import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { ArrowUpRight, Bookmark, BookmarkCheck, Check, LockKeyhole, Plus, ShieldCheck, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { StarRating } from "@/components/prompts/StarRating";
import { CreatorReputationSummary, CreatorVerifiedBadge } from "@/components/reputation/CreatorReputationBadge";
import { useReducedMotion } from "@/hooks/useReducedMotion";
import { ReviewClient } from "@/lib/reviews/reviewClient";
import { buildCreatorReputation } from "@/lib/reputation/creatorReputation";
import { formatPriceLabel } from "@/lib/stellar/format";
import type { PromptRecord } from "@/lib/stellar/promptHashClient";
import { useQuery } from "@tanstack/react-query";

const shortenAddress = (address: string) =>
  address.length > 14 ? `${address.slice(0, 6)}...${address.slice(-4)}` : address;

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
  openModal: (_prompt: PromptRecord) => void;
  isSaved: boolean;
  isSaving: boolean;
  onToggleSave: (_prompt: PromptRecord) => void;
  isCompared?: boolean;
  onToggleCompare?: (_prompt: PromptRecord) => void;
}) => {
  const shouldReduceMotion = useReducedMotion();
  const isBestSeller = prompt.salesCount >= 10;
  const reputation = buildCreatorReputation(prompt.creator, [prompt]);
  const hoverProps = shouldReduceMotion
    ? {}
    : { whileHover: { y: -6 }, transition: { duration: 0.2 } };

  const { data: reviewStats } = useQuery({
    queryKey: ["review-stats", prompt.id.toString()],
    queryFn: () => ReviewClient.getReviewStats(prompt.id.toString()),
    staleTime: 60_000,
  });

  return (
    <motion.div {...hoverProps}>
      <Card
        className={`group relative flex h-full cursor-pointer flex-col overflow-hidden rounded-[24px] ${
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
        <div className="relative aspect-[16/10] overflow-hidden bg-slate-900">
          {prompt.imageUrl ? (
            <img
              src={prompt.imageUrl}
              alt={prompt.title}
              className="h-full w-full object-cover transition-transform duration-700 group-hover:scale-110"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-slate-900 via-slate-800 to-emerald-950 text-center text-sm text-slate-400">
              <span className="rounded-full border border-white/10 px-3 py-1">Image preview unavailable</span>
            </div>
          )}
          <div className="absolute inset-0 bg-gradient-to-t from-[#020617] via-transparent to-transparent opacity-60" />
          <div className="absolute left-4 top-4 flex flex-wrap gap-2">
            <Badge className="border-white/10 bg-slate-950/80 text-slate-200 backdrop-blur-md hover:bg-slate-900">
              {prompt.category || "Uncategorized"}
            </Badge>
            {isBestSeller && (
              <Badge className="border-none bg-amber-300 text-slate-950 font-bold">
                <TrendingUp className="mr-1 h-3 w-3" /> Best seller
              </Badge>
            )}
            {reputation.verified && (
              <Badge className="border-none bg-cyan-300 text-slate-950 font-bold">
                <ShieldCheck className="mr-1 h-3 w-3" /> Verified Creator
              </Badge>
            )}
          </div>
          <div className="absolute right-4 top-4 z-10 flex flex-col items-end gap-2">
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
              {isSaved ? <BookmarkCheck className="mr-1.5 h-3.5 w-3.5 text-emerald-300" /> : <Bookmark className="mr-1.5 h-3.5 w-3.5" />}
              {isSaved ? "Saved" : "Save"}
            </Button>
            {onToggleCompare && (
              <Button
                size="sm"
                variant="secondary"
                className={`h-8 rounded-full border px-3 text-xs shadow-lg backdrop-blur-md ${
                  isCompared ? "border-emerald-400 bg-emerald-500 font-bold text-slate-950" : "border-white/10 bg-slate-950/75 text-white"
                }`}
                onClick={(event) => {
                  event.stopPropagation();
                  onToggleCompare(prompt);
                }}
              >
                {isCompared ? <Check className="mr-1.5 h-3.5 w-3.5" /> : <Plus className="mr-1.5 h-3.5 w-3.5" />}
                {isCompared ? "Compared" : "Compare"}
              </Button>
            )}
          </div>
        </div>

        <CardContent className="flex flex-1 flex-col p-4 pt-4 sm:p-6 sm:pt-5">
          <div className="mb-3 flex flex-wrap gap-2">
            <span className="inline-flex items-center gap-1 rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-400">
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> {prompt.active ? "Active" : "Preview"}
            </span>
            <span className="inline-flex items-center gap-1 rounded-full border border-indigo-500/20 bg-indigo-500/10 px-2.5 py-0.5 text-xs font-semibold text-indigo-400">
              {hasAccess ? "Purchased" : "Unlockable"}
            </span>
            {prompt.contentHash && (
              <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/20 bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-400">
                <ShieldCheck className="h-3 w-3" /> Verified
              </span>
            )}
          </div>

          <div className="flex-1 space-y-3">
            <div className="flex items-start justify-between gap-4">
              <h3 className="text-base font-bold leading-tight transition-colors group-hover:text-emerald-400 sm:text-lg">{prompt.title || "Untitled listing"}</h3>
              <div className="shrink-0 text-right">
                <p className="font-mono text-lg font-black tracking-tight text-emerald-400 sm:text-xl" aria-label={`Price: ${formatPriceLabel(prompt.priceStroops)}`} data-testid="price-label">
                  {formatPriceLabel(prompt.priceStroops)}
                </p>
                <p className="text-[10px] uppercase tracking-tighter text-slate-500">per license</p>
              </div>
            </div>
            <p className="line-clamp-3 text-sm leading-relaxed text-slate-400">{prompt.previewText || "No public preview text provided yet."}</p>
            {reviewStats?.averageRating ? <StarRating rating={reviewStats.averageRating} count={reviewStats.totalReviews} size="sm" /> : <span className="text-[11px] italic text-slate-500">No ratings yet</span>}
          </div>

          <div className="mt-5 space-y-3 border-t border-white/5 pt-4 sm:mt-6 sm:pt-5">
            <div className="flex items-center justify-between gap-3">
              <Link to={`/sellers/${encodeURIComponent(prompt.creator)}`} className="truncate text-xs font-medium text-slate-400 transition-colors hover:text-emerald-300" onClick={(event) => event.stopPropagation()}>
                {shortenAddress(prompt.creator)}
              </Link>
              {hasAccess ? (
                <Button size="sm" variant="ghost" className="font-bold text-emerald-400 hover:bg-emerald-400/10 hover:text-emerald-300">
                  Owned <ArrowUpRight className="ml-1.5 h-4 w-4" />
                </Button>
              ) : (
                <div className="flex items-center gap-1 text-[11px] font-bold uppercase tracking-wider text-slate-500">
                  <LockKeyhole className="h-3 w-3" /> Get Access
                </div>
              )}
            </div>
            <CreatorVerifiedBadge reputation={reputation} compact />
            <CreatorReputationSummary reputation={reputation} />
          </div>
        </CardContent>
      </Card>
    </motion.div>
  );
};
