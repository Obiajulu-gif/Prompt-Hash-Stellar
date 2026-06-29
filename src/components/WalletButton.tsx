import { useState, useEffect, useRef } from "react";
import { useWallet } from "../hooks/useWallet";
import { shortenAddress } from "@/lib/utils";
import { Button } from "./ui/button";
import { Loader2, AlertCircle, X, RefreshCw, Wallet } from "lucide-react";
import { WalletModal } from "./wallet/WalletModal";

export const WalletButton = () => {
  const [showModal, setShowModal] = useState(false);
  const [showDisconnectModal, setShowDisconnectModal] = useState(false);
  const { address, status, error, connect, disconnect } = useWallet();
  const [dismissedError, setDismissedError] = useState<string | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (status !== "error") setDismissedError(null);
  }, [status]);

  const handleRetry = () => {
    setDismissedError(null);
    setShowModal(true);
  };

  const handleDisconnect = () => {
    disconnect();
    setShowDisconnectModal(false);
  };

  // Close disconnect menu when clicking outside
  useEffect(() => {
    if (!showDisconnectModal) return;

    const handleClickOutside = (e: MouseEvent) => {
      if (buttonRef.current && !buttonRef.current.contains(e.target as Node)) {
        setShowDisconnectModal(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [showDisconnectModal]);

  return (
    <div className="relative flex flex-col items-center w-full">
      {/* Error toast */}
      {status === "error" && error && dismissedError !== error && (
        <div className="absolute bottom-full right-0 mb-2 w-max max-w-xs bg-red-500/95 text-white text-xs pl-3 pr-2 py-2 rounded-lg shadow-lg whitespace-normal z-50 flex items-start gap-1">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span className="flex-1">{error}</span>
          <button
            onClick={handleRetry}
            className="opacity-80 hover:opacity-100 transition-opacity ml-1 p-0.5"
            aria-label="Retry connection"
          >
            <RefreshCw className="w-3 h-3" />
          </button>
          <button
            onClick={() => setDismissedError(error)}
            className="opacity-80 hover:opacity-100 transition-opacity ml-1 p-0.5"
            aria-label="Dismiss error"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      )}

      {/* Idle / Error state */}
      {(status === "idle" || status === "error") && (
        <Button
          variant="default"
          size="sm"
          className="ml-auto font-bold border-purple-900 text-white hover:text-purple-300 hover:border-purple-800 min-w-[120px] gap-2"
          onClick={() => setShowModal(true)}
        >
          <Wallet className="w-4 h-4" />
          Connect Wallet
        </Button>
      )}

      {/* Connecting state */}
      {status === "connecting" && (
        <Button
          disabled
          variant="default"
          size="sm"
          className="ml-auto font-bold border-purple-900 text-white min-w-[120px] cursor-not-allowed opacity-70"
        >
          <Loader2 className="mr-2 h-4 w-4 animate-spin shrink-0" />
          Opening Wallet...
        </Button>
      )}

      {/* Reconnecting state */}
      {status === "reconnecting" && (
        <div className="ml-auto flex items-center space-x-2 text-sm text-slate-300 min-w-[120px] justify-center">
          <Loader2 className="h-4 w-4 animate-spin shrink-0" />
          <span>Restoring Session...</span>
        </div>
      )}

      {/* Connected state */}
      {status === "connected" && address && (
        <Button
          ref={buttonRef}
          variant="default"
          size="sm"
          className="ml-auto font-bold border-purple-900 text-white hover:text-purple-300 hover:border-purple-800 gap-2"
          onClick={() => setShowDisconnectModal((prev) => !prev)}
        >
          <div className="w-2 h-2 rounded-full bg-emerald-400" />
          {shortenAddress(address)}
        </Button>
      )}

      {/* Disconnect dropdown */}
      {showDisconnectModal && status === "connected" && (
        <div className="absolute mt-10 w-48 bg-slate-900 rounded-lg shadow-xl z-50 border border-white/10 overflow-hidden">
          <button
            onClick={handleDisconnect}
            className="w-full px-4 py-3 text-sm text-red-400 hover:bg-red-500/10 transition-colors text-left"
          >
            Disconnect Wallet
          </button>
        </div>
      )}

      {/* Wallet Modal */}
      <WalletModal isOpen={showModal} onClose={() => setShowModal(false)} />
    </div>
  );
};
