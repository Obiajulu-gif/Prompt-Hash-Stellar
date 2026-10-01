import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  evaluateClientFeatureFlag,
  getClientSafeFallback,
  CLIENT_SAFE_FALLBACKS,
} from "../lib/featureFlags";

describe("Client Feature Flags", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("returns safe defaults for known client flags", () => {
    expect(getClientSafeFallback("stellar_atomic_settlement")).toBe(false);
    expect(getClientSafeFallback("prompt_preview_markdown_sanitize_v2")).toBe(true);
    expect(getClientSafeFallback("unknown_flag")).toBe(false);
  });

  it("evaluates flag with fallback when backend is unreachable", async () => {
    vi.spyOn(global, "fetch").mockRejectedValueOnce(new Error("Network connection refused"));

    const res = await evaluateClientFeatureFlag("stellar_atomic_settlement");
    expect(res.enabled).toBe(false);
    expect(res.source).toBe("safe_fallback");
  });

  it("evaluates server response when backend is reachable", async () => {
    vi.spyOn(global, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        name: "stellar_atomic_settlement",
        enabled: true,
        reason: "Enabled on development",
        source: "server",
      }),
    } as any);

    const res = await evaluateClientFeatureFlag("stellar_atomic_settlement", "user_123");
    expect(res.enabled).toBe(true);
    expect(res.source).toBe("server");
  });
});
