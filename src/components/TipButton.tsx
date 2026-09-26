import { useState } from "react";
import { Heart, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useWallet } from "@/hooks/useWallet";
import { browserStellarConfig } from "@/lib/stellar/browserConfig";
import { approveNativeAssetSpend } from "@/lib/stellar/nativeAssetClient";
import { xlmToStroops } from "@/lib/stellar/format";

const PRESET_AMOUNTS = [1, 3, 5, 10];

export interface TipButtonProps {
  creatorAddress: string;
  onTipSent?: (_amount: string) => void;
}
 

export function TipButton({ creatorAddress, onTipSent }: TipButtonProps) {
  const { address, signTransaction } = useWallet();
  const [amount, setAmount] = useState(1);
  const [sending, setSending] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canTip =
    Boolean(address) &&
    Boolean(signTransaction) &&
    Boolean(creatorAddress) &&
    address !== creatorAddress &&
    amount > 0;

  const handleTip = async () => {
    if (!address || !signTransaction) return;
    setSending(true);
    setError(null);
    setSuccess(false);
    try {
      const stroops = xlmToStroops(amount);
      await approveNativeAssetSpend(
        browserStellarConfig,
        { signTransaction },
        address,
        creatorAddress,
        stroops,
        // Expiration ledger: ~5 minutes from now at ~5s per ledger
        Math.floor(Date.now() / 5000) + 60,
      );
      setSuccess(true);
      onTipSent?.(amount.toString());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to send tip.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-rose-400/10 text-rose-300">
          <Heart className="h-4 w-4" />
        </div>
        <div>
          <p className="text-sm font-semibold text-white">Tip Creator</p>
          <p className="text-xs text-slate-500">
            Send XLM directly — no marketplace contract involved.
          </p>
        </div>
      </div>

      {/* Preset amounts */}
      <div className="flex flex-wrap gap-2">
        {PRESET_AMOUNTS.map((preset) => (
          <button
            key={preset}
            type="button"
            onClick={() => setAmount(preset)}
            className={`rounded-lg px-3 py-1.5 text-xs font-semibold transition-colors ${
              amount === preset
                ? "bg-emerald-500 text-slate-950"
                : "border border-white/10 bg-white/[0.04] text-slate-300 hover:bg-white/10"
            }`}
          >
            {preset} XLM
          </button>
        ))}
        <input
          type="number"
          min={1}
          max={1000}
          value={amount}
          onChange={(e) => setAmount(Math.max(1, Number(e.target.value)))}
          className="w-20 rounded-lg border border-white/10 bg-white/[0.04] px-2 py-1.5 text-xs text-slate-200 focus:border-emerald-500/50 focus:outline-none"
          aria-label="Custom tip amount in XLM"
        />
      </div>

      <Button
        onClick={() => void handleTip()}
        disabled={sending || !canTip}
        className="w-full h-10 bg-rose-500 hover:bg-rose-400 text-white font-bold disabled:opacity-40"
      >
        {sending ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Sending tip…
          </>
        ) : (
          <>
            <Heart className="h-4 w-4" />
            Send {amount} XLM tip
          </>
        )}
      </Button>

      {!address && (
        <p className="text-xs text-slate-500 text-center">
          Connect a wallet to send tips.
        </p>
      )}
      {address === creatorAddress && (
        <p className="text-xs text-slate-500 text-center">
          You cannot tip your own profile.
        </p>
      )}
      {success && (
        <p className="text-xs text-emerald-400 text-center font-medium">
          Tip sent! Thank you for supporting this creator.
        </p>
      )}
      {error && (
        <p className="text-xs text-rose-400 text-center">{error}</p>
      )}
    </div>
  );
}
