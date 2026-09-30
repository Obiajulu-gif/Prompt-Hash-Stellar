/**
 * Client-Side Feature Flag Service & Safe Fallbacks (Issue #813)
 *
 * Provides typed feature flag queries with client-side safe defaults,
 * environment resolution, and backend verification.
 */

export type KnownClientFeatureFlag =
  | "stellar_atomic_settlement"
  | "bulk_purchase_atomic_v2"
  | "prompt_preview_markdown_sanitize_v2"
  | "payout_reconciliation_auto_resolve"
  | "operational_health_dashboard"
  | "strict_settlement_checks";

export interface ClientFeatureFlagEvaluation {
  name: string;
  enabled: boolean;
  reason: string;
  source: "client_cache" | "server" | "safe_fallback";
}

export const CLIENT_SAFE_FALLBACKS: Record<KnownClientFeatureFlag | string, boolean> = {
  stellar_atomic_settlement: false,
  bulk_purchase_atomic_v2: false,
  prompt_preview_markdown_sanitize_v2: true,
  payout_reconciliation_auto_resolve: false,
  operational_health_dashboard: true,
  strict_settlement_checks: true,
};

const flagCache = new Map<string, { enabled: boolean; timestamp: number }>();
const CACHE_TTL_MS = 60 * 1000; // 1 minute client cache

export function getClientSafeFallback(flagName: string): boolean {
  const normalized = flagName.toLowerCase();
  if (normalized in CLIENT_SAFE_FALLBACKS) {
    return CLIENT_SAFE_FALLBACKS[normalized];
  }
  return false;
}

export async function evaluateClientFeatureFlag(
  flagName: string | KnownClientFeatureFlag,
  userId?: string
): Promise<ClientFeatureFlagEvaluation> {
  const normalized = flagName.toLowerCase();
  const cacheKey = `${normalized}:${userId || "anonymous"}`;
  const cached = flagCache.get(cacheKey);

  if (cached && Date.now() - cached.timestamp < CACHE_TTL_MS) {
    return {
      name: normalized,
      enabled: cached.enabled,
      reason: "Resolved from client-side memory cache",
      source: "client_cache",
    };
  }

  try {
    const apiBase =
      typeof window !== "undefined" && window.location.origin.includes("localhost")
        ? "http://localhost:5000"
        : "";

    const response = await fetch(`${apiBase}/api/flags/check/${encodeURIComponent(normalized)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ userId }),
    });

    if (response.ok) {
      const data = await response.json();
      const isEnabled = Boolean(data.enabled);
      flagCache.set(cacheKey, { enabled: isEnabled, timestamp: Date.now() });
      return {
        name: normalized,
        enabled: isEnabled,
        reason: data.reason || "Evaluated by server",
        source: "server",
      };
    }
  } catch (_err) {
    // Network or server error - silently use safe default
  }

  const fallback = getClientSafeFallback(normalized);
  return {
    name: normalized,
    enabled: fallback,
    reason: "Server check unreachable; fell back to client safe default",
    source: "safe_fallback",
  };
}
