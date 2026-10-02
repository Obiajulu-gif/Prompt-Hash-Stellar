/**
 * useAssetAccess — React hook for client-side token-gating checks.
 *
 * Calls GET /api/auth/asset-check with the authenticated session to verify
 * whether the wallet holds a required Stellar asset. Integrates with the
 * AuthProvider session to automatically include the JWT.
 *
 * Usage:
 *   const { hasAccess, balance, loading, error } = useAssetAccess({
 *     assetType: "credit_alphanum4",
 *     code: "USDC",
 *     issuer: "G...",
 *     minimumBalance: 1,
 *   });
 */

import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../providers/AuthProvider";
import type { AssetRequirement, AssetAccessResult } from "../lib/auth/stellarAuth";

interface UseAssetAccessState {
  hasAccess: boolean | null;
  balance: string | null;
  loading: boolean;
  error: string | null;
  /** Manually re-trigger the check (e.g. after a purchase). */
  refetch: () => void;
}

/**
 * Fetches asset access status from the backend endpoint.
 * The server reads the JWT cookie, extracts the address, and calls Horizon.
 */
async function fetchAssetAccess(
  requirement: AssetRequirement,
  token?: string,
): Promise<AssetAccessResult> {
  const params = new URLSearchParams({
    assetType: requirement.assetType,
    ...(requirement.code ? { code: requirement.code } : {}),
    ...(requirement.issuer ? { issuer: requirement.issuer } : {}),
    ...(requirement.minimumBalance != null
      ? { minimumBalance: String(requirement.minimumBalance) }
      : {}),
  });

  const headers: HeadersInit = { "Content-Type": "application/json" };
  // Include JWT in header for programmatic clients that cannot use cookies
  if (token && token !== "cookie") {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const res = await fetch(`/api/auth/asset-check?${params}`, {
    method: "GET",
    credentials: "include",
    headers,
  });

  if (!res.ok) {
    if (res.status === 401) {
      return { hasAccess: false, balance: null, reason: "Not authenticated." };
    }
    const body = await res.json().catch(() => null);
    const reason =
      body && "error" in body ? String(body.error) : `Request failed (${res.status})`;
    return { hasAccess: false, balance: null, reason };
  }

  return res.json();
}

export function useAssetAccess(
  requirement: AssetRequirement | null,
): UseAssetAccessState {
  const { session, isAuthenticated } = useAuth();

  const [state, setState] = useState<Omit<UseAssetAccessState, "refetch">>({
    hasAccess: null,
    balance: null,
    loading: false,
    error: null,
  });

  const [refreshKey, setRefreshKey] = useState(0);

  const check = useCallback(async () => {
    if (!requirement || !isAuthenticated) {
      setState({ hasAccess: null, balance: null, loading: false, error: null });
      return;
    }

    setState((prev) => ({ ...prev, loading: true, error: null }));

    try {
      const result = await fetchAssetAccess(requirement, session?.token);
      setState({
        hasAccess: result.hasAccess,
        balance: result.balance,
        loading: false,
        error: result.reason ?? null,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "Asset access check failed.";
      setState({ hasAccess: false, balance: null, loading: false, error: message });
    }
  }, [requirement, isAuthenticated, session?.token]);

  useEffect(() => {
    void check();
  }, [check, refreshKey]);

  const refetch = useCallback(() => setRefreshKey((k) => k + 1), []);

  return { ...state, refetch };
}
