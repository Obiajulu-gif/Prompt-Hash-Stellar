/**
 * useAuth — combined wallet connection + backend session hook.
 *
 * Wraps both useWallet (raw Freighter connection) and useAuth from
 * AuthProvider into a single ergonomic API surface.
 *
 * Usage:
 *   const { address, isAuthenticated, authenticate, logout, status } = useWalletAuth();
 *
 * The hook exposes:
 *   address          — connected wallet's Stellar public key (from WalletProvider)
 *   walletStatus     — WalletProvider status (idle|connecting|connected|error)
 *   authStatus       — AuthProvider status (idle|authenticating|authenticated|error)
 *   isAuthenticated  — true when a valid JWT session exists
 *   authenticate()   — triggers nonce→sign→verify against the connected wallet
 *   logout()         — clears the JWT cookie and resets session state
 *   error            — last auth error message (null when clean)
 */

import { useCallback } from "react";
import { useWallet } from "./useWallet";
import { useAuth } from "../providers/AuthProvider";

export function useWalletAuth() {
  const wallet = useWallet();
  const auth = useAuth();

  /**
   * One-call authenticate: uses the currently connected wallet address and
   * signMessage function. Throws if no wallet is connected.
   */
  const authenticate = useCallback(async () => {
    if (!wallet.address) {
      throw new Error("Connect your Stellar wallet before authenticating.");
    }
    await auth.authenticate(wallet.address, wallet.signMessage);
  }, [wallet.address, wallet.signMessage, auth]);

  const logout = useCallback(async () => {
    await auth.logout();
  }, [auth]);

  return {
    // Wallet state
    address: wallet.address,
    walletStatus: wallet.status,
    walletError: wallet.error,

    // Auth session state
    authStatus: auth.status,
    session: auth.session,
    authError: auth.error,

    // Combined derived state
    isAuthenticated: auth.isAuthenticated,

    // Actions
    authenticate,
    logout,
  };
}
