import { useEffect, useState } from "react";
import {
  fallbackManager,
  type ServiceState,
  type ThirdPartyService,
  type ActionPolicy,
} from "../lib/observability/degradedServiceFallback";

export interface DegradedStatusHookResult {
  degradedServices: ServiceState[];
  allServices: ServiceState[];
  isAnyDegraded: boolean;
  isAnyUnavailable: boolean;
  evaluateAction: (service: ThirdPartyService, action: string) => ActionPolicy;
  retryServiceProbes: () => Promise<void>;
  refresh: () => void;
}

export function useDegradedServiceStatus(): DegradedStatusHookResult {
  const [states, setStates] = useState<ServiceState[]>(() =>
    fallbackManager.getAllStates(),
  );

  useEffect(() => {
    setStates(fallbackManager.getAllStates());
    const unsubscribe = fallbackManager.subscribe(() => {
      setStates(fallbackManager.getAllStates());
    });
    return unsubscribe;
  }, []);

  const degradedServices = states.filter(
    (s) => s.status === "degraded" || s.status === "unavailable",
  );
  const isAnyUnavailable = states.some((s) => s.status === "unavailable");
  const isAnyDegraded = degradedServices.length > 0;

  const retryServiceProbes = async (): Promise<void> => {
    try {
      const res = await fetch("/api/status");
      if (res.ok) {
        const json = (await res.json()) as {
          status?: string;
          services?: Array<{ name: string; status: string }>;
        };
        if (json.services) {
          for (const s of json.services) {
            const lower = s.name.toLowerCase();
            const mappedService: ThirdPartyService | null = lower.includes("rpc")
              ? "stellar_rpc"
              : lower.includes("ipfs")
                ? "ipfs"
                : lower.includes("scanner")
                  ? "safety_scanner"
                  : null;

            if (mappedService) {
              const mappedStatus =
                s.status === "up" || s.status === "healthy"
                  ? "healthy"
                  : s.status === "degraded"
                    ? "degraded"
                    : "unavailable";
              fallbackManager.setServiceStatus(mappedService, mappedStatus);
            }
          }
        }
      }
    } catch {
      // Fail closed: maintain existing fallback state
    }
  };

  return {
    degradedServices,
    allServices: states,
    isAnyDegraded,
    isAnyUnavailable,
    evaluateAction: (service, action) =>
      fallbackManager.evaluateAction(service, action),
    retryServiceProbes,
    refresh: () => setStates(fallbackManager.getAllStates()),
  };
}
