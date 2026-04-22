import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import { wallet } from "../util/wallet";
import storage from "../util/storage";
import { stellarWalletNetwork } from "../lib/env";

export type WalletStatus = 
  | "idle" 
  | "selecting" 
  | "connecting" 
  | "connected" 
  | "reconnecting" 
  | "error";

export interface WalletContextType {
  address?: string;
  network?: string;
  networkPassphrase?: string;
  status: WalletStatus;
  error?: string;
  connect: (id: string) => Promise<void>;
  disconnect: () => void;
  signTransaction: typeof wallet.signTransaction;
  signMessage: typeof wallet.signMessage;
}

const initialState = {
  address: undefined,
  network: undefined,
  networkPassphrase: undefined,
  status: "idle" as WalletStatus,
  error: undefined,
};

export const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<Omit<WalletContextType, "connect" | "disconnect" | "signTransaction" | "signMessage">>(initialState);

  const disconnect = useCallback(() => {
    storage.removeItem("walletId");
    storage.removeItem("walletAddress");
    storage.removeItem("walletNetwork");
    storage.removeItem("networkPassphrase");
    wallet.disconnect().catch(console.error);
    setState(initialState);
  }, []);

  // Helper to safely get network info (handles Albedo's lack of getNetwork support)
  const getSafeNetworkInfo = useCallback(async (walletId: string) => {
    // Albedo and some other web wallets don't support getNetwork
    if (walletId === 'albedo') {
      return { network: stellarWalletNetwork, networkPassphrase: undefined };
    }
    try {
      return await wallet.getNetwork();
    } catch (e) {
      console.warn(`Wallet ${walletId} does not support getNetwork, using env default.`);
      return { network: stellarWalletNetwork, networkPassphrase: undefined };
    }
  }, []);

  const connect = useCallback(async (walletId: string) => {
    setState(prev => ({ ...prev, status: "connecting", error: undefined }));
    try {
      wallet.setWallet(walletId);
      
      const [a, n] = await Promise.all([
        wallet.getAddress(),
        getSafeNetworkInfo(walletId),
      ]);

      if (!a.address) throw new Error("No address returned from wallet");

      storage.setItem("walletId", walletId);
      storage.setItem("walletAddress", a.address);
      if (n.network) storage.setItem("walletNetwork", n.network);
      if (n.networkPassphrase) storage.setItem("networkPassphrase", n.networkPassphrase);

      setState({
        address: a.address,
        network: n.network,
        networkPassphrase: n.networkPassphrase,
        status: "connected",
        error: undefined,
      });
    } catch (e: any) {
      console.error("Connection error:", e);
      setState(prev => ({ 
        ...prev, 
        status: "error", 
        error: e.message || "Failed to connect wallet" 
      }));
    }
  }, [getSafeNetworkInfo]);

  const checkExtensionAccount = useCallback(async () => {
    if (state.status !== "connected" && state.status !== "reconnecting") return;
    const savedId = storage.getItem("walletId");
    if (!savedId) return;

    try {
      const { address } = await wallet.getAddress();
      if (address && address !== state.address) {
        storage.setItem("walletAddress", address);
        setState(prev => ({ ...prev, address }));
      }
    } catch (error) {
      console.error("Error checking extension account:", error);
    }
  }, [state.status, state.address]);

  useEffect(() => {
    const handleFocus = () => void checkExtensionAccount();
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, [checkExtensionAccount]);

  useEffect(() => {
    const rehydrate = async () => {
      const savedId = storage.getItem("walletId");
      const savedAddr = storage.getItem("walletAddress");

      if (!savedId || !savedAddr) {
        setState(prev => ({ ...prev, status: "idle" }));
        return;
      }

      setState(prev => ({ ...prev, status: "reconnecting" }));
      
      try {
        wallet.setWallet(savedId);
        const [a, n] = await Promise.all([
          wallet.getAddress(),
          getSafeNetworkInfo(savedId),
        ]);

        if (a.address) {
          if (a.address !== savedAddr) {
            storage.setItem("walletAddress", a.address);
          }
          setState({
            address: a.address,
            network: n.network,
            networkPassphrase: n.networkPassphrase,
            status: "connected",
            error: undefined,
          });
        } else {
          disconnect();
        }
      } catch (e) {
        console.warn("Session rehydration failed, clearing stale data.");
        disconnect();
      }
    };

    void rehydrate();
  }, [disconnect, getSafeNetworkInfo]);

  const contextValue = useMemo(
    () => ({
      ...state,
      connect,
      disconnect,
      signTransaction: wallet.signTransaction.bind(wallet),
      signMessage: wallet.signMessage.bind(wallet),
    }),
    [state, connect, disconnect]
  );

  return <WalletContext.Provider value={contextValue}>{children}</WalletContext.Provider>;
};