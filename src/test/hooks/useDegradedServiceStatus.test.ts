import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useDegradedServiceStatus } from "../../hooks/useDegradedServiceStatus";
import { fallbackManager } from "../../lib/observability/degradedServiceFallback";

describe("useDegradedServiceStatus (#1144)", () => {
  beforeEach(() => {
    fallbackManager.reset();
    vi.restoreAllMocks();
  });

  it("normal path: initializes with all healthy services and isAnyDegraded false", () => {
    const { result } = renderHook(() => useDegradedServiceStatus());
    expect(result.current.isAnyDegraded).toBe(false);
    expect(result.current.isAnyUnavailable).toBe(false);
    expect(result.current.degradedServices).toEqual([]);
    expect(result.current.allServices.length).toBe(3);
  });

  it("failure path: updates immediately when a dependency degrades", () => {
    const { result } = renderHook(() => useDegradedServiceStatus());

    act(() => {
      fallbackManager.setServiceStatus(
        "stellar_rpc",
        "degraded",
        "High RPC latency",
      );
    });

    expect(result.current.isAnyDegraded).toBe(true);
    expect(result.current.isAnyUnavailable).toBe(false);
    expect(result.current.degradedServices.length).toBe(1);
    expect(result.current.degradedServices[0].service).toBe("stellar_rpc");
    expect(result.current.degradedServices[0].status).toBe("degraded");
  });

  it("failure path: marks isAnyUnavailable true when a service is unavailable", () => {
    const { result } = renderHook(() => useDegradedServiceStatus());

    act(() => {
      fallbackManager.setServiceStatus(
        "ipfs",
        "unavailable",
        "Gateway timeout",
      );
    });

    expect(result.current.isAnyDegraded).toBe(true);
    expect(result.current.isAnyUnavailable).toBe(true);
    expect(result.current.degradedServices[0].service).toBe("ipfs");
  });

  it("authorization / policy evaluation: evaluates actions correctly through hook", () => {
    const { result } = renderHook(() => useDegradedServiceStatus());

    act(() => {
      fallbackManager.setServiceStatus("stellar_rpc", "unavailable");
    });

    // Critical financial action blocked fail closed
    const buyPolicy = result.current.evaluateAction("stellar_rpc", "buy_prompt");
    expect(buyPolicy.allowed).toBe(false);
    expect(buyPolicy.fallbackActive).toBe(true);

    // Non-critical action allowed with fallback
    const viewPolicy = result.current.evaluateAction(
      "stellar_rpc",
      "view_prompt",
    );
    expect(viewPolicy.allowed).toBe(true);
    expect(viewPolicy.fallbackActive).toBe(true);
  });

  it("retry path: restores healthy status on successful probe refresh", async () => {
    fallbackManager.setServiceStatus("stellar_rpc", "degraded");
    const { result } = renderHook(() => useDegradedServiceStatus());
    expect(result.current.isAnyDegraded).toBe(true);

    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        status: "up",
        services: [
          { name: "Stellar RPC", status: "up" },
          { name: "IPFS Gateway", status: "up" },
          { name: "Safety Scanner", status: "up" },
        ],
      }),
    } as Response);

    await act(async () => {
      await result.current.retryServiceProbes();
    });

    expect(result.current.isAnyDegraded).toBe(false);
    expect(result.current.degradedServices).toEqual([]);
  });
});
