/**
 * WalletAuthButton — wallet connection + backend authentication in one widget.
 *
 * Lifecycle:
 *  1. Idle         → "Connect Wallet" button opens the StellarWalletsKit modal
 *  2. Connected    → "Sign In" button triggers the nonce→sign→verify flow
 *  3. Authenticating → spinner
 *  4. Authenticated  → address pill + "Sign Out" button
 *  5. Error        → error message + retry button
 *
 * Props:
 *   className       Optional Tailwind class overrides
 *   onAuthenticated Callback fired once the JWT session is established
 */

import { useState, useCallback } from "react";
import { useWallet } from "../../hooks/useWallet";
import { useWalletAuth } from "../../hooks/useAuth";
import { Button } from "../ui/button";
import { classifyWalletError } from "../../lib/wallet/walletErrors";

interface WalletAuthButtonProps {
  className?: string;
  // eslint-disable-next-line no-unused-vars
  onAuthenticated?: (address: string) => void;
}

/**
 * Truncate a G… Stellar address for display.
 *  e.g. "GABC…XYZ"
 */
function truncateAddress(address: string): string {
  if (address.length <= 12) return address;
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function WalletAuthButton({ className, onAuthenticated }: WalletAuthButtonProps) {
  const wallet = useWallet();
  const { authStatus, isAuthenticated, authenticate, logout, authError } = useWalletAuth();

  const [connectError, setConnectError] = useState<string | null>(null);

  // ── Connect wallet ────────────────────────────────────────────────────────

  const handleConnect = useCallback(async () => {
    setConnectError(null);
    try {
      // Open the StellarWalletsKit selection modal (Freighter, Albedo, xBull…)
      await new Promise<void>((resolve, reject) => {
        // The kit modal fires onComplete when the user selects a wallet
        const modal = (wallet as any).openModal?.({
          onWalletSelected: async (option: { id: string }) => {
            try {
              await wallet.connect(option.id);
              resolve();
            } catch (err) {
              reject(err as Error);
            }
          },
          onClosed: () => resolve(),
        });
        // Fallback for wallets that don't support modal
        if (!modal) {
          wallet.connect("freighter").then(resolve).catch(reject);
        }
      });
    } catch (err) {
      const classified = classifyWalletError(err);
      setConnectError(
        classified.recoveryAction
          ? `${classified.message} ${classified.recoveryAction}`
          : classified.message,
      );
    }
  }, [wallet]);

  // ── Authenticate (sign nonce) ─────────────────────────────────────────────

  const handleAuthenticate = useCallback(async () => {
    try {
      await authenticate();
      if (wallet.address) onAuthenticated?.(wallet.address);
    } catch {
      // Error is stored in auth.error by AuthProvider; no extra handling needed
    }
  }, [authenticate, wallet.address, onAuthenticated]);

  // ── Logout ────────────────────────────────────────────────────────────────

  const handleLogout = useCallback(async () => {
    await logout();
    await wallet.disconnect();
  }, [logout, wallet]);

  // ── Render ────────────────────────────────────────────────────────────────

  // Authenticated session pill
  if (isAuthenticated && wallet.address) {
    return (
      <div className={`flex items-center gap-2 ${className ?? ""}`}>
        <span className="text-sm font-mono bg-muted px-3 py-1 rounded-full text-foreground">
          {truncateAddress(wallet.address)}
        </span>
        <Button variant="outline" size="sm" onClick={handleLogout}>
          Sign Out
        </Button>
      </div>
    );
  }

  // Wallet connected but not yet authenticated
  if (wallet.status === "connected" && wallet.address) {
    return (
      <div className={`flex flex-col gap-1 ${className ?? ""}`}>
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground font-mono">
            {truncateAddress(wallet.address)}
          </span>
          <Button
            size="sm"
            onClick={handleAuthenticate}
            disabled={authStatus === "authenticating"}
          >
            {authStatus === "authenticating" ? (
              <span className="flex items-center gap-2">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent" />
                Signing…
              </span>
            ) : (
              "Sign In"
            )}
          </Button>
        </div>
        {authError && (
          <p className="text-xs text-destructive mt-1">{authError}</p>
        )}
      </div>
    );
  }

  // Connecting or reconnecting
  if (wallet.status === "connecting" || wallet.status === "reconnecting") {
    return (
      <Button className={className} disabled size="sm">
        <span className="h-3 w-3 animate-spin rounded-full border-2 border-current border-t-transparent mr-2" />
        Connecting…
      </Button>
    );
  }

  // Idle / error — show connect button
  const displayError = connectError ?? wallet.error;

  return (
    <div className={`flex flex-col gap-1 ${className ?? ""}`}>
      <Button
        onClick={handleConnect}
        disabled={wallet.status === "connecting"}
        size="sm"
      >
        Connect Wallet
      </Button>
      {displayError && (
        <p className="text-xs text-destructive mt-1">{displayError}</p>
      )}
    </div>
  );
}
