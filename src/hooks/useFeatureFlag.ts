import { useState, useEffect } from "react";
import {
  evaluateClientFeatureFlag,
  getClientSafeFallback,
  type KnownClientFeatureFlag,
} from "../lib/featureFlags";

export interface UseFeatureFlagResult {
  enabled: boolean;
  loading: boolean;
  reason: string;
  source: string;
}

export function useFeatureFlag(
  flagName: string | KnownClientFeatureFlag,
  userId?: string
): UseFeatureFlagResult {
  const [result, setResult] = useState<UseFeatureFlagResult>(() => ({
    enabled: getClientSafeFallback(flagName),
    loading: true,
    reason: "Initial safe fallback state",
    source: "safe_fallback",
  }));

  useEffect(() => {
    let mounted = true;

    evaluateClientFeatureFlag(flagName, userId).then((evaluation) => {
      if (mounted) {
        setResult({
          enabled: evaluation.enabled,
          loading: false,
          reason: evaluation.reason,
          source: evaluation.source,
        });
      }
    });

    return () => {
      mounted = false;
    };
  }, [flagName, userId]);

  return result;
}
