import { describe, it, expect, beforeEach, vi } from "vitest";
import { fallbackManager } from "../../lib/observability/degradedServiceFallback";
import { metrics } from "../../lib/observability/metrics";

describe("Degraded Service Fallback Manager (#926)", () => {
  beforeEach(() => {
    fallbackManager.reset();
    vi.restoreAllMocks();
  });

  it("handles healthy state by default without blocking actions", () => {
    const state = fallbackManager.getServiceState("stellar_rpc");
    expect(state.status).toBe("healthy");

    const policy = fallbackManager.evaluateAction("stellar_rpc", "buy_prompt");
    expect(policy.allowed).toBe(true);
    expect(policy.fallbackActive).toBe(false);
  });

  it("triggers fallback messaging and emits metrics when service is degraded", () => {
    const emitSpy = vi.spyOn(metrics, "emit");

    fallbackManager.setServiceStatus("ipfs", "degraded", "High latency on primary gateway");

    expect(emitSpy).toHaveBeenCalledWith("fallback_activated", 1, {
      service: "ipfs",
      status: "degraded",
      previousStatus: "healthy",
    });

    const policy = fallbackManager.evaluateAction("ipfs", "upload_content");
    expect(policy.allowed).toBe(true);
    expect(policy.fallbackActive).toBe(true);
    expect(policy.message).toContain("IPFS gateway latency is elevated");
  });

  it("blocks critical unsafe actions when dependency is unavailable", () => {
    const emitSpy = vi.spyOn(metrics, "emit");

    fallbackManager.setServiceStatus("stellar_rpc", "unavailable", "RPC connection timeout");

    expect(emitSpy).toHaveBeenCalledWith("fallback_activated", 1, {
      service: "stellar_rpc",
      status: "unavailable",
      previousStatus: "healthy",
    });

    const buyPolicy = fallbackManager.evaluateAction("stellar_rpc", "buy_prompt");
    expect(buyPolicy.allowed).toBe(false);
    expect(buyPolicy.fallbackActive).toBe(true);
    expect(buyPolicy.message).toContain("currently unreachable");
    expect(emitSpy).toHaveBeenCalledWith("critical_action_blocked", 1, {
      service: "stellar_rpc",
      action: "buy_prompt",
    });
  });

  it("allows non-critical read actions during service unavailability with fallback message", () => {
    fallbackManager.setServiceStatus("safety_scanner", "unavailable", "Scanner service down");

    const readPolicy = fallbackManager.evaluateAction("safety_scanner", "view_prompt_details");
    expect(readPolicy.allowed).toBe(true);
    expect(readPolicy.fallbackActive).toBe(true);
    expect(readPolicy.message).toContain("Automated safety scanner is offline");
  });

  it("emits recovery observability metrics when service transitions back to healthy", () => {
    const emitSpy = vi.spyOn(metrics, "emit");

    fallbackManager.setServiceStatus("ipfs", "degraded");
    fallbackManager.setServiceStatus("ipfs", "healthy");

    expect(emitSpy).toHaveBeenCalledWith("service_recovered", 1, {
      service: "ipfs",
      previousStatus: "degraded",
    });

    const policy = fallbackManager.evaluateAction("ipfs", "publish_prompt");
    expect(policy.allowed).toBe(true);
    expect(policy.fallbackActive).toBe(false);
  });
});
