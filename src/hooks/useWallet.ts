import { use } from "react";
import { WalletContext } from "../providers/WalletProvider";
import { networkPassphrase } from "../lib/env";

export const useWallet = () => {
  const ctx = use(WalletContext);
  if (!ctx) {
    throw new Error("useWallet must be used within a WalletProvider");
  }

  const isWrongNetwork = ctx.address && ctx.networkPassphrase && ctx.networkPassphrase !== networkPassphrase;

  return {
    ...ctx,
    isWrongNetwork,
  };
};
