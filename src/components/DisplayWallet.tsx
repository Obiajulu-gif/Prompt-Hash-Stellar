import { Wallet, LogOut } from "lucide-react";
import { useWallet } from "@/hooks/useWallet";
import { useWalletBalance } from "@/hooks/useWalletBalance";
import { connectWallet, disconnectWallet } from "@/util/wallet";
import { shortenAddress } from "@/lib/utils";
import { Button } from "./ui/button";

const DisplayWallet = () => {
  const { address } = useWallet();
  const { xlm, isLoading } = useWalletBalance();

  if (!address) {
    return (
      <Button
        onClick={() => void connectWallet()}
        className="border border-amber-300/30 bg-amber-500 text-slate-950 hover:bg-amber-400"
      >
        <Wallet className="mr-2 h-4 w-4" />
        Connect wallet
      </Button>
    );
  }

  return (
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
        className="border border-white/10 text-slate-100 hover:bg-white/10"
        onClick={() => void disconnectWallet()}
        title="Disconnect wallet"
      >
        <LogOut className="h-4 w-4" />
      </Button>
    </div>
  );
};

export default DisplayWallet;
