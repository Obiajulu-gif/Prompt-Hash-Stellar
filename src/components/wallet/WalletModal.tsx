import { useState } from "react";
import { Loader2, X, ExternalLink, CheckCircle2 } from "lucide-react";
import { Button } from "./ui/button";
import { useWallet } from "@/hooks/useWallet";

interface WalletOption {
  id: string;
  name: string;
  icon: string;
  description: string;
  installUrl?: string;
}

const WALLET_OPTIONS: WalletOption[] = [
  {
    id: "freighter",
    name: "Freighter",
    icon: "🦊",
    description: "Browser extension by Stellar Development Foundation",
    installUrl: "https://freighter.app",
  },
  {
    id: "xbull",
    name: "xBull",
    icon: "🐂",
    description: "Mobile and browser wallet for Stellar",
    installUrl: "https://xbull.app",
  },
  {
    id: "albedo",
    name: "Albedo",
    icon: "🌌",
    description: "Web-based Stellar wallet with built-in DEX",
    installUrl: "https://albedo.link",
  },
  {
    id: "lobstr",
    name: "Lobstr",
    icon: "🦞",
    description: "Popular mobile and web wallet for Stellar",
    installUrl: "https://lobstr.co",
  },
  {
    id: "rabet",
    name: "Rabet",
    icon: "🐰",
    description: "Browser extension wallet for Stellar",
    installUrl: "https://rabet.io",
  },
];

interface WalletModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function WalletModal({ isOpen, onClose }: WalletModalProps) {
  const { connect, status, error } = useWallet();
  const [connectingId, setConnectingId] = useState<string | null>(null);
  const [connectionError, setConnectionError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleConnect = async (walletId: string) => {
    setConnectingId(walletId);
    setConnectionError(null);

    try {
      await connect(walletId);
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : "Connection failed";
      setConnectionError(message);
    } finally {
      setConnectingId(null);
    }
  };

  return (
    <div className="fixed inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center z-50">
      <div className="bg-slate-900 border border-white/10 rounded-2xl p-6 shadow-2xl max-w-md w-full mx-4 relative">
        {/* Header */}
        <div className="flex items-center justify-between mb-6">
          <div>
            <h2 className="text-xl font-bold text-white">Connect Wallet</h2>
            <p className="text-sm text-slate-400 mt-1">
              Choose a Stellar wallet to continue
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-white transition-colors p-1 rounded-lg hover:bg-white/10"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Error message */}
        {(connectionError || (status === "error" && error)) && (
          <div className="mb-4 p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
            {connectionError || error}
          </div>
        )}

        {/* Wallet options */}
        <div className="space-y-2">
          {WALLET_OPTIONS.map((wallet) => {
            const isConnecting = connectingId === wallet.id;

            return (
              <button
                key={wallet.id}
                onClick={() => void handleConnect(wallet.id)}
                disabled={connectingId !== null}
                className="w-full flex items-center gap-4 p-4 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 hover:border-white/20 transition-all disabled:opacity-50 disabled:cursor-not-allowed group"
              >
                <span className="text-2xl">{wallet.icon}</span>
                <div className="flex-1 text-left">
                  <div className="font-medium text-white group-hover:text-amber-300 transition-colors">
                    {wallet.name}
                  </div>
                  <div className="text-xs text-slate-400">
                    {wallet.description}
                  </div>
                </div>
                {isConnecting ? (
                  <Loader2 className="w-5 h-5 animate-spin text-amber-400" />
                ) : (
                  <ExternalLink className="w-4 h-4 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
                )}
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="mt-6 pt-4 border-t border-white/10">
          <p className="text-xs text-slate-500 text-center">
            New to Stellar?{" "}
            <a
              href="https://stellar.org/learn/keys"
              target="_blank"
              rel="noopener noreferrer"
              className="text-amber-400 hover:text-amber-300 transition-colors"
            >
              Learn about wallets
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}
