import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { reasonFromError, trackLifecycle } from "@/lib/analytics/lifecycleClient";
import { LIFECYCLE_FAILURE_REASONS } from "@/lib/analytics/lifecycleStages";

describe("reasonFromError", () => {
  it.each([
    ["User rejected the request", "user_rejected"],
    ["Wrong network connected", "wallet_wrong_network"],
    ["Wallet connection required.", "wallet_not_connected"],
    ["insufficient balance for fee", "tx_insufficient_balance"],
    ["request timed out", "tx_confirmation_timeout"],
    ["Failed to fetch", "tx_network_error"],
    ["Too many requests", "unlock_rate_limited"],
    ["Integrity check failed", "unlock_integrity_failed"],
    ["Access not purchased", "unlock_no_access"],
    ["something totally unexpected for GABC123", "unknown_error"],
  ])("maps %j to %s", (message, expected) => {
    expect(reasonFromError(new Error(message))).toBe(expected);
  });

  it("only ever returns allow-listed reasons", () => {
    for (const input of [new Error("x"), "string", null, undefined, 42]) {
      expect(LIFECYCLE_FAILURE_REASONS as readonly string[]).toContain(reasonFromError(input));
    }
  });
});

describe("trackLifecycle", () => {
  const fetchMock = vi.fn(async () => new Response(null, { status: 204 }));

  beforeEach(() => {
    fetchMock.mockClear();
    vi.stubGlobal("fetch", fetchMock);
    vi.stubEnv("MODE", "development");
    sessionStorage.clear();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
  });

  const lastBody = () => JSON.parse((fetchMock.mock.calls.at(-1) as any)[1].body as string);

  it("is a no-op under test mode so unit tests never hit the network", () => {
    vi.stubEnv("MODE", "test");
    trackLifecycle("purchase", "detail_viewed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("posts an allow-listed event with a random session id and no wallet data", () => {
    trackLifecycle("purchase", "detail_viewed");
    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toMatch(/\/api\/analytics\/lifecycle$/);
    expect(init.keepalive).toBe(true);
    const body = lastBody();
    expect(Object.keys(body).sort()).toEqual(["kind", "sessionId", "stage", "workflow"]);
    expect(body).toMatchObject({ workflow: "purchase", stage: "detail_viewed", kind: "reached" });
    expect(body.sessionId).not.toMatch(/^G[A-Z2-7]{55}$/);
  });

  it("reuses one session id within a tab session", () => {
    trackLifecycle("purchase", "detail_viewed");
    const first = lastBody().sessionId;
    trackLifecycle("purchase", "purchase_started");
    expect(lastBody().sessionId).toBe(first);
  });

  it("sanitises failure reasons and omits them on reached events", () => {
    trackLifecycle("purchase", "purchase_started", "failed", "bob@example.com lost 500 XLM");
    expect(lastBody().reason).toBe("other");
    trackLifecycle("purchase", "purchase_started", "failed", "user_rejected");
    expect(lastBody().reason).toBe("user_rejected");
    trackLifecycle("purchase", "purchase_started");
    expect(lastBody()).not.toHaveProperty("reason");
  });

  it("drops events for unknown stages", () => {
    trackLifecycle("purchase", "not_a_stage");
    trackLifecycle("purchase", "form_opened"); // belongs to publish
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("respects Do Not Track and the off switch", () => {
    Object.defineProperty(navigator, "doNotTrack", { value: "1", configurable: true });
    trackLifecycle("purchase", "detail_viewed");
    expect(fetchMock).not.toHaveBeenCalled();
    Object.defineProperty(navigator, "doNotTrack", { value: null, configurable: true });
    vi.stubEnv("VITE_LIFECYCLE_ANALYTICS", "off");
    trackLifecycle("purchase", "detail_viewed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("never throws, even if fetch throws or rejects", () => {
    fetchMock.mockImplementationOnce(() => {
      throw new Error("boom");
    });
    expect(() => trackLifecycle("purchase", "detail_viewed")).not.toThrow();
    fetchMock.mockImplementationOnce(async () => {
      throw new Error("offline");
    });
    expect(() => trackLifecycle("purchase", "detail_viewed")).not.toThrow();
  });
});
