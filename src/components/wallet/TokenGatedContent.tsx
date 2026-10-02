/**
 * TokenGatedContent — renders children only when the user holds a required
 * Stellar asset. Falls back to a customisable gate UI otherwise.
 *
 * Usage:
 *   <TokenGatedContent
 *     requirement={{ assetType: "native", minimumBalance: 5 }}
 *     fallback={<p>You need at least 5 XLM to access this.</p>}
 *   >
 *     <SecretContent />
 *   </TokenGatedContent>
 *
 * When not authenticated the component renders the gatePrompt (default: a
 * "Sign In" button). When the check is loading it renders a spinner. When
 * access is denied it renders the `fallback` prop.
 */

import type { ReactNode } from "react";
import { useAuth } from "../../providers/AuthProvider";
import { useAssetAccess } from "../../hooks/useAssetAccess";
import { WalletAuthButton } from "./WalletAuthButton";
import type { AssetRequirement } from "../../lib/auth/stellarAuth";

interface TokenGatedContentProps {
  /** Asset ownership requirement checked via Horizon. */
  requirement: AssetRequirement;
  /** Content shown when access is denied (no asset / below balance). */
  fallback?: ReactNode;
  /** Content shown when not authenticated (default: WalletAuthButton). */
  gatePrompt?: ReactNode;
  children: ReactNode;
}

export function TokenGatedContent({
  requirement,
  fallback,
  gatePrompt,
  children,
}: TokenGatedContentProps) {
  const { isAuthenticated, status: authStatus } = useAuth();
  const { hasAccess, loading, error, balance } = useAssetAccess(
    isAuthenticated ? requirement : null,
  );

  // Not authenticated — show login gate
  if (!isAuthenticated) {
    if (authStatus === "idle" || authStatus === "unauthenticated") {
      return (
        <div className="flex flex-col items-center gap-3 py-6">
          {gatePrompt ?? (
            <>
              <p className="text-sm text-muted-foreground">
                Connect and sign in with your Stellar wallet to access this content.
              </p>
              <WalletAuthButton />
            </>
          )}
        </div>
      );
    }
    // authenticating
    return (
      <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Authenticating…
      </div>
    );
  }

  // Authenticated but asset check in progress
  if (loading || hasAccess === null) {
    return (
      <div className="flex items-center gap-2 py-6 text-muted-foreground text-sm">
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
        Verifying asset access…
      </div>
    );
  }

  // Access denied
  if (!hasAccess) {
    return (
      <>
        {fallback ?? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm text-destructive">
            <p className="font-medium">Access denied</p>
            <p className="mt-1 text-muted-foreground">
              {error ??
                (requirement.assetType === "native"
                  ? `You need more than ${requirement.minimumBalance ?? 0} XLM to access this content.`
                  : `You need to hold ${requirement.code} to access this content.`)}
            </p>
            {balance !== null && (
              <p className="mt-1 text-xs">
                Your current balance:{" "}
                <span className="font-mono">{balance}</span>{" "}
                {requirement.assetType === "native" ? "XLM" : requirement.code}
              </p>
            )}
          </div>
        )}
      </>
    );
  }

  // Access granted — render children
  return <>{children}</>;
}
