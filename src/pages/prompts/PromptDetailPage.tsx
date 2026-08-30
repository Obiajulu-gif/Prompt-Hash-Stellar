import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  BadgeCheck,
  Check,
  Clock,
  Copy,
  Flag,
  History,
  ShoppingBag,
  Sparkles,
  GitFork,
  ThumbsUp,
  User,
  Hash,
} from "lucide-react";
import { Navigation } from "@/components/navigation";
import { Footer } from "@/components/footer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { getPrompt } from "@/lib/stellar/promptHashClient";
import { formatPriceLabel } from "@/lib/stellar/format";
import { usePageMeta } from "@/lib/seo/usePageMeta";
import { buildCreatorReputation } from "@/lib/reputation/creatorReputation";
import { CreatorVerifiedBadge } from "@/components/reputation/CreatorReputationBadge";
import { useRecentlyViewed } from "@/hooks/useRecentlyViewed";
import { useWallet } from "@/hooks/useWallet";
import { copyToClipboard } from "@/lib/clipboard/secureClipboard";
import { PriceHistoryCard } from "@/components/PriceHistoryCard";
import { useClipboardAutoClear } from "@/hooks/useClipboardAutoClear";
import { ClipboardAutoClearBanner } from "@/components/ClipboardAutoClearBanner";
import { MarkdownContent } from "@/components/MarkdownContent";
import { UserAvatar } from "@/components/UserAvatar";
import { ReportDialog } from "@/components/prompts/ReportDialog";
import { PromptDetailSkeleton } from "@/components/skeletons";
import { getMarketplaceReturnUrl } from "@/lib/search/urlState";
import { computeListingSnapshotHash } from "@/lib/auth/challenge";

const FALLBACK_IMAGE = "/images/codeguru.png";

function summarise(text: string, max = 160): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

export default function PromptDetailPage() {
  const { id = "" } = useParams();
  const isValidId = /^\d+$/.test(id);
  const { address } = useWallet();
  const queryClient = useQueryClient();
  const [copied, setCopied] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);
  // Restores the filtered marketplace view the buyer navigated from, instead
  // of always dropping back to a bare, unfiltered /browse (#497).
  const [marketplaceBackHref] = useState(
    () => getMarketplaceReturnUrl() ?? "/browse",
  );
  const {
    enabled: autoClearEnabled,
    toggle: toggleAutoClear,
    copy,
    cancel: cancelAutoClear,
    remaining,
    isCountingDown,
  } = useClipboardAutoClear();

  const {
    data: prompt,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["prompt-detail", id],
    queryFn: () => getPrompt(browserStellarConfig, BigInt(id)),
    enabled: isValidId,
    // Moderation decisions must not be served from a stale cache. Refetch on
    // every mount/focus so a hidden or restricted listing is reflected quickly.
    staleTime: 0,
    refetchOnWindowFocus: true,
    gcTime: 30_000,
  });

  // Moderation state is owned by the DB-backed marketplace API. We never serve it
  // from a long-lived cache: it is re-fetched on every mount and on focus.
  const {
    data: moderation,
  } = useQuery({
    queryKey: ["prompt-moderation", id],
    queryFn: async () => {
      const res = await fetch(`/api/prompts/index?onChainId=${encodeURIComponent(id)}`);
      if (!res.ok) return null;
      const list = (await res.json()) as Array<Record<string, unknown>>;
      return (list && list[0]) || null;
    },
    enabled: isValidId,
    staleTime: 0,
    refetchOnWindowFocus: true,
    gcTime: 30_000,
  });

  const moderationStatus =
    moderation && typeof moderation.moderationStatus === "string"
      ? moderation.moderationStatus
      : "none";
  const moderationReason =
    moderation && typeof moderation.moderationReason === "string"
      ? moderation.moderationReason
      : null;
  const isModerated =
    moderationStatus === "restricted" || moderationStatus === "retired";

  const { recordView } = useRecentlyViewed();

  // Drop any persisted/ cached detail + moderation entries as soon as the page
  // mounts so a moderation change is never served from a stale cache.
  useEffect(() => {
    queryClient.invalidateQueries({ queryKey: ["prompt-detail", id] });
    queryClient.invalidateQueries({ queryKey: ["prompt-moderation", id] });
  }, [queryClient, id]);

  // Record the view when the prompt loads
  useEffect(() => {
    if (prompt) {
      recordView({
        id: prompt.id.toString(),
        title: prompt.title,
        category: prompt.category,
        imageUrl: prompt.imageUrl,
      });
    }
  }, [prompt, recordView]);

  // Drive the share preview (Open Graph / Twitter card) from the prompt details
  // so links shared to social platforms show the title, summary and cover image.
  const summary = prompt
    ? summarise(prompt.description || prompt.previewText)
    : "Discover wallet-verified AI prompts secured on the Stellar blockchain.";
  usePageMeta({
    title: prompt ? prompt.title : "Prompt",
    description: summary,
    ogImage: prompt?.imageUrl || undefined,
    type: "article",
  });

  const jsonLd = prompt ? {
    "@context": "https://schema.org/",
    "@type": "Product",
    name: prompt.title,
    description: prompt.previewText,
    image: prompt.imageUrl || `${window.location.origin}${FALLBACK_IMAGE}`,
    offers: {
      "@type": "Offer",
      price: (Number(prompt.priceStroops) / 10000000).toFixed(2),
      priceCurrency: "XLM",
      availability: prompt.active ? "https://schema.org/InStock" : "https://schema.org/OutOfStock",
    },
    aggregateRating: {
      "@type": "AggregateRating",
      ratingValue: "5.0",
      reviewCount: Math.max(1, prompt.salesCount)
    }
  } : null;


  const handleCopyLink = async () => {
    const link =
      typeof window !== "undefined" ? window.location.href : `/prompts/${id}`;
    const ok = await copy(link);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };
  const notFound = !isValidId || isError || (!isLoading && !prompt);
  const reputation = prompt
    ? buildCreatorReputation(prompt.creator, [prompt])
    : null;

  return (
    <div className="min-h-screen bg-[#020617] text-white selection:bg-cyan-500/30">
      <Navigation />

      <main className="mx-auto max-w-3xl px-4 py-16 sm:px-6">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mb-6 -ml-2 text-slate-400 hover:text-white"
        >
          <Link to={marketplaceBackHref}>
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to marketplace
          </Link>
        </Button>

        {isLoading && isValidId ? (
          <PromptDetailSkeleton />
        ) : notFound || !prompt ? (
          <div className="grid min-h-64 place-items-center rounded-2xl border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
            <div className="max-w-sm">
              <h1 className="text-xl font-semibold text-white">
                Prompt not found
              </h1>
              <p className="mt-2 text-sm leading-6 text-slate-400">
                This prompt may have been removed or the link is incorrect.
              </p>
              <Button
                asChild
                className="mt-5 h-9 bg-cyan-200 px-5 text-slate-950 hover:bg-cyan-100"
              >
                <Link to={marketplaceBackHref}>
                  <ShoppingBag className="h-4 w-4" />
                  Browse marketplace
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <article className="overflow-hidden rounded-2xl border border-white/10 bg-[#0f1419]">
            {isModerated ? (
              <div className="flex items-start gap-3 border-b border-amber-400/30 bg-amber-500/10 px-6 py-4 text-sm text-amber-100 sm:px-8">
                <Flag className="mt-0.5 h-4 w-4 shrink-0" />
                <div>
                  <p className="font-semibold">
                    {moderationStatus === "retired"
                      ? "This listing has been retired by a moderator."
                      : "This listing is currently restricted by a moderator."}
                  </p>
                  {moderationReason ? (
                    <p className="mt-1 text-amber-200/80">
                      Reason: {String(moderationReason).replace(/_/g, " ")}
                    </p>
                  ) : null}
                </div>
              </div>
            ) : null}
            {jsonLd && (
              <script
                type="application/ld+json"
                dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
              />
            )}
            <div className="aspect-[1200/630] w-full overflow-hidden bg-slate-900">
              <img
                src={prompt.imageUrl || FALLBACK_IMAGE}
                alt={prompt.title}
                className="h-full w-full object-cover"
                onError={(event) => {
                  event.currentTarget.src = FALLBACK_IMAGE;
                }}
              />
            </div>

            <div className="space-y-5 p-6 sm:p-8">
              <div className="flex flex-wrap items-center gap-2">
                <Badge className="border-cyan-200/30 bg-cyan-200/10 text-cyan-100">
                  <Sparkles className="mr-1 h-3 w-3" />
                  {prompt.category}
                </Badge>
                {reputation ? (
                  <CreatorVerifiedBadge reputation={reputation} compact />
                ) : null}
                {(!prompt.active || isModerated) && (
                  <Badge className="border-amber-400/30 bg-amber-500/10 text-amber-200">
                    {isModerated ? "Moderated" : "Unavailable"}
                  </Badge>
                )}
                <span
                  className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-semibold bg-blue-500/10 text-blue-400 border border-blue-500/20"
                  title={`${prompt.salesCount} license${prompt.salesCount !== 1 ? "s" : ""} sold`}
                >
                  <ShoppingBag className="h-3 w-3" />
                  {prompt.salesCount} sold
                </span>
              </div>

              <div>
                <h1 className="text-2xl font-bold tracking-tight text-white">
                  {prompt.title}
                </h1>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  {prompt.previewText}
                </p>
                {prompt.description && (
                  <div className="mt-4">
                    <MarkdownContent>{prompt.description}</MarkdownContent>
                  </div>
                )}
              </div>

              {prompt.sourcePromptId && (
                <div className="rounded-xl border border-violet-400/20 bg-violet-400/10 px-4 py-3 text-sm text-violet-100">
                  <span className="inline-flex items-center gap-2">
                    <GitFork className="h-4 w-4" />
                    Inspired by{" "}
                    <Link
                      to={`/prompts/${prompt.sourcePromptId}`}
                      className="font-semibold underline underline-offset-4 hover:text-white"
                    >
                      prompt #{prompt.sourcePromptId}
                    </Link>
                  </span>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-slate-400">
                <span className="inline-flex items-center gap-2">
                  <UserAvatar address={prompt.creator} size={20} />
                  <span className="font-mono text-slate-300">
                    {prompt.creator.length > 12
                      ? `${prompt.creator.slice(0, 6)}…${prompt.creator.slice(-4)}`
                      : prompt.creator}
                  </span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <ShoppingBag className="h-3.5 w-3.5" />
                  {prompt.salesCount} sold
                </span>
                {reputation ? (
                  <>
                    <span className="inline-flex items-center gap-1.5">
                      <ThumbsUp className="h-3.5 w-3.5 text-emerald-300" />
                      {reputation.positiveRatings} positive
                    </span>
                    <span className="inline-flex items-center gap-1.5">
                      <Clock className="h-3.5 w-3.5 text-cyan-300" />
                      {reputation.timeOnPlatformLabel} on platform
                    </span>
                    {reputation.verified ? (
                      <span className="inline-flex items-center gap-1.5 text-emerald-300">
                        <BadgeCheck className="h-3.5 w-3.5" />
                        {reputation.verificationLabel}
                      </span>
                    ) : null}
                  </>
                ) : null}
                <span className="font-semibold text-white">
                  {formatPriceLabel(prompt.priceStroops)}
                </span>
                {"revision" in prompt && prompt.revision !== undefined && (
                  <span className="inline-flex items-center gap-1.5">
                    <History className="h-3.5 w-3.5" />
                    v{String((prompt as any).revision)}
                  </span>
                )}
              </div>

              <div className="rounded-lg border border-white/10 bg-white/5 p-4 text-xs text-slate-400">
                <div className="mb-1 flex items-center gap-2 font-medium text-slate-300">
                  <Hash className="h-3.5 w-3.5" />
                  Listing integrity snapshot
                </div>
                <p className="mb-2">
                  This hash binds your purchase challenge to the exact listing state
                  (owner, price, asset, version, expiry). Any change invalidates a
                  pending challenge.
                </p>
                <code className="block break-all font-mono text-[11px] text-slate-300">
                  {computeListingSnapshotHash({
                    promptId: String(prompt.id),
                    owner: String(prompt.creator),
                    priceStroops: String(prompt.priceStroops ?? ""),
                    asset: String((prompt as any).asset ?? ""),
                    version: String((prompt as any).revision ?? ""),
                    expiresAt: String((prompt as any).expiresAt ?? "0"),
                  })}
                </code>
              </div>

              <div className="flex flex-col gap-4 border-t border-white/10 pt-5">
                <Button
                  asChild
                  className="h-10 w-full bg-cyan-200 text-slate-950 hover:bg-cyan-100"
                >
                  <Link to="/browse">
                    <ShoppingBag className="h-4 w-4" />
                    View in marketplace
                  </Link>
                </Button>
                <Button
                  variant="ghost"
                  onClick={handleCopyLink}
                  className="h-10 flex-1 border border-white/10 text-slate-200 hover:bg-white/10"
                >
                  {copied ? (
                    <>
                      <Check className="h-4 w-4 text-emerald-400" />
                      Link copied
                    </>
                  ) : (
                    <>
                      <Copy className="h-4 w-4" />
                      Copy share link
                    </>
                  )}
                </Button>
                <ClipboardAutoClearBanner
                  remaining={remaining}
                  enabled={autoClearEnabled}
                  onToggle={toggleAutoClear}
                  onCancel={cancelAutoClear}
                />
                <Button
                  variant="ghost"
                  onClick={() => setShowReportDialog(true)}
                  className="h-10 flex-1 border border-rose-400/20 text-rose-200 hover:bg-rose-400/10"
                >
                  <Flag className="h-4 w-4" />
                  Report listing
                </Button>
              </div>
            </div>
          </article>
        )}

          {prompt && (
            <div className="mt-8">
              <PriceHistoryCard
                onChainId={id}
                currentPriceStroops={prompt.priceStroops}
              />
            </div>
          )}
      </main>

      <ReportDialog
        promptId={id}
        isOpen={showReportDialog}
        onClose={() => setShowReportDialog(false)}
        userAddress={address}
      />
      <Footer />
    </div>
  );
}
