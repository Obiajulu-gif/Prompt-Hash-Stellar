import { AlertTriangle, Wifi, WifiOff } from "lucide-react";
import { detectNetworkMismatch, type NetworkMismatchState } from "@/lib/wallet/networkDetection";
import { useWallet } from "@/hooks/useWallet";

interface NetworkMismatchBannerProps {
  className?: string;
}

export const NetworkMismatchBanner: React.FC<NetworkMismatchBannerProps> = ({ className = "" }) => {
  const wallet = useWallet();
  
  const mismatchState: NetworkMismatchState = detectNetworkMismatch(
    !!wallet.address,
    wallet.network,
    wallet.status
  );

  // Don't show banner if network is correct or unavailable (connecting state)
  if (mismatchState.type === "correct" || mismatchState.type === "unavailable") {
    return null;
  }

  const getIcon = () => {
    switch (mismatchState.type) {
      case "wrong-network":
        return <AlertTriangle className="h-5 w-5 text-amber-400" />;
      case "disconnected":
        return <WifiOff className="h-5 w-5 text-slate-400" />;
      default:
        return <Wifi className="h-5 w-5 text-blue-400" />;
    }
  };

  const getBannerStyle = () => {
    switch (mismatchState.type) {
      case "wrong-network":
        return "bg-amber-500/10 border-amber-500/20 text-amber-200";
      case "disconnected":
        return "bg-slate-500/10 border-slate-500/20 text-slate-300";
      default:
        return "bg-blue-500/10 border-blue-500/20 text-blue-200";
    }
  };

  return (
    <div className={`rounded-xl border p-4 flex gap-3 items-start ${getBannerStyle()} ${className}`}>
      <div className="shrink-0 mt-0.5">
        {getIcon()}
      </div>
      <div className="flex-1 space-y-1">
        <p className="text-sm font-semibold">{mismatchState.message}</p>
        {mismatchState.recoveryInstructions && (
          <p className="text-xs opacity-90">{mismatchState.recoveryInstructions}</p>
        )}
      </div>
    </div>
  );
};
