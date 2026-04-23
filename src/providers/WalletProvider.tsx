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
import { ALBEDO_ID } from "@creit.tech/stellar-wallets-kit";
import { useAsyncTransaction } from "../components/useAsyncTransaction";

export type WalletStatus = 
  | "idle" 
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
  disconnect: () => Promise<void>;
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

const boundSignTransaction = wallet.signTransaction.bind(wallet);
const boundSignMessage = wallet.signMessage.bind(wallet);

export const WalletContext = createContext<WalletContextType | undefined>(undefined);

export const WalletProvider = ({ children }: { children: React.ReactNode }) => {
  const [state, setState] = useState<Omit<WalletContextType, "connect" | "disconnect" | "signTransaction" | "signMessage">>(initialState);

  const { execute: executeDisconnect } = useAsyncTransaction(
    async () => {
      await wallet.disconnect();
    },
    {
      pendingMessage: "Disconnecting wallet...",
      successMessage: "Wallet disconnected",
      onSuccess: () => {
        storage.removeItem("walletId");
        storage.removeItem("walletAddress");
        storage.removeItem("walletNetwork");
        storage.removeItem("networkPassphrase");
        setState(initialState);
      }
    }
  );

  const disconnect = useCallback(async () => {
    await executeDisconnect().catch(console.error);
  }, [executeDisconnect]);

  // Helper to safely get network info (handles Albedo's lack of getNetwork support)
  const getSafeNetworkInfo = useCallback(async (walletId: string) => {
    // Albedo and some other web wallets don't support getNetwork
    if (walletId === ALBEDO_ID) {
      return { network: stellarWalletNetwork, networkPassphrase: undefined };
    }
    try {
      return await wallet.getNetwork();
    } catch (e) {
      console.warn(`Wallet ${walletId} does not support getNetwork, using env default.`);
      return { network: stellarWalletNetwork, networkPassphrase: undefined };
    }
  }, []);

  const { execute: executeConnect } = useAsyncTransaction(
    async (walletId: string) => {
      wallet.setWallet(walletId);
      
      const [a, n] = await Promise.all([
        wallet.getAddress(),
        getSafeNetworkInfo(walletId),
      ]);

      if (!a.address) throw new Error("No address returned from wallet");
      return { address: a.address, network: n.network, networkPassphrase: n.networkPassphrase, walletId };
    },
    {
      pendingMessage: (walletId) => `Connecting to ${walletId}...`,
      successMessage: "Wallet connected successfully",
      onOptimistic: () => {
        setState(prev => ({ ...prev, status: "connecting", error: undefined }));
      },
      onSuccess: (data) => {
        storage.setItem("walletId", data.walletId);
        storage.setItem("walletAddress", data.address);
        if (data.network) storage.setItem("walletNetwork", data.network);
        else storage.removeItem("walletNetwork");
        
        if (data.networkPassphrase) storage.setItem("networkPassphrase", data.networkPassphrase);
        else storage.removeItem("networkPassphrase");

        setState({
          address: data.address,
          network: data.network,
          networkPassphrase: data.networkPassphrase,
          status: "connected",
          error: undefined,
        });
      },
      onError: (e) => {
        console.error("Connection error:", e);
        const message = e instanceof Error ? e.message : "Failed to connect wallet";
        setState(prev => ({ 
          ...prev, 
          status: "error", 
          error: message 
        }));
      }
    }
  );

  const connect = useCallback(async (walletId: string) => {
    await executeConnect(walletId).catch(() => {});
  }, [executeConnect]);

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
    let aborted = false;

    const rehydrate = async () => {
      const savedId = storage.getItem("walletId");
      const savedAddr = storage.getItem("walletAddress");

      if (aborted) return;

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

        if (aborted) return;
        if (state.status !== "reconnecting" && state.status !== "idle") return;

        if (a.address) {
          if (a.address !== savedAddr) {
            storage.setItem("walletAddress", a.address);
          }
          if (aborted) return;
          setState({
            address: a.address,
            network: n.network,
            networkPassphrase: n.networkPassphrase,
            status: "connected",
            error: undefined,
          });
        } else {
          if (aborted) return;
          disconnect();
        }
      } catch (e) {
        if (aborted) return;
        console.warn("Session rehydration failed, clearing stale data.");
        disconnect();
      }
    };

    void rehydrate();

    return () => {
      aborted = true;
    };
  }, [disconnect, getSafeNetworkInfo]);

  const contextValue = useMemo(
    () => ({
      ...state,
      connect,
      disconnect,
      signTransaction: boundSignTransaction,
      signMessage: boundSignMessage,
    }),
    [state, connect, disconnect]
  );

  return <WalletContext.Provider value={contextValue}>{children}</WalletContext.Provider>;
};