import { useState, useEffect, useCallback } from "react";
import { LockKeyhole, X, ExternalLink, AlertCircle, RefreshCw, CheckCircle, Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import {
  buyPromptAccess,
  hasAccess,
  type PromptRecord,
} from "@/lib/stellar/promptHashClient";
import { formatPriceLabel } from "@/lib/stellar/format";
import { unlockPromptContent } from "@/lib/prompts/unlock";
import { shortenAddress } from "@/lib/utils";
import { useAsyncTransaction } from "@/components/useAsyncTransaction";
import { stellarNetwork } from "@/lib/env";

export type ModalStatus =
  | "IDLE"
  | "AWAITING_APPROVAL"
  | "SUBMITTING_TX"
  | "CONFIRMING_PURCHASE"
  | "PURCHASED_LOCKED"
  | "UNLOCKING"
  | "UNLOCKED"
  | "PURCHASE_ERROR"
  | "UNLOCK_ERROR"
  | "INACTIVE_LISTING"
  | "SIGNING_REJECTED"
  | "DUPLICATE_PURCHASE";

export interface PurchaseResult {
  txHash: string;
  success: boolean;
}

export const PromptModal = ({
  prompt,
  initialHasAccess,
  closeModal,
  onRefresh,
}: {
  prompt: PromptRecord;
  initialHasAccess: boolean;
  closeModal: () => void;
  onRefresh: () => Promise<void>;
}) => {
  const { address, signMessage, signTransaction } = useWallet();
  const [status, setStatus] = useState<ModalStatus>(initialHasAccess ? "PURCHASED_LOCKED" : "IDLE");
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [txHash, setTxHash] = useState<string | null>(null);
  const [customError, setCustomError] = useState<string | null>(null);
  const [lastPurchaseTxHash, setLastPurchaseTxHash] = useState<string | null>(null);

  // Handle initial access state
  useEffect(() => {
    setStatus((prev) => {
      if (initialHasAccess && (prev === "IDLE" || prev === "PURCHASE_ERROR" || prev === "DUPLICATE_PURCHASE")) {
        return "PURCHASED_LOCKED";
      }
      return prev;
    });
  }, [initialHasAccess]);

  // Handle inactive listing state
  useEffect(() => {
    if (!prompt.active && status === "IDLE") {
      setStatus("INACTIVE_LISTING");
      setCustomError("This prompt is no longer available for purchase.");
    }
  }, [prompt.active, status]);

  // Refresh access state from contract after purchase
  const verifyAccess = useCallback(async (): Promise<boolean> => {
    if (!address) return false;
    try {
      return await hasAccess(browserStellarConfig, address, prompt.id);
    } catch {
      return false;
    }
  }, [address, prompt.id]);

  // Unlock with proper error handling for different failure types
  const { execute: runUnlock, error: unlockError } = useAsyncTransaction(
    async () => {
      setCustomError(null);
      setStatus("UNLOCKING");
      
      if (!address || !signMessage) {
        throw new Error("Connect a Stellar wallet with SEP-43 message signing to unlock prompts.");
      }

      // Verify we have access before attempting unlock
      const hasAccessNow = await verifyAccess();
      if (!hasAccessNow) {
        throw new Error("NO_ACCESS");
      }

      return await unlockPromptContent(address, prompt.id, signMessage);
    },
    {
      pendingMessage: "Unlocking prompt content...",
      successMessage: "Prompt unlocked successfully!",
      onSuccess: (data) => {
        setPlaintext(data.plaintext);
        setStatus("UNLOCKED");
      },
      onError: (err) => {
        const message = err.message || "";
        
        if (message.includes("NO_ACCESS")) {
          setStatus("PURCHASE_ERROR");
          setCustomError("Purchase access not found. Please try purchasing again.");
        } else if (message.includes("User declined") || message.includes("rejected")) {
          setStatus("SIGNING_REJECTED");
          setCustomError("Signing was rejected. You can retry the unlock when ready.");
        } else if (message.includes("401") || message.includes("unauthorized")) {
          setStatus("UNLOCK_ERROR");
          setCustomError("Authentication failed. Please try unlocking again.");
        } else if (message.includes("403") || message.includes("forbidden")) {
          setStatus("UNLOCK_ERROR");
          setCustomError("Access denied. Please contact support if this persists.");
        } else if (message.includes("404") || message.includes("not found")) {
          setStatus("UNLOCK_ERROR");
          setCustomError("Prompt not found on server. Please try again later.");
        } else {
          setStatus("UNLOCK_ERROR");
        }
      },
    }
  );

  // Purchase with proper state tracking and error handling
  const { execute: runPurchase, error: purchaseError } = useAsyncTransaction(
    async () => {
      setCustomError(null);
      
      if (!address || !signTransaction) {
        throw new Error("Connect a Stellar wallet before buying prompt access.");
      }

      // Check for inactive listing first
      if (!prompt.active) {
        throw new Error("INACTIVE_LISTING");
      }

      setStatus("AWAITING_APPROVAL");
      const alreadyOwns = await hasAccess(browserStellarConfig, address, prompt.id);
      if (alreadyOwns) {
        setCustomError("You already have access to this prompt. You can now unlock it.");
        throw new Error("DUPLICATE_PURCHASE");
      }

      setStatus("SUBMITTING_TX");
      const result = await buyPromptAccess(
        browserStellarConfig,
        { signTransaction },
        address,
        prompt.id,
        prompt.priceStroops,
      );
      
      // Track the transaction hash
      if (result.txHash) {
        setLastPurchaseTxHash(result.txHash);
        setTxHash(result.txHash);
      }

      setStatus("CONFIRMING_PURCHASE");
      
      // Refresh access state from contract rather than assuming success
      const accessConfirmed = await verifyAccess();
      if (!accessConfirmed) {
        throw new Error("PURCHASE_NOT_CONFIRMED");
      }
      
      return result;
    },
    {
      pendingMessage: "Purchasing prompt access...",
      successMessage: "Purchase confirmed!",
      onSuccess: () => {
        setStatus("PURCHASED_LOCKED");
        // Trigger parent refresh
        onRefresh().catch(() => {});
        // Automatically attempt unlock after successful purchase
        runUnlock().catch(() => {});
      },
      onError: (err: Error) => {
        const message = err.message || "";
        
        if (message === "DUPLICATE_PURCHASE") {
          setStatus("PURCHASED_LOCKED");
        } else if (message === "INACTIVE_LISTING") {
          setStatus("INACTIVE_LISTING");
          setCustomError("This prompt is no longer available for purchase.");
        } else if (message === "PURCHASE_NOT_CONFIRMED") {
          setStatus("PURCHASE_ERROR");
          setCustomError("Purchase transaction may have succeeded but access was not confirmed. Check your wallet and try again.");
        } else if (message.includes("User declined") || message.includes("rejected")) {
          setStatus("PURCHASE_ERROR");
          setCustomError("Transaction was rejected. You can retry the purchase when ready.");
        } else if (message.includes("insufficient") || message.includes("balance")) {
          setStatus("PURCHASE_ERROR");
          setCustomError("Insufficient balance. Please fund your wallet and try again.");
        } else if (message.includes("timeout") || message.includes("TIMEOUT")) {
          setStatus("PURCHASE_ERROR");
          setCustomError("Transaction timed out. Please check your wallet and try again.");
        } else {
          setStatus("PURCHASE_ERROR");
        }
      },
    }
  );

  const displayError = customError || (purchaseError?.message !== "DUPLICATE_PURCHASE" ? purchaseError?.message : null) || unlockError?.message;

  const getButtonState = () => {
    switch (status) {
      case "AWAITING_APPROVAL":
        return { 
          text: "Awaiting Wallet Approval...", 
          disabled: true, 
          action: undefined,
          icon: <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        };
      case "SUBMITTING_TX":
        return { 
          text: "Submitting Transaction...", 
          disabled: true, 
          action: undefined,
          icon: <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        };
      case "CONFIRMING_PURCHASE":
        return { 
          text: "Confirming Purchase...", 
          disabled: true, 
          action: undefined,
          icon: <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        };
      case "PURCHASE_ERROR":
        return { 
          text: "Retry Purchase", 
          disabled: false, 
          action: runPurchase,
          icon: <RefreshCw className="mr-2 h-4 w-4" />
        };
      case "PURCHASED_LOCKED":
        return { 
          text: "View full prompt", 
          disabled: false, 
          action: runUnlock,
          icon: <LockKeyhole className="mr-2 h-4 w-4" />
        };
      case "UNLOCKING":
        return { 
          text: "Unlocking...", 
          disabled: true, 
          action: undefined,
          icon: <Loader2 className="mr-2 h-4 w-4 animate-spin" />
        };
      case "UNLOCK_ERROR":
        return { 
          text: "Retry Unlock", 
          disabled: false, 
          action: runUnlock,
          icon: <RefreshCw className="mr-2 h-4 w-4" />
        };
      case "UNLOCKED":
        return { 
          text: "Prompt Unlocked", 
          disabled: true, 
          action: undefined,
          icon: <CheckCircle className="mr-2 h-4 w-4" />
        };
      case "INACTIVE_LISTING":
        return { 
          text: "Unavailable", 
          disabled: true, 
          action: undefined,
          icon: undefined
        };
      case "SIGNING_REJECTED":
        return { 
          text: "Retry Unlock", 
          disabled: false, 
          action: runUnlock,
          icon: <RefreshCw className="mr-2 h-4 w-4" />
        };
      case "DUPLICATE_PURCHASE":
        return { 
          text: "Already Owned - Unlock", 
          disabled: false, 
          action: runUnlock,
          icon: <LockKeyhole className="mr-2 h-4 w-4" />
        };
      case "IDLE":
      default:
        return { 
          text: "Buy access", 
          disabled: !prompt.active, 
          action: runPurchase,
          icon: undefined
        };
    }
  };

  const buttonState = getButtonState();

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="prompt-modal-title"
        className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-3xl border border-white/10 bg-slate-950 text-white shadow-2xl"
      >
        <div className="flex items-start justify-between border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-emerald-300">
              Prompt license
            </p>
            <h2 id="prompt-modal-title" className="mt-2 text-2xl font-semibold">
              {prompt.title}
            </h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-200 hover:bg-white/10"
            aria-label="Close prompt details"
            onClick={closeModal}
          >
            <X className="h-5 w-5" />
          </Button>
        </div>

        <div className="grid gap-6 p-6 lg:grid-cols-[1fr_0.95fr]">
          <div className="space-y-5">
            <img
              src={prompt.imageUrl || "/images/codeguru.png"}
              alt={prompt.title}
              className="aspect-video w-full rounded-3xl object-cover"
            />
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="mb-4 flex flex-wrap items-center gap-3">
                <Badge className="bg-slate-900 text-emerald-200">
                  {prompt.category}
                </Badge>
                <Badge
                  className={
                    prompt.active
                      ? "bg-emerald-400/15 text-emerald-200"
                      : "bg-red-400/15 text-red-200"
                  }
                >
                  {prompt.active ? "Active listing" : "Inactive listing"}
                </Badge>
              </div>
              <h3 className="text-sm uppercase tracking-[0.25em] text-slate-400">
                Public preview
              </h3>
              <p className="mt-3 text-sm leading-7 text-slate-200">
                {prompt.previewText}
              </p>
            </div>
          </div>

          <div className="space-y-5">
            <div className="rounded-3xl border border-white/10 bg-white/5 p-5">
              <div className="grid grid-cols-2 gap-4 text-sm">
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Seller
                  </p>
                  <p className="mt-2 font-medium text-slate-100">
                    {shortenAddress(prompt.creator)}
                  </p>
                </div>
                <div>
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                    Sales count
                  </p>
                  <p className="mt-2 font-medium text-slate-100">
                    {prompt.salesCount}
                  </p>
                </div>
              </div>
              <div className="mt-5 rounded-2xl border border-white/10 bg-slate-950/60 p-4">
                <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
                  Price
                </p>
                <p className="mt-2 text-3xl font-semibold">
                  {formatPriceLabel(prompt.priceStroops)}
                </p>
              </div>
              <div className="mt-5 space-y-3">
                {/* Transaction Status Indicator */}
                {status !== "IDLE" && status !== "UNLOCKED" && (
                  <div className={`rounded-2xl border px-4 py-3 text-sm ${
                    status === "PURCHASE_ERROR" || status === "UNLOCK_ERROR" || status === "INACTIVE_LISTING"
                      ? "border-red-400/20 bg-red-500/10"
                      : status === "PURCHASED_LOCKED" || status === "SIGNING_REJECTED" || status === "DUPLICATE_PURCHASE"
                      ? "border-amber-400/20 bg-amber-500/10"
                      : "border-blue-400/20 bg-blue-500/10"
                  }`}>
                    <div className="flex items-center gap-2">
                      {status === "AWAITING_APPROVAL" || status === "SUBMITTING_TX" || status === "CONFIRMING_PURCHASE" || status === "UNLOCKING" ? (
                        <Loader2 className="h-4 w-4 animate-spin text-blue-400" />
                      ) : status === "PURCHASE_ERROR" || status === "UNLOCK_ERROR" || status === "INACTIVE_LISTING" ? (
                        <AlertCircle className="h-4 w-4 text-red-400" />
                      ) : status === "PURCHASED_LOCKED" || status === "SIGNING_REJECTED" || status === "DUPLICATE_PURCHASE" ? (
                        <AlertCircle className="h-4 w-4 text-amber-400" />
                      ) : null}
                      <span className={
                        status === "PURCHASE_ERROR" || status === "UNLOCK_ERROR" || status === "INACTIVE_LISTING"
                          ? "text-red-200"
                          : status === "PURCHASED_LOCKED" || status === "SIGNING_REJECTED" || status === "DUPLICATE_PURCHASE"
                          ? "text-amber-200"
                          : "text-blue-200"
                      }>
                        {status === "AWAITING_APPROVAL" && "Waiting for wallet approval..."}
                        {status === "SUBMITTING_TX" && "Submitting transaction to network..."}
                        {status === "CONFIRMING_PURCHASE" && "Confirming on-chain purchase..."}
                        {status === "PURCHASED_LOCKED" && "Purchase successful! Ready to unlock."}
                        {status === "UNLOCKING" && "Verifying ownership and decrypting..."}
                        {status === "PURCHASE_ERROR" && "Purchase failed. You can retry."}
                        {status === "UNLOCK_ERROR" && "Unlock failed. You can retry."}
                        {status === "INACTIVE_LISTING" && "This listing is no longer active."}
                        {status === "SIGNING_REJECTED" && "Signing was rejected. Retry available."}
                        {status === "DUPLICATE_PURCHASE" && "You already own this prompt."}
                      </span>
                    </div>
                  </div>
                )}
                
                <Button
                  className="w-full bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                  onClick={() => buttonState.action?.()}
                  disabled={buttonState.disabled}
                >
                  {buttonState.icon}
                  {buttonState.text}
                </Button>
                {(txHash || lastPurchaseTxHash) && (
                  <div className="mt-2 flex items-center justify-between text-xs text-slate-400">
                    <span>Transaction: {shortenAddress(txHash || lastPurchaseTxHash || "")}</span>
                    <a
                      href={`https://stellar.expert/explorer/${stellarNetwork.toLowerCase()}/tx/${txHash || lastPurchaseTxHash}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex items-center gap-1 hover:text-emerald-400 transition-colors"
                    >
                      View explorer <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>
                )}
                <p className="text-sm leading-6 text-slate-400">
                  Full prompt text stays encrypted on-chain. Unlock requires wallet
                  ownership verification and an on-chain access check.
                </p>
              </div>
            </div>

            {displayError ? (
              <div className={`rounded-2xl border px-4 py-3 text-sm flex items-start gap-3 ${
                displayError.includes("already have access") || displayError.includes("You already")
                  ? "border-emerald-400/20 bg-emerald-500/10 text-emerald-200"
                  : displayError.includes("unavailable") || displayError.includes("no longer available")
                  ? "border-amber-400/20 bg-amber-500/10 text-amber-200"
                  : "border-red-400/20 bg-red-500/10 text-red-200"
              }`}>
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <div className="flex-1">
                  <span>{displayError}</span>
                  {/* Recovery action for purchase succeeded but unlock failed */}
                  {(status === "PURCHASE_ERROR" || status === "UNLOCK_ERROR") && lastPurchaseTxHash && (
                    <button
                      onClick={() => {
                        setCustomError(null);
                        setStatus("PURCHASED_LOCKED");
                      }}
                      className="mt-2 block text-xs underline hover:text-emerald-300"
                    >
                      I already purchased this - refresh access
                    </button>
                  )}
                </div>
              </div>
            ) : null}

            {plaintext ? (
              <div className="rounded-3xl border border-emerald-400/20 bg-emerald-500/10 p-5">
                <div className="mb-4 flex items-center gap-2 text-emerald-200">
                  <LockKeyhole className="h-4 w-4" />
                  <span className="text-xs uppercase tracking-[0.25em]">
                    Unlocked content
                  </span>
                </div>
                <pre className="whitespace-pre-wrap text-sm leading-7 text-slate-100">
                  {plaintext}
                </pre>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
};
