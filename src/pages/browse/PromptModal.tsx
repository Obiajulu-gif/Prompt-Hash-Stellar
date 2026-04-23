import { useState } from "react";
import { LockKeyhole, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import {
  buyPromptAccess,
  type PromptRecord,
} from "@/lib/stellar/promptHashClient";
import { formatPriceLabel } from "@/lib/stellar/format";
import { unlockPromptContent } from "@/lib/prompts/unlock";
import { shortenAddress } from "@/lib/utils";
import { parseStellarError } from "@/util/stellar-errors";

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
  const { address, signMessage, signTransaction, isWrongNetwork } = useWallet();
  const [hasAccessState, setHasAccessState] = useState(initialHasAccess);
  const [plaintext, setPlaintext] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isBuying, setIsBuying] = useState(false);
  const [isUnlocking, setIsUnlocking] = useState(false);

  const handleUnlock = async () => {
    if (!address || !signMessage) {
      setError("Connect a Stellar wallet with SEP-43 message signing to unlock prompts.");
      return;
    }

    if (isWrongNetwork) {
      setError("Your wallet is connected to the wrong network. Switch to testnet.");
      return;
    }

    setError(null);
    setIsUnlocking(true);
    try {
      const response = await unlockPromptContent(address, prompt.id, signMessage);
      setPlaintext(response.plaintext);
    } catch (unlockError) {
      const parsed = parseStellarError(unlockError);
      if (parsed.type !== "USER_CANCELLED") {
        setError(parsed.message);
      }
    } finally {
      setIsUnlocking(false);
    }
  };

  const handleBuy = async () => {
    if (!address || !signTransaction) {
      setError("Connect a Stellar wallet before buying prompt access.");
      return;
    }

    if (isWrongNetwork) {
      setError("Your wallet is connected to the wrong network. Switch to testnet.");
      return;
    }

    setError(null);
    setIsBuying(true);
    try {
      await buyPromptAccess(
        browserStellarConfig,
        { signTransaction },
        address,
        prompt.id,
        prompt.priceStroops,
      );
      setHasAccessState(true);
      await onRefresh();
      await handleUnlock();
    } catch (buyError) {
      const parsed = parseStellarError(buyError);
      if (parsed.type !== "USER_CANCELLED") {
        setError(parsed.message);
      }
    } finally {
      setIsBuying(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/80 p-4">
      <div className="max-h-[92vh] w-full max-w-4xl overflow-auto rounded-3xl border border-white/10 bg-slate-950 text-white shadow-2xl">
        <div className="flex items-start justify-between border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.25em] text-emerald-300">
              Prompt license
            </p>
            <h2 className="mt-2 text-2xl font-semibold">{prompt.title}</h2>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="text-slate-200 hover:bg-white/10"
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
                {hasAccessState ? (
                  <Button
                    className="w-full bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                    onClick={handleUnlock}
                    disabled={isUnlocking}
                  >
                    {isUnlocking ? "Unlocking..." : "View full prompt"}
                  </Button>
                ) : (
                  <Button
                    className="w-full bg-emerald-400 text-slate-950 hover:bg-emerald-300"
                    onClick={handleBuy}
                    disabled={isBuying || !prompt.active}
                  >
                    {isBuying ? "Buying access..." : "Buy access"}
                  </Button>
                )}
                <p className="text-sm leading-6 text-slate-400">
                  Full prompt text stays encrypted on-chain. Unlock requires wallet
                  ownership verification and an on-chain access check.
                </p>
              </div>
            </div>

            {error ? (
              <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
                {error}
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
