import { describe, expect, it, vi } from "vitest";
import {
  requireCapability,
  resolveFallbackDecision,
} from "../services/dependencyFallbackPolicy.js";

const down = (dependency: "stellar_rpc" | "stellar_horizon", failureMode: "timeout" | "connection_refused") => [
  { dependency, healthy: false, failureMode },
];

describe("issue #1208 dependency outage recovery UX", () => {
  it("returns safe, actionable retry guidance without infrastructure details", () => {
    const decision = resolveFallbackDecision("purchase_prompt", down("stellar_rpc", "timeout"));

    expect(decision.outcome).toBe("blocked");
    expect(decision.retryable).toBe(true);
    expect(decision.retryAfterSeconds).toBeGreaterThan(0);
    expect(decision.userMessage).toBeTruthy();
    expect(decision.userMessage).not.toMatch(/stellar_rpc|localhost|token|secret/i);
  });

  it("does not suggest retrying rejected credentials", () => {
    const decision = resolveFallbackDecision("purchase_prompt", [
      { dependency: "stellar_rpc", healthy: false, failureMode: "auth_failure" },
    ]);

    expect(decision).toMatchObject({ outcome: "blocked", retryable: false });
    expect(decision.retryAfterSeconds).toBeUndefined();
  });

  it("keeps a degraded optional dependency visible while allowing recovery", async () => {
    const response = {
      locals: {} as Record<string, unknown>,
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
      setHeader: vi.fn(),
    } as any;
    const next = vi.fn();

    await requireCapability(
      "purchase_prompt",
      async () => [{ dependency: "stellar_horizon", healthy: false, failureMode: "connection_refused" }],
    )({} as any, response, next);

    expect(next).toHaveBeenCalledWith();
    expect(response.setHeader).toHaveBeenCalledWith("X-Degraded-Dependencies", "stellar_horizon");
    expect(response.locals.fallbackDecision).toMatchObject({ outcome: "degraded", retryable: true });
  });
});
