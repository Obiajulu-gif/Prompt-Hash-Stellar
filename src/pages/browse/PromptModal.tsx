import React, { useState, useContext, useEffect, useRef } from "react";
import { WalletContext } from "../../providers/WalletProvider";
import { useAsyncTransaction } from "../../components/useAsyncTransaction";
import { PromptHashClient } from "../../lib/stellar/promptHashClient";
import { unlockPrompt } from "../../lib/prompts/unlock";
import { Skeleton } from "../../components/Skeleton";
import { StatusBanner } from "../../components/StatusBanner";
import { UnlockExplainer } from "../../components/UnlockExplainer";
import { copyToClipboard } from "../../lib/clipboard/secureClipboard";
import {
  CheckCircle,
  Loader2,
  LockKeyhole,
  X,
  ExternalLink,
  ShieldCheck,
  Wallet,
  MessageSquare,
  Copy,
  Check,
  User,
  DollarSign,
  ShoppingBag,
  Hash,
} from "lucide-react";
import { ReviewForm } from "../../components/prompts/ReviewForm";
import { ReviewList } from "../../components/prompts/ReviewList";
import { StarRating } from "../../components/prompts/StarRating";
import { UnlockErrorBanner } from "../../components/UnlockErrorBanner";
import { ReviewClient } from "../../lib/reviews/reviewClient";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { browserStellarConfig } from "../../lib/stellar/browserConfig";
import { stroopsToXlmString } from "../../lib/stellar/format";
import { NetworkMismatchBanner } from "../../components/wallet/NetworkMismatchBanner";
import { detectNetworkMismatch } from "../../lib/wallet/networkDetection";

export type BuyerStatus =
  | "IDLE"
  | "AWAITING_APPROVAL"
  | "CONFIRMING"
  | "PURCHASED_LOCKED"
  | "UNLOCKING"
  | "SUCCESS"
  | "ERROR";

interface PromptModalProps {
  itemId: string;
  isOpen: boolean;
  onClose: () => void;
  onRefresh?: () => void;
}

// Metadata display component
const PromptMetadataSection: React.FC<{ itemId: string; status: BuyerStatus }> = ({ itemId, status }) => {
  const { data: prompt, isLoading } = useQuery({
    queryKey: ["prompt-detail", itemId],
    queryFn: async () => {
      return await PromptHashClient.getPrompt(browserStellarConfig, BigInt(itemId));
    },
    enabled: !!itemId,
  });

  if (isLoading) {
    return (
      <div className="mb-6 space-y-3">
        <Skeleton className="h-4 w-full" />
        <Skeleton className="h-4 w-3/4" />
      </div>
    );
  }

  if (!prompt) return null;

  const isPurchased = status === "PURCHASED_LOCKED" || status === "SUCCESS";
  const priceXlm = stroopsToXlmString(prompt.priceStroops);

  return (
    <div className="mb-6 space-y-4">
      {/* Preview Content */}
      <div className="p-4 rounded-xl bg-white/5 border border-white/5">
        <p className="text-xs uppercase tracking-wider text-slate-400 mb-2">Preview</p>
        <p className="text-sm text-slate-300 leading-relaxed">{prompt.previewText}</p>
      </div>

      {/* Metadata Grid */}
      <div className="grid grid-cols-2 gap-3">
        <div className="p-3 rounded-lg bg-white/5 border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <User className="h-3 w-3 text-slate-400" />
            <p className="text-xs text-slate-400">Creator</p>
          </div>
          <p className="text-xs font-mono text-white truncate" title={prompt.creator}>
            {prompt.creator.slice(0, 8)}...{prompt.creator.slice(-4)}
          </p>
        </div>

        <div className="p-3 rounded-lg bg-white/5 border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <DollarSign className="h-3 w-3 text-slate-400" />
            <p className="text-xs text-slate-400">Price</p>
          </div>
          <p className="text-sm font-bold text-white">{priceXlm} XLM</p>
        </div>

        <div className="p-3 rounded-lg bg-white/5 border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <ShoppingBag className="h-3 w-3 text-slate-400" />
            <p className="text-xs text-slate-400">Sales</p>
          </div>
          <p className="text-sm font-bold text-white">{prompt.salesCount}</p>
        </div>

        <div className="p-3 rounded-lg bg-white/5 border border-white/5">
          <div className="flex items-center gap-2 mb-1">
            <Hash className="h-3 w-3 text-slate-400" />
            <p className="text-xs text-slate-400">Content Hash</p>
          </div>
          <p className="text-xs font-mono text-white truncate" title={prompt.contentHash}>
            {prompt.contentHash.slice(0, 8)}...
          </p>
        </div>
      </div>

      {/* Purchase State Indicator */}
      {isPurchased && (
        <div className="p-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20 flex items-center gap-2">
          <CheckCircle className="h-4 w-4 text-emerald-400" />
          <p className="text-xs text-emerald-300 font-semibold">You own this prompt license</p>
        </div>
      )}

      {!prompt.active && (
        <div className="p-3 rounded-lg bg-slate-500/10 border border-slate-500/20 flex items-center gap-2">
          <X className="h-4 w-4 text-slate-400" />
          <p className="text-xs text-slate-400 font-semibold">This prompt is currently unavailable</p>
        </div>
      )}
    </div>
  );
};

export const PromptModal: React.FC<PromptModalProps> = ({
  itemId,
  isOpen,
  onClose,
  onRefresh,
}) => {
  const wallet = useContext(WalletContext);
  const queryClient = useQueryClient();

  const [status, setStatus] = useState<BuyerStatus>("IDLE");
  const [txHash, setTxHash] = useState<string>("");
  const [secretContent, setSecretContent] = useState<string>("");
  const [isCheckingAccess, setIsCheckingAccess] = useState(false);
  const [showReviewForm, setShowReviewForm] = useState(false);
  const [copyFeedback, setCopyFeedback] = useState<{
    visible: boolean;
    success: boolean;
    message: string;
  }>({ visible: false, success: false, message: "" });
  const copyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const lastActiveElementRef = useRef<HTMLElement | null>(null);

  // Fetch reviews for this prompt
  const { data: reviewData, isLoading: reviewsLoading } = useQuery({
    queryKey: ["reviews", itemId],
    queryFn: () => ReviewClient.getReviews(itemId),
    enabled: isOpen,
  });

  useEffect(() => {
    if (isOpen) {
      lastActiveElementRef.current = document.activeElement as HTMLElement;
      setTimeout(() => closeButtonRef.current?.focus(), 0);

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === "Escape") {
          onClose();
          return;
        }

        if (e.key === "Tab") {
          if (!modalRef.current) return;
          const focusableElements = modalRef.current.querySelectorAll(
            'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
          );
          if (focusableElements.length === 0) return;

          const firstElement = focusableElements[0] as HTMLElement;
          const lastElement = focusableElements[focusableElements.length - 1] as HTMLElement;

          if (e.shiftKey) {
            // Shift + Tab
            if (document.activeElement === firstElement) {
              lastElement.focus();
              e.preventDefault();
            }
          } else {
            // Tab
            if (document.activeElement === lastElement) {
              firstElement.focus();
              e.preventDefault();
            }
          }
        }
      };

      document.addEventListener("keydown", handleKeyDown);
      return () => {
        document.removeEventListener("keydown", handleKeyDown);
        if (lastActiveElementRef.current) {
          lastActiveElementRef.current.focus();
        }
      };
    }
  }, [isOpen, onClose]);

  useEffect(() => {
    if (isOpen && wallet?.address) {
      setIsCheckingAccess(true);
      PromptHashClient.checkAccess(itemId, wallet.address)
        .then((hasAccess) => setStatus(hasAccess ? "PURCHASED_LOCKED" : "IDLE"))
        .catch(() => setStatus("IDLE"))
        .finally(() => setIsCheckingAccess(false));
    }
  }, [isOpen, itemId, wallet?.address]);

  const {
    execute: runUnlock,
    isLoading: isUnlocking,
    error: unlockError,
  } = useAsyncTransaction(
    async (hash: string) => {
      if (!wallet?.signMessage || !wallet.address) throw new Error("Wallet not connected");
      return await unlockPrompt(itemId, hash, wallet.signMessage, wallet.address);
    },
    {
      onOptimistic: () => setStatus("UNLOCKING"),
      onSuccess: (data) => {
        setSecretContent(data.decryptedContent);
        setStatus("SUCCESS");
      },
      onError: () => setStatus("PURCHASED_LOCKED"),
    },
  );

  const {
    execute: runPurchase,
    isLoading: isPurchasing,
    error: purchaseError,
  } = useAsyncTransaction(
    async () => {
      if (!wallet?.address) throw new Error("Wallet connection required.");
      
      // Check network state before purchase
      const networkState = detectNetworkMismatch(
        !!wallet.address,
        wallet.network,
        wallet.status
      );
      
      if (networkState.type === "wrong-network") {
        throw new Error(networkState.message || "Wrong network connected");
      }
      
      if (networkState.type === "disconnected") {
        throw new Error("Please connect your wallet first");
      }
      
      setStatus("AWAITING_APPROVAL");
      const mockHash = "tx_" + Math.random().toString(16).slice(2, 14);
      setTxHash(mockHash);
      setStatus("CONFIRMING");
      return await PromptHashClient.purchasePrompt(itemId, wallet.address);
    },
    {
      onSuccess: (data) => {
        setStatus("UNLOCKING");
        onRefresh?.();
        runUnlock(data.txHash || txHash).catch(() => {});
      },
      onError: () => setStatus("ERROR"),
    },
  );

  const handleCopyContent = async () => {
    if (copyTimeoutRef.current) {
      clearTimeout(copyTimeoutRef.current);
    }

    const result = await copyToClipboard(secretContent);

    setCopyFeedback({
      visible: true,
      success: result.success,
      message: result.success
        ? "Copied to clipboard"
        : result.error || "Failed to copy",
    });

    copyTimeoutRef.current = setTimeout(() => {
      setCopyFeedback((prev) => ({ ...prev, visible: false }));
    }, 3000);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-3 backdrop-blur-md sm:p-4">
      <div
        ref={modalRef}
        className="relative max-h-[94vh] w-full max-w-lg overflow-y-auto rounded-[28px] border border-white/10 bg-slate-900 shadow-2xl sm:rounded-[32px]"
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
        aria-describedby="prompt-modal-description"
      >
        {/* Header Decor */}
        <div className="h-2 w-full bg-gradient-to-r from-emerald-500 to-blue-500" />

        <button
          ref={closeButtonRef}
          onClick={onClose}
          className="absolute top-6 right-6 p-2 rounded-full bg-white/5 text-slate-400 hover:text-white transition-all z-10"
          aria-label="Close prompt modal"
        >
          <X className="w-4 h-4" />
        </button>

        <div className="p-5 sm:p-8">
          <div className="mb-6 sm:mb-8">
            <h2 id="prompt-modal-title" className="mb-2 text-2xl font-bold text-white">
              Acquire License
            </h2>
            <p id="prompt-modal-description" className="text-sm text-slate-400">
              Unlock high-quality prompt content via Stellar smart contract.
            </p>
          </div>

          {/* Prompt Metadata Section */}
          <PromptMetadataSection itemId={itemId} status={status} />

          {isCheckingAccess ? (
            <div className="space-y-4 py-4">
              <Skeleton className="h-4 w-full" />
              <Skeleton className="h-4 w-2/3" />
              <div className="h-14 w-full bg-white/5 rounded-2xl animate-pulse mt-8" />
            </div>
          ) : (
            <div className="space-y-6">
              {/* Network Mismatch Warning */}
              <NetworkMismatchBanner />

              {/* TRANSACTION STAGES */}
              {(status === "IDLE" || status === "ERROR") && (
                <div className="space-y-6">
                  <div className="p-5 rounded-2xl bg-white/5 border border-white/5 flex gap-4 items-start">
                    <ShieldCheck className="w-6 h-6 text-emerald-400 shrink-0" />
                    <div>
                      <h4 className="text-sm font-bold text-white">
                        Secure Purchase
                      </h4>
                      <p className="text-xs text-slate-400 leading-relaxed mt-1">
                        Funds are held by the contract until access rights are
                        minted. Platform fee is included in the price.
                      </p>
                    </div>
                  </div>

                  {status === "ERROR" && purchaseError && (
                    <StatusBanner
                      status="error"
                      message={purchaseError.message}
                    />
                  )}

                  <button
                    onClick={() => runPurchase().catch(() => {})}
                    disabled={
                      isPurchasing || 
                      detectNetworkMismatch(!!wallet?.address, wallet?.network, wallet?.status).type !== "correct"
                    }
                    className="group w-full h-14 bg-white text-slate-950 hover:bg-emerald-400 font-black rounded-2xl transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    Confirm & Purchase <Wallet className="w-4 h-4" />
                  </button>
                </div>
              )}

              {status === "AWAITING_APPROVAL" && (
                <div className="flex flex-col items-center justify-center py-12 space-y-6 text-center" role="status" aria-live="polite">
                  <div className="relative">
                    <Loader2 className="w-12 h-12 text-emerald-500 animate-spin" aria-hidden="true" />
                    <div className="absolute inset-0 blur-xl bg-emerald-500/20" />
                  </div>
                  <p className="text-slate-200 font-bold text-lg italic tracking-tight">
                    Confirming in Wallet...
                  </p>
                </div>
              )}

              {status === "CONFIRMING" && (
                <div className="py-6 text-center" role="status" aria-live="polite">
                  <StatusBanner
                    status="pending"
                    message="Broadcasting to Stellar..."
                  />
                  {txHash && (
                    <a
                      href={`https://stellar.expert/explorer/testnet/tx/${txHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="inline-flex items-center gap-2 mt-6 text-xs text-slate-500 hover:text-emerald-400 font-mono transition-colors"
                    >
                      View Transaction <ExternalLink className="h-3 w-3" />
                    </a>
                  )}
                </div>
              )}

              {status === "PURCHASED_LOCKED" && (
                <div className="space-y-6">
                  <div className="p-6 rounded-3xl bg-emerald-500/10 border border-emerald-500/20 flex flex-col items-center text-center">
                    <LockKeyhole className="w-8 h-8 text-emerald-400 mb-3" />
                    <h4 className="font-bold text-white">License Verified</h4>
                    <p className="text-xs text-slate-400 mt-2">
                      Ownership detected on-chain. Sign the unlock request to
                      decrypt.
                    </p>
                  </div>

                  {/* Explain what the signature does — always visible before and during signing */}
                  <UnlockExplainer
                    state="signing"
                    onRetry={
                      unlockError
                        ? () => runUnlock(txHash || "existing")
                        : undefined
                    }
                  />

                  {unlockError && (
                    <UnlockErrorBanner
                      message={unlockError.message}
                      onRetry={() => runUnlock(txHash || "existing").catch(() => {})}
                    />
                  )}

                  <button
                    onClick={() => runUnlock(txHash || "existing").catch(() => {})}
                    disabled={isUnlocking}
                    className="w-full h-14 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-black rounded-2xl transition-all shadow-[0_0_20px_-5px_rgba(16,185,129,0.4)]"
                  >
                    {isUnlocking ? "Unlocking..." : "Decrypt Content"}
                  </button>
                </div>
              )}

              {status === "SUCCESS" && (
                <div className="animate-in fade-in zoom-in duration-300">
                  <div className="flex items-center gap-2 text-emerald-400 font-bold mb-4">
                    <CheckCircle className="h-5 w-5" /> Access Granted
                  </div>
                  <div className="relative group">
                    <div className="absolute -inset-1 bg-gradient-to-r from-emerald-500 to-blue-500 rounded-2xl blur opacity-20 group-hover:opacity-30 transition" />
                    <div className="relative bg-black border border-white/5 rounded-xl p-6 max-h-[300px] overflow-y-auto">
                      <pre className="text-sm text-slate-300 whitespace-pre-wrap font-mono leading-relaxed">
                        {secretContent}
                      </pre>
                    </div>
                  </div>

                  <div className="mt-4 flex gap-3">
                    <button
                      onClick={handleCopyContent}
                      className="flex-1 flex items-center justify-center gap-2 h-12 bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-400 font-semibold rounded-xl transition-all border border-emerald-500/30"
                      title="Copy prompt content to clipboard"
                    >
                      {copyFeedback.visible && copyFeedback.success ? (
                        <>
                          <Check className="h-4 w-4" />
                          Copied
                        </>
                      ) : (
                        <>
                          <Copy className="h-4 w-4" />
                          Copy
                        </>
                      )}
                    </button>
                  </div>

                  {copyFeedback.visible && !copyFeedback.success && (
                    <div className="mt-3 p-3 bg-red-500/10 border border-red-500/20 rounded-lg text-xs text-red-400">
                      {copyFeedback.message}
                    </div>
                  )}

                  <div className="mt-4 p-4 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                    <p className="text-xs text-blue-300 leading-relaxed">
                      Please store your purchased prompt content securely. Do not share this content publicly or with unauthorized users.
                    </p>
                  </div>

                  {/* Review Section */}
                  {wallet?.address && (
                    <div className="mt-6 pt-6 border-t border-white/10">
                      {!showReviewForm ? (
                        <button
                          onClick={() => setShowReviewForm(true)}
                          className="w-full flex items-center justify-center gap-2 h-12 bg-white/5 hover:bg-white/10 text-white font-semibold rounded-xl transition-all"
                        >
                          <MessageSquare className="h-4 w-4" />
                          Write a Review
                        </button>
                      ) : (
                        <div className="space-y-4">
                          <h4 className="text-sm font-bold text-white">Share Your Experience</h4>
                          <ReviewForm
                            promptId={itemId}
                            onSubmit={async (review) => {
                              await ReviewClient.submitReview(
                                itemId,
                                wallet.address!,
                                review.rating,
                                review.text
                              );
                              queryClient.invalidateQueries({ queryKey: ["reviews", itemId] });
                              queryClient.invalidateQueries({ queryKey: ["review-stats", itemId] });
                              setShowReviewForm(false);
                            }}
                            onCancel={() => setShowReviewForm(false)}
                          />
                        </div>
                      )}
                    </div>
                  )}

                  <button
                    onClick={onClose}
                    className="w-full mt-6 h-12 bg-white/5 hover:bg-white/10 text-white font-bold rounded-xl transition-all"
                  >
                    Back to Marketplace
                  </button>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Reviews Tab */}
        {reviewData && (
          <div className="border-t border-white/10 p-5 sm:p-8">
            <div className="mb-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-xl font-bold text-white">Reviews</h3>
                {reviewData.stats.total > 0 && (
                  <div className="flex items-center gap-3">
                    <StarRating
                      rating={reviewData.stats.averageRating}
                      readonly
                      size="md"
                    />
                    <span className="text-sm text-slate-400">
                      {reviewData.stats.averageRating.toFixed(1)} out of 5
                    </span>
                  </div>
                )}
              </div>
            </div>
            <ReviewList reviews={reviewData.reviews} isLoading={reviewsLoading} />
          </div>
        )}
      </div>
    </div>
  );
};
