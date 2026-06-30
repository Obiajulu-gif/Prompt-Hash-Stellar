import { useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowLeft,
  Check,
  CheckCircle,
  Copy,
  ExternalLink,
  Flag,
  History,
  Loader2,
  LockKeyhole,
  MessageSquare,
  ShieldCheck,
  ShoppingBag,
  Sparkles,
  Wallet,
} from "lucide-react";
import { Footer } from "@/components/footer";
import { MarkdownContent } from "@/components/MarkdownContent";
import { Navigation } from "@/components/navigation";
import { NetworkMismatchBanner } from "@/components/wallet/NetworkMismatchBanner";
import { ReportDialog } from "@/components/prompts/ReportDialog";
import { ReviewForm } from "@/components/prompts/ReviewForm";
import { ReviewList } from "@/components/prompts/ReviewList";
import { StarRating } from "@/components/prompts/StarRating";
import { StatusBanner } from "@/components/StatusBanner";
import { UnlockErrorBanner } from "@/components/UnlockErrorBanner";
import { UnlockExplainer } from "@/components/UnlockExplainer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { copyToClipboard } from "@/lib/clipboard/secureClipboard";
import { usePageMeta } from "@/lib/seo/usePageMeta";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { formatPriceLabel } from "@/lib/stellar/format";
import {
  PromptHashClient,
  getPrompt,
  type PurchasePromptResult,
} from "@/lib/stellar/promptHashClient";
import { mapWalletError } from "@/lib/stellar/tx";
import { detectNetworkMismatch } from "@/lib/wallet/networkDetection";
import { unlockPrompt } from "@/lib/prompts/unlock";
import { ReviewClient } from "@/lib/reviews/reviewClient";

const FALLBACK_IMAGE = "/images/codeguru.png";

type BuyerStatus =
  | "IDLE"
  | "CHECKING_ACCESS"
  | "AWAITING_APPROVAL"
  | "CONFIRMING"
  | "PURCHASED_LOCKED"
  | "UNLOCKING"
  | "SUCCESS"
  | "ERROR";

function summarise(text: string, max = 160): string {
  const clean = text.trim().replace(/\s+/g, " ");
  return clean.length > max ? `${clean.slice(0, max - 1)}...` : clean;
}

function shortAddress(value: string): string {
  return value.length > 14 ? `${value.slice(0, 6)}...${value.slice(-4)}` : value;
}

function explorerTxUrl(txHash: string): string {
  const network = browserStellarConfig.networkPassphrase
    .toLowerCase()
    .includes("public")
    ? "public"
    : "testnet";
  return `https://stellar.expert/explorer/${network}/tx/${txHash}`;
}

export default function PromptDetailPage() {
  const { id = "" } = useParams();
  const queryClient = useQueryClient();
  const wallet = useWallet();
  const isValidId = /^\d+$/.test(id);

  const [copied, setCopied] = useState(false);
  const [status, setStatus] = useState<BuyerStatus>("IDLE");
  const [purchaseResult, setPurchaseResult] =
    useState<PurchasePromptResult | null>(null);
  const [purchaseError, setPurchaseError] = useState<unknown>(null);
  const [unlockError, setUnlockError] = useState<unknown>(null);
  const [secretContent, setSecretContent] = useState("");
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [showReportDialog, setShowReportDialog] = useState(false);

  const {
    data: prompt,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["prompt-detail", id],
    queryFn: () => getPrompt(browserStellarConfig, BigInt(id)),
    enabled: isValidId,
  });

  const { data: hasAccess, isFetching: isCheckingAccess } = useQuery({
    queryKey: ["prompt-access", id, wallet.address],
    queryFn: () =>
      PromptHashClient.checkAccess(browserStellarConfig, wallet.address!, id),
    enabled: isValidId && Boolean(wallet.address),
  });

  const { data: reviewData, isLoading: reviewsLoading } = useQuery({
    queryKey: ["reviews", id],
    queryFn: () => ReviewClient.getReviews(id),
    enabled: isValidId,
    staleTime: 60_000,
  });

  useEffect(() => {
    if (!wallet.address) {
      setStatus("IDLE");
      setSecretContent("");
      return;
    }
    if (isCheckingAccess) {
      setStatus((current) =>
        current === "SUCCESS" || current === "CONFIRMING"
          ? current
          : "CHECKING_ACCESS",
      );
      return;
    }
    if (hasAccess && status !== "SUCCESS") {
      setStatus("PURCHASED_LOCKED");
    }
    if (hasAccess === false && status === "CHECKING_ACCESS") {
      setStatus("IDLE");
    }
  }, [hasAccess, isCheckingAccess, status, wallet.address]);

  const summary = prompt
    ? summarise(prompt.description || prompt.previewText)
    : "Discover wallet-verified AI prompts secured on the Stellar blockchain.";
  usePageMeta({
    title: prompt ? prompt.title : "Prompt",
    description: summary,
    ogImage: prompt?.imageUrl || undefined,
    type: "article",
  });

  const isCreator =
    Boolean(prompt?.creator && wallet.address) &&
    prompt!.creator.toLowerCase() === wallet.address!.toLowerCase();
  const networkState = detectNetworkMismatch(
    Boolean(wallet.address),
    wallet.network,
    wallet.status,
  );
  const reviewStats = reviewData?.stats;
  const mappedPurchaseError = purchaseError
    ? mapWalletError(purchaseError)
    : null;
  const mappedUnlockError = unlockError ? mapWalletError(unlockError) : null;

  const includedItems = useMemo(
    () => [
      "On-chain license record tied to your wallet",
      "Encrypted prompt unlock after access verification",
      "Content hash integrity check before delivery",
      "Post-purchase review and reporting tools",
    ],
    [],
  );

  const handleCopyLink = async () => {
    const link =
      typeof window !== "undefined" ? window.location.href : `/prompts/${id}`;
    const result = await copyToClipboard(link);
    if (result.success) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  const handlePurchase = async () => {
    if (!wallet.address || !prompt) {
      setPurchaseError(new Error("Connect your Stellar wallet before purchase."));
      setStatus("ERROR");
      return;
    }
    if (!wallet.signTransaction) {
      setPurchaseError(new Error("Wallet transaction signing is unavailable."));
      setStatus("ERROR");
      return;
    }
    if (networkState.type !== "correct") {
      setPurchaseError(new Error(networkState.message || "Wrong network connected."));
      setStatus("ERROR");
      return;
    }

    setPurchaseError(null);
    setUnlockError(null);
    setStatus("AWAITING_APPROVAL");
    try {
      const result = await PromptHashClient.purchasePrompt(id, wallet.address, {
        config: browserStellarConfig,
        signer: { signTransaction: wallet.signTransaction },
      });
      setPurchaseResult(result);
      setStatus("CONFIRMING");
      await queryClient.invalidateQueries({ queryKey: ["prompt-detail", id] });
      await queryClient.invalidateQueries({
        queryKey: ["prompt-access", id, wallet.address],
      });
      setStatus("PURCHASED_LOCKED");
    } catch (error) {
      setPurchaseError(error);
      setStatus("ERROR");
    }
  };

  const handleUnlock = async () => {
    if (!wallet.address || !wallet.signMessage || !prompt) return;
    setUnlockError(null);
    setStatus("UNLOCKING");
    try {
      const data = await unlockPrompt(
        id,
        purchaseResult?.txHash || "existing",
        wallet.signMessage,
        wallet.address,
      );
      setSecretContent(data.decryptedContent || data.plaintext);
      setStatus("SUCCESS");
    } catch (error) {
      setUnlockError(error);
      setStatus("PURCHASED_LOCKED");
    }
  };

  const notFound = !isValidId || isError || (!isLoading && !prompt);

  return (
    <div className="min-h-screen bg-slate-950 text-white selection:bg-cyan-500/30">
      <Navigation />

      <main className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
        <Button
          asChild
          variant="ghost"
          size="sm"
          className="mb-6 -ml-2 text-slate-400 hover:text-white"
        >
          <Link to="/browse">
            <ArrowLeft className="mr-1.5 h-4 w-4" />
            Back to marketplace
          </Link>
        </Button>

        {isLoading && isValidId ? (
          <div className="grid min-h-96 place-items-center border border-white/10 bg-white/[0.02]">
            <Loader2 className="h-6 w-6 animate-spin text-slate-400" />
          </div>
        ) : notFound || !prompt ? (
          <div className="grid min-h-96 place-items-center border border-dashed border-white/15 bg-white/[0.02] p-8 text-center">
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
                <Link to="/browse">
                  <ShoppingBag className="h-4 w-4" />
                  Browse marketplace
                </Link>
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_360px]">
            <article className="min-w-0">
              <div className="overflow-hidden border border-white/10 bg-slate-900">
                <div className="aspect-[1200/560] w-full overflow-hidden bg-slate-900">
                  <img
                    src={prompt.imageUrl || FALLBACK_IMAGE}
                    alt={prompt.title}
                    className="h-full w-full object-cover"
                    onError={(event) => {
                      event.currentTarget.src = FALLBACK_IMAGE;
                    }}
                  />
                </div>

                <div className="space-y-7 p-6 sm:p-8">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge className="border-cyan-200/30 bg-cyan-200/10 text-cyan-100">
                      <Sparkles className="mr-1 h-3 w-3" />
                      {prompt.category}
                    </Badge>
                    <Badge className="border-emerald-500/20 bg-emerald-500/10 text-emerald-300">
                      <ShieldCheck className="mr-1 h-3 w-3" />
                      Hash verified
                    </Badge>
                    {hasAccess && (
                      <Badge className="border-blue-500/20 bg-blue-500/10 text-blue-300">
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Licensed
                      </Badge>
                    )}
                    {isCreator && (
                      <Badge className="border-amber-500/20 bg-amber-500/10 text-amber-300">
                        Creator view
                      </Badge>
                    )}
                  </div>

                  <div>
                    <h1 className="max-w-3xl text-3xl font-bold tracking-tight text-white sm:text-4xl">
                      {prompt.title}
                    </h1>
                    <p className="mt-4 max-w-3xl text-base leading-7 text-slate-300">
                      {prompt.previewText}
                    </p>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-4">
                    <Insight label="Rating">
                      {reviewStats && reviewStats.total > 0 ? (
                        <span className="flex items-center gap-2">
                          <StarRating
                            rating={reviewStats.averageRating}
                            readonly
                            size="sm"
                          />
                          <span>{reviewStats.averageRating.toFixed(1)}</span>
                        </span>
                      ) : (
                        "No reviews"
                      )}
                    </Insight>
                    <Insight label="Sales">{prompt.salesCount}</Insight>
                    <Insight label="Revision">
                      <span className="inline-flex items-center gap-1">
                        <History className="h-3.5 w-3.5" />
                        v{prompt.revision ?? 0}
                      </span>
                    </Insight>
                    <Insight label="Creator">
                      <span title={prompt.creator}>{shortAddress(prompt.creator)}</span>
                    </Insight>
                  </div>

                  <section className="border-t border-white/10 pt-7">
                    <h2 className="text-lg font-semibold text-white">
                      Prompt Details
                    </h2>
                    <div className="mt-4 text-slate-300">
                      {prompt.description ? (
                        <MarkdownContent>{prompt.description}</MarkdownContent>
                      ) : (
                        <p className="leading-7">{prompt.previewText}</p>
                      )}
                    </div>
                  </section>

                  <section className="border-t border-white/10 pt-7">
                    <div className="mb-4 flex items-center justify-between gap-4">
                      <h2 className="text-lg font-semibold text-white">
                        Review Insights
                      </h2>
                      {reviewStats && reviewStats.total > 0 && (
                        <span className="text-sm text-slate-400">
                          {reviewStats.total} total
                        </span>
                      )}
                    </div>
                    <ReviewList
                      reviews={reviewData?.reviews ?? []}
                      isLoading={reviewsLoading}
                    />
                  </section>

                  {status === "SUCCESS" && (
                    <section className="border-t border-white/10 pt-7">
                      <div className="mb-3 flex items-center gap-2 text-emerald-300">
                        <LockKeyhole className="h-5 w-5" />
                        <h2 className="text-lg font-semibold">
                          Unlocked Content
                        </h2>
                      </div>
                      <pre className="max-h-96 overflow-auto border border-white/10 bg-black p-4 text-sm leading-6 text-slate-200">
                        {secretContent}
                      </pre>
                      {wallet.address && (
                        <div className="mt-5 border-t border-white/10 pt-5">
                          {!showReviewForm ? (
                            <Button
                              onClick={() => setShowReviewForm(true)}
                              variant="ghost"
                              className="border border-white/10 text-slate-100 hover:bg-white/10"
                            >
                              <MessageSquare className="h-4 w-4" />
                              Write a review
                            </Button>
                          ) : (
                            <ReviewForm
                              promptId={id}
                              onSubmit={async (review) => {
                                await ReviewClient.submitReview(
                                  id,
                                  wallet.address!,
                                  review.rating,
                                  review.text,
                                );
                                await queryClient.invalidateQueries({
                                  queryKey: ["reviews", id],
                                });
                                setShowReviewForm(false);
                              }}
                              onCancel={() => setShowReviewForm(false)}
                            />
                          )}
                        </div>
                      )}
                    </section>
                  )}
                </div>
              </div>
            </article>

            <aside className="lg:sticky lg:top-6 lg:self-start">
              <div className="border border-white/10 bg-slate-900 p-5 shadow-2xl">
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-semibold uppercase tracking-wider text-slate-400">
                      License price
                    </p>
                    <p className="mt-1 text-3xl font-black text-white">
                      {formatPriceLabel(prompt.priceStroops)}
                    </p>
                  </div>
                  <Badge className="border-white/10 bg-white/5 text-slate-200">
                    XLM
                  </Badge>
                </div>

                <div className="mt-5 space-y-2">
                  {includedItems.map((item) => (
                    <div
                      key={item}
                      className="flex items-start gap-2 text-sm text-slate-300"
                    >
                      <Check className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" />
                      <span>{item}</span>
                    </div>
                  ))}
                </div>

                <div className="mt-5 border-t border-white/10 pt-5">
                  <p className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-400">
                    Licensing options
                  </p>
                  <div className="space-y-2">
                    <Option label="Standard wallet license" selected />
                    <Option label="Lease access" disabled />
                    <Option label="Resale transfer" disabled />
                  </div>
                </div>

                <div className="mt-5 space-y-3 border-t border-white/10 pt-5">
                  <NetworkMismatchBanner />
                  {status === "CHECKING_ACCESS" && (
                    <StatusBanner
                      status="pending"
                      message="Checking wallet access on-chain..."
                    />
                  )}
                  {status === "AWAITING_APPROVAL" && (
                    <StatusBanner
                      status="pending"
                      message="Approve XLM spend in your wallet."
                    />
                  )}
                  {status === "CONFIRMING" && (
                    <StatusBanner
                      status="pending"
                      message="Purchase submitted. Waiting for Stellar confirmation..."
                    />
                  )}
                  {status === "PURCHASED_LOCKED" && (
                    <div className="space-y-3">
                      <StatusBanner
                        status="success"
                        message="License verified. Sign to decrypt the prompt."
                      />
                      <UnlockExplainer state="signing" />
                      {mappedUnlockError && (
                        <UnlockErrorBanner
                          message={mappedUnlockError.userMessage}
                          onRetry={handleUnlock}
                        />
                      )}
                      <Button
                        onClick={handleUnlock}
                        className="h-12 w-full bg-emerald-400 font-bold text-slate-950 hover:bg-emerald-300"
                      >
                        <LockKeyhole className="h-4 w-4" />
                        Decrypt content
                      </Button>
                    </div>
                  )}
                  {status === "UNLOCKING" && (
                    <StatusBanner
                      status="pending"
                      message="Verifying signed challenge and decrypting content..."
                    />
                  )}
                  {status === "SUCCESS" && (
                    <StatusBanner
                      status="success"
                      message="Purchase confirmed and prompt unlocked."
                    />
                  )}
                  {status === "ERROR" && mappedPurchaseError && (
                    <div className="space-y-2">
                      <StatusBanner
                        status="error"
                        message={mappedPurchaseError.userMessage}
                      />
                      <p className="text-xs leading-5 text-slate-400">
                        {mappedPurchaseError.recoveryHint}
                      </p>
                    </div>
                  )}

                  {!wallet.address ? (
                    <Button
                      disabled
                      className="h-12 w-full bg-white font-bold text-slate-950"
                    >
                      <Wallet className="h-4 w-4" />
                      Connect wallet to buy
                    </Button>
                  ) : isCreator ? (
                    <Button
                      asChild
                      className="h-12 w-full bg-cyan-200 font-bold text-slate-950 hover:bg-cyan-100"
                    >
                      <Link to="/sell">Manage listing</Link>
                    </Button>
                  ) : status === "IDLE" || status === "ERROR" ? (
                    <Button
                      onClick={handlePurchase}
                      disabled={!prompt.active || networkState.type !== "correct"}
                      className="h-12 w-full bg-white font-bold text-slate-950 hover:bg-emerald-300"
                    >
                      <Wallet className="h-4 w-4" />
                      Pay with XLM
                    </Button>
                  ) : null}
                </div>

                {purchaseResult?.txHash && (
                  <div className="mt-5 border-t border-white/10 pt-5 text-xs text-slate-400">
                    <p className="mb-2 font-semibold text-slate-300">
                      Transaction confirmation
                    </p>
                    <a
                      href={explorerTxUrl(purchaseResult.txHash)}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex max-w-full items-center gap-2 text-cyan-200 hover:text-cyan-100"
                    >
                      <span className="truncate font-mono">
                        {purchaseResult.txHash}
                      </span>
                      <ExternalLink className="h-3.5 w-3.5 shrink-0" />
                    </a>
                  </div>
                )}

                <div className="mt-5 grid grid-cols-2 gap-2 border-t border-white/10 pt-5">
                  <Button
                    variant="ghost"
                    onClick={handleCopyLink}
                    className="border border-white/10 text-slate-200 hover:bg-white/10"
                  >
                    {copied ? (
                      <Check className="h-4 w-4 text-emerald-400" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    Share
                  </Button>
                  <Button
                    variant="ghost"
                    onClick={() => setShowReportDialog(true)}
                    className="border border-red-500/20 text-red-300 hover:bg-red-500/10"
                  >
                    <Flag className="h-4 w-4" />
                    Report
                  </Button>
                </div>
              </div>
            </aside>
          </div>
        )}
      </main>

      <ReportDialog
        promptId={id}
        isOpen={showReportDialog}
        onClose={() => setShowReportDialog(false)}
        userAddress={wallet.address}
      />
      <Footer />
    </div>
  );
}

function Insight({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="border border-white/10 bg-white/[0.03] p-3">
      <p className="text-xs uppercase tracking-wider text-slate-500">{label}</p>
      <div className="mt-1 min-h-6 text-sm font-semibold text-slate-100">
        {children}
      </div>
    </div>
  );
}

function Option({
  label,
  selected,
  disabled,
}: {
  label: string;
  selected?: boolean;
  disabled?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between border px-3 py-2 text-sm ${
        selected
          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-200"
          : "border-white/10 bg-white/[0.02] text-slate-500"
      }`}
      aria-disabled={disabled}
    >
      <span>{label}</span>
      {selected ? <Check className="h-4 w-4" /> : <span>Soon</span>}
    </div>
  );
}
