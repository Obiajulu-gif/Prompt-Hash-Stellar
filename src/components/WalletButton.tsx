import { useState, useEffect } from "react";
import { Button } from "@stellar/design-system";
import { useWallet } from "../hooks/useWallet";
import { shortenAddress } from "@/lib/utils";
import { Button as ShadcnButton } from "./ui/button";
import { Loader2, AlertCircle, X } from "lucide-react";

export const WalletButton = () => {
  const [showModal, setShowModal] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const { address, status, error, connect, disconnect } = useWallet();
  const [dismissedError, setDismissedError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "error") setDismissedError(null);
  }, [status]);

  const handleConnect = async (id: string) => {
    setShowModal(false);
    await connect(id);
  };

  const handleDisconnect = () => {
    disconnect();
    setShowDisconnectModal(false);
  };

  return (
    <div className="relative flex flex-col items-center w-full">
      {status === "error" && error && dismissedError !== error && (
        <div className="absolute bottom-full right-0 mb-2 w-max max-w-xs bg-red-500 text-white text-xs pl-3 pr-2 py-2 rounded shadow-lg whitespace-normal z-50 flex items-start gap-1">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setDismissedError(error)} className="opacity-80 hover:opacity-100 transition-opacity ml-1 p-0.5" aria-label="Dismiss error">
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {(status === "idle" || status === "error") && (
        <ShadcnButton
          variant={"default"} size={"sm"}
          className="ml-auto font-bold border-purple-900 text-white hover:text-purple-300 hover:border-purple-800 min-w-[120px]"
          onClick={() => setShowModal(true)}
        >
          Connect Wallet
        </ShadcnButton>
      )}

      {(status === "selecting" || status === "connecting") && (
        <ShadcnButton
          disabled
          variant={"default"} size={"sm"}
          className="ml-auto font-bold border-purple-900 text-white min-w-[120px] cursor-not-allowed opacity-70"
        >
          <Loader2 className="mr-2 h-4 w-4 animate-spin shrink-0" />
          Opening Wallet...
        </ShadcnButton>
      )}

      {status === "reconnecting" && (
        <div className="ml-auto flex items-center space-x-2 text-sm text-slate-300 min-w-[120px] justify-center">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span>Restoring Session...</span>
        </div>
      )}

      {status === "connected" && address && (
        <ShadcnButton
          variant={"default"} size={"sm"}
          className="ml-auto font-bold border-purple-900 text-white hover:text-purple-300 hover:border-purple-800"
          onClick={() => setShowDisconnectModal((prev) => !prev)}
        >
          {shortenAddress(address)}
        </ShadcnButton>
      )}

      {showDisconnectModal && status === "connected" && (
        <div className="absolute mt-10 w-44 bg-[#070602] rounded-lg shadow-lg z-50 border border-white/10">
          <div>
            <Button size="md" variant="primary" onClick={handleDisconnect} className="w-full mx-auto p-2 text-white">
              Disconnect
            </Button>
          </div>
        </div>
      )}

      {showModal && (status === "idle" || status === "error") && (
        <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50">
          <div className="bg-slate-900 border border-white/10 rounded-lg p-6 shadow-xl max-w-sm w-full mx-4">
            <h3 className="text-lg font-bold mb-4 text-white">Select a Wallet</h3>
            <div className="flex flex-col space-y-3">
              <ShadcnButton variant="outline" onClick={() => void handleConnect("freighter")} className="w-full justify-start border-white/10 text-white hover:bg-white/10 hover:text-white">
                Freighter
              </ShadcnButton>
              <ShadcnButton variant="outline" onClick={() => void handleConnect("albedo")} className="w-full justify-start border-white/10 text-white hover:bg-white/10 hover:text-white">
                Albedo
              </ShadcnButton>
              <ShadcnButton variant="outline" onClick={() => void handleConnect("xbull")} className="w-full justify-start border-white/10 text-white hover:bg-white/10 hover:text-white">
                xBull
              </ShadcnButton>
            </div>
            <ShadcnButton variant="ghost" onClick={() => setShowModal(false)} className="mt-6 w-full text-slate-400 hover:text-white hover:bg-white/5">
              Cancel
            </ShadcnButton>
          </div>
        </div>
      )}
    </div>
  );
};
