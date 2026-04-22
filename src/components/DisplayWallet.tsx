import { useState, useEffect } from "react";
import { Wallet, LogOut, Loader2, AlertCircle, X } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { shortenAddress } from "@/lib/utils";
import { Button } from "./ui/button";

const DisplayWallet = () => {
  const { address, status, error, connect, disconnect } = useWallet();
  const { xlm, isLoading } = useWalletBalance();
  const [showModal, setShowModal] = useState(false);
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "error") setDismissedError(null);
  }, [status]);

  const handleConnect = async (id: string) => {
    setShowModal(false);
    await connect(id);
  };

  return (
    <div className="relative inline-flex items-center gap-2">
      {status === "error" && error && dismissedError !== error && (
        <div className="absolute top-full mt-2 right-0 w-max max-w-xs bg-red-500 text-white text-xs pl-3 pr-2 py-2 rounded shadow-lg whitespace-normal z-50 flex items-start gap-1">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setDismissedError(error)} className="opacity-80 hover:opacity-100 transition-opacity ml-1 p-0.5" aria-label="Dismiss error">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {(status === "idle" || status === "error") && (
        <Button
          onClick={() => setShowModal(true)}
          className="border border-amber-300/30 bg-amber-500 text-slate-950 hover:bg-amber-400 min-w-[150px]"
        >
          <Wallet className="mr-2 h-4 w-4 shrink-0" />
          Connect wallet
        </Button>
      )}

      {(status === "selecting" || status === "connecting") && (
        <Button disabled className="border border-amber-300/30 bg-amber-500/50 text-slate-950 cursor-not-allowed min-w-[150px]">
          <Loader2 className="mr-2 h-4 w-4 animate-spin shrink-0" />
          Opening Wallet...
        </Button>
      )}

      {status === "reconnecting" && (
        <div className="flex items-center space-x-2 px-3 py-2 text-sm text-slate-300 min-w-[150px] justify-center">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span>Restoring Session...</span>
        </div>
      )}

      {status === "connected" && address && (
        <div className="flex items-center gap-2">
          <div className="hidden rounded-full border border-white/15 bg-white/10 px-3 py-1 text-xs text-slate-100 md:block">
            {isLoading ? "Loading balance..." : `${xlm} XLM`}
          </div>
          <div className="rounded-full border border-white/15 bg-slate-950/50 px-3 py-2 text-sm text-slate-100">
            {shortenAddress(address)}
          </div>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="border border-white/10 text-slate-100 hover:bg-white/10 shrink-0"
            onClick={disconnect}
            title="Disconnect wallet"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      )}

      {showModal && (status === "idle" || status === "error") && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 shadow-xl max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold mb-4 text-white">Select a Wallet</h3>
            <div className="flex flex-col space-y-3">
              <Button variant="outline" onClick={() => void handleConnect("freighter")} className="w-full justify-start border-white/10 text-white hover:bg-white/10 hover:text-white">
                Freighter
              </Button>
              <Button variant="outline" onClick={() => void handleConnect("albedo")} className="w-full justify-start border-white/10 text-white hover:bg-white/10 hover:text-white">
                Albedo
              </Button>
              <Button variant="outline" onClick={() => void handleConnect("xbull")} className="w-full justify-start border-white/10 text-white hover:bg-white/10 hover:text-white">
                xBull
              </Button>
            </div>
            <Button
              variant="ghost"
              onClick={() => setShowModal(false)}
              className="mt-6 w-full text-slate-400 hover:text-white hover:bg-white/5"
            >
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DisplayWallet;
