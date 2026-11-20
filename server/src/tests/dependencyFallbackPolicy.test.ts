/**
 * Tests for the executable dependency fallback policy (#1126).
 *
 * Covers the normal, failure, retry, and authorization paths, plus the
 * structural guarantee that every capability × dependency × failure-mode
 * combination resolves to a well-formed, user-safe decision.
 */

import { describe, it, expect, vi } from "vitest";
import {
  AUTHORIZATION_CAPABILITIES,
  CAPABILITY_DEGRADATION_MATRIX,
  DependencyFailureError,
  MUTATING_CAPABILITIES,
  backoffDelayMs,
  createCachedStateSource,
  executeWithFallback,
  requireCapability,
  resolveFallbackDecision,
  type Capability,
  type DependencyState,
} from "../services/dependencyFallbackPolicy.js";
import {
  classifyHttpFailure,
  getDegradationMatrixDefinition,
  type DependencyName,
  type FailureMode,
} from "../services/dependencyDegradationMatrix.js";

const CAPABILITIES = Object.keys(CAPABILITY_DEGRADATION_MATRIX) as Capability[];
const DEPENDENCIES: DependencyName[] = [
  "stellar_rpc",
  "stellar_horizon",
  "mongodb",
  "redis",
  "ipfs_pinata",
  "safety_scanner",
];
const FAILURE_MODES: FailureMode[] = [
  "timeout",
  "connection_refused",
  "rate_limited",
  "auth_failure",
  "partial_data",
  "stale_data",
  "unavailable",
];

const healthy = (): DependencyState[] =>
  DEPENDENCIES.map((dependency) => ({ dependency, healthy: true }));

const down = (dependency: DependencyName, failureMode: FailureMode): DependencyState => ({
  dependency,
  healthy: false,
  failureMode,
});

const withFailure = (dependency: DependencyName, failureMode: FailureMode): DependencyState[] =>
  healthy().map((s) => (s.dependency === dependency ? down(dependency, failureMode) : s));

const noSleep = () => Promise.resolve();

// ---------------------------------------------------------------------------
// Matrix structure
// ---------------------------------------------------------------------------

describe("capability degradation matrix", () => {
  it("only references dependencies documented in the degradation matrix", () => {
    const documented = new Set(getDegradationMatrixDefinition().map((e) => e.name));
    for (const capability of CAPABILITIES) {
      for (const dep of Object.keys(CAPABILITY_DEGRADATION_MATRIX[capability])) {
        expect(documented.has(dep as DependencyName)).toBe(true);
      }
    }
  });

  it.each(CAPABILITIES)("%s yields a well-formed decision for every dependency × failure mode", (capability) => {
    for (const dep of DEPENDENCIES) {
      for (const mode of FAILURE_MODES) {
        const d = resolveFallbackDecision(capability, withFailure(dep, mode));
        expect(["normal", "degraded", "blocked"]).toContain(d.outcome);
        expect(d.httpStatus).toBe(d.outcome === "blocked" ? 503 : 200);
        if (d.outcome !== "normal") {
          expect(d.userMessage).toBeTruthy();
          // User copy must never leak infrastructure detail.
          expect(d.userMessage).not.toMatch(/https?:\/\/|localhost|mongodb:|redis|pinata/i);
          expect(d.userMessage).not.toMatch(/\bECONN[A-Z]+\b/);
        }
        if (d.outcome === "blocked" && d.retryable) {
          expect(d.retryAfterSeconds).toBeGreaterThan(0);
        }
      }
    }
  });

  it("documents an auth_failure entry for every credentialed dependency probe", () => {
    const matrix = getDegradationMatrixDefinition();
    for (const name of ["stellar_rpc", "mongodb", "ipfs_pinata"] as DependencyName[]) {
      const entry = matrix.find((e) => e.name === name)!;
      expect(entry.failureModes.map((m) => m.mode)).toContain("auth_failure");
    }
  });
});

// ---------------------------------------------------------------------------
// Normal path
// ---------------------------------------------------------------------------

describe("normal path", () => {
  it.each(CAPABILITIES)("%s is normal when every dependency is healthy", (capability) => {
    const d = resolveFallbackDecision(capability, healthy());
    expect(d).toMatchObject({
      outcome: "normal",
      httpStatus: 200,
      blockingDependencies: [],
      degradedDependencies: [],
    });
    expect(d.userMessage).toBeUndefined();
  });

  it("ignores failures of dependencies a capability does not use", () => {
    // Browsing does not touch the chain or the safety scanner.
    const states = [down("stellar_rpc", "connection_refused"), down("safety_scanner", "unavailable")];
    expect(resolveFallbackDecision("browse_catalog", states).outcome).toBe("normal");
  });

  it("runs the operation once and reports success", async () => {
    const run = vi.fn().mockResolvedValue("ok");
    const result = await executeWithFallback({ capability: "browse_catalog", states: healthy(), run });
    expect(result).toMatchObject({ status: "ok", value: "ok", attempts: 1 });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it("accepts raw probe results from runDegradationMatrixProbes", () => {
    const probe = { dependency: "stellar_rpc" as const, healthy: false, latencyMs: 9, failureMode: "timeout" as const, checkedAt: "" };
    expect(resolveFallbackDecision("purchase_prompt", [probe]).outcome).toBe("blocked");
  });
});

// ---------------------------------------------------------------------------
// Failure path
// ---------------------------------------------------------------------------

describe("failure path", () => {
  it("blocks purchases when Stellar RPC is down and never invokes the operation", async () => {
    const run = vi.fn();
    const result = await executeWithFallback({
      capability: "purchase_prompt",
      states: withFailure("stellar_rpc", "connection_refused"),
      run,
      idempotencyKey: "k1",
    });
    expect(result.status).toBe("blocked");
    expect(result.attempts).toBe(0);
    expect(run).not.toHaveBeenCalled(); // no funds moved
    expect(result.decision).toMatchObject({
      httpStatus: 503,
      retryable: true,
      retryAfterSeconds: 30,
      blockingDependencies: ["stellar_rpc"],
    });
  });

  it("degrades (not blocks) purchases when only Horizon times out", () => {
    const d = resolveFallbackDecision("purchase_prompt", withFailure("stellar_horizon", "timeout"));
    expect(d.outcome).toBe("degraded");
    expect(d.degradedDependencies).toEqual(["stellar_horizon"]);
    expect(d.userMessage).toMatch(/balance verification/i);
  });

  it("routes publishes to manual review when the safety scanner is down", () => {
    const d = resolveFallbackDecision("publish_prompt", withFailure("safety_scanner", "unavailable"));
    expect(d.outcome).toBe("degraded");
    expect(d.fallbackBehaviors[0]).toMatch(/manual-review queue/);
  });

  it("blocked wins over degraded and uses the longest Retry-After", () => {
    const d = resolveFallbackDecision("purchase_prompt", [
      down("stellar_horizon", "timeout"),
      down("stellar_rpc", "timeout"),
      down("mongodb", "connection_refused"),
    ]);
    expect(d.outcome).toBe("blocked");
    expect(d.blockingDependencies).toEqual(["stellar_rpc", "mongodb"]);
    expect(d.degradedDependencies).toEqual(["stellar_horizon"]);
    expect(d.retryAfterSeconds).toBe(30);
  });

  it("treats an unhealthy dependency with no failure mode as unavailable", () => {
    const d = resolveFallbackDecision("publish_prompt", [{ dependency: "ipfs_pinata", healthy: false }]);
    expect(d.outcome).toBe("blocked");
    expect(d.retryAfterSeconds).toBe(60);
    expect(d.userMessage).toBeTruthy();
  });

  it("does not retry non-dependency errors (e.g. validation bugs)", async () => {
    const run = vi.fn().mockRejectedValue(new TypeError("bad input"));
    const result = await executeWithFallback({ capability: "browse_catalog", states: healthy(), run, sleep: noSleep });
    expect(result.status).toBe("failed");
    expect(run).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Retry path
// ---------------------------------------------------------------------------

describe("retry path", () => {
  it("retries transient dependency failures with exponential backoff and then succeeds", async () => {
    const sleep = vi.fn(noSleep);
    const run = vi
      .fn()
      .mockRejectedValueOnce(new DependencyFailureError("stellar_rpc", "timeout"))
      .mockRejectedValueOnce(new DependencyFailureError("stellar_rpc", "rate_limited"))
      .mockResolvedValueOnce("tx-hash");

    const result = await executeWithFallback({
      capability: "purchase_prompt",
      states: healthy(),
      run,
      idempotencyKey: "purchase-123",
      retry: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 },
      sleep,
    });

    expect(result).toMatchObject({ status: "ok", value: "tx-hash", attempts: 3 });
    expect(sleep.mock.calls.map(([ms]) => ms)).toEqual([100, 200]);
    // The same idempotency key is reused on every attempt so the backend dedupes.
    expect(run.mock.calls.map(([ctx]) => ctx.idempotencyKey)).toEqual([
      "purchase-123",
      "purchase-123",
      "purchase-123",
    ]);
  });

  it("gives up after maxAttempts and surfaces the last error", async () => {
    const err = new DependencyFailureError("mongodb", "connection_refused");
    const run = vi.fn().mockRejectedValue(err);
    const result = await executeWithFallback({
      capability: "browse_catalog",
      states: healthy(),
      run,
      retry: { maxAttempts: 4 },
      sleep: noSleep,
    });
    expect(result).toMatchObject({ status: "failed", attempts: 4, error: err });
  });

  it.each([...MUTATING_CAPABILITIES])(
    "%s is attempted exactly once without an idempotency key (no double charge)",
    async (capability) => {
      const run = vi.fn().mockRejectedValue(new DependencyFailureError("stellar_rpc", "timeout"));
      const result = await executeWithFallback({ capability, states: healthy(), run, sleep: noSleep });
      expect(result.status).toBe("failed");
      expect(run).toHaveBeenCalledTimes(1);
    },
  );

  it("caps backoff at maxDelayMs", () => {
    const policy = { maxAttempts: 10, baseDelayMs: 200, maxDelayMs: 1_000 };
    expect([1, 2, 3, 4, 5].map((a) => backoffDelayMs(a, policy))).toEqual([200, 400, 800, 1_000, 1_000]);
  });

  it("never retries auth_failure mid-request", async () => {
    const run = vi.fn().mockRejectedValue(new DependencyFailureError("ipfs_pinata", "auth_failure"));
    const result = await executeWithFallback({
      capability: "publish_prompt",
      states: healthy(),
      run,
      idempotencyKey: "pub-1",
      sleep: noSleep,
    });
    expect(result.status).toBe("failed");
    expect(run).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Authorization path
// ---------------------------------------------------------------------------

describe("authorization path", () => {
  it("credential rejection blocks the capability and is not client-retryable", () => {
    const d = resolveFallbackDecision("purchase_prompt", withFailure("stellar_rpc", "auth_failure"));
    expect(d).toMatchObject({ outcome: "blocked", retryable: false, retryAfterSeconds: undefined });
  });

  it("auth_failure escalates a normally-degraded dependency to blocked", () => {
    // Pinata is optional for unlock (preview fallback) but a rejected key is not a slow gateway.
    expect(resolveFallbackDecision("unlock_prompt", withFailure("ipfs_pinata", "timeout")).outcome).toBe("degraded");
    expect(resolveFallbackDecision("unlock_prompt", withFailure("ipfs_pinata", "auth_failure")).outcome).toBe("blocked");
  });

  it("unlock fails closed on a stale ledger — access is never granted from stale state", async () => {
    const run = vi.fn();
    const result = await executeWithFallback({
      capability: "unlock_prompt",
      states: withFailure("stellar_rpc", "stale_data"),
      run,
    });
    expect(result.status).toBe("blocked");
    expect(run).not.toHaveBeenCalled();
    expect(result.decision.retryable).toBe(true);
  });

  it("wallet auth rejects stale nonces from Redis instead of degrading", () => {
    expect(resolveFallbackDecision("wallet_auth", withFailure("redis", "connection_refused")).outcome).toBe("degraded");
    expect(resolveFallbackDecision("wallet_auth", withFailure("redis", "stale_data")).outcome).toBe("blocked");
  });

  it("untrusted-state escalation applies only to authorization capabilities", () => {
    for (const capability of CAPABILITIES) {
      const d = resolveFallbackDecision(capability, withFailure("redis", "stale_data"));
      expect(d.outcome).toBe(AUTHORIZATION_CAPABILITIES.has(capability) ? "blocked" : "degraded");
    }
  });

  it("classifies 401/403 probe responses as auth_failure", () => {
    expect(classifyHttpFailure(401, 10, 1000)).toBe("auth_failure");
    expect(classifyHttpFailure(403, 10, 1000)).toBe("auth_failure");
    expect(classifyHttpFailure(429, 10, 1000)).toBe("rate_limited");
    expect(classifyHttpFailure(undefined, 1000, 1000)).toBe("timeout");
    expect(classifyHttpFailure(500, 10, 1000)).toBe("unavailable");
  });
});

// ---------------------------------------------------------------------------
// HTTP integration
// ---------------------------------------------------------------------------

function mockRes() {
  const headers: Record<string, string | number> = {};
  const res = {
    locals: {} as Record<string, unknown>,
    statusCode: 200,
    body: undefined as unknown,
    setHeader: (k: string, v: string | number) => {
      headers[k] = v;
    },
    status(code: number) {
      res.statusCode = code;
      return { json: (body: unknown) => (res.body = body) };
    },
  };
  return { res, headers };
}

describe("requireCapability middleware", () => {
  it("answers 503 with Retry-After for a blocked capability", async () => {
    const { res, headers } = mockRes();
    const next = vi.fn();
    await requireCapability("purchase_prompt", async () => withFailure("stellar_rpc", "timeout"))({}, res, next);
    expect(next).not.toHaveBeenCalled();
    expect(res.statusCode).toBe(503);
    expect(headers["Retry-After"]).toBe(5);
    expect(res.body).toMatchObject({ code: "DEPENDENCY_UNAVAILABLE", capability: "purchase_prompt", retryable: true });
  });

  it("omits Retry-After when the failure is not retryable", async () => {
    const { res, headers } = mockRes();
    await requireCapability("purchase_prompt", async () => withFailure("mongodb", "auth_failure"))({}, res, vi.fn());
    expect(res.statusCode).toBe(503);
    expect(headers["Retry-After"]).toBeUndefined();
    expect(res.body).toMatchObject({ retryable: false });
  });

  it("passes degraded requests through with a header and the decision on res.locals", async () => {
    const { res, headers } = mockRes();
    const next = vi.fn();
    await requireCapability("publish_prompt", async () => withFailure("safety_scanner", "timeout"))({}, res, next);
    expect(next).toHaveBeenCalledWith();
    expect(headers["X-Degraded-Dependencies"]).toBe("safety_scanner");
    expect(res.locals.fallbackDecision).toMatchObject({ outcome: "degraded" });
  });

  it("forwards state-source errors to the error handler", async () => {
    const { res } = mockRes();
    const next = vi.fn();
    const boom = new Error("probe pipeline down");
    await requireCapability("browse_catalog", async () => Promise.reject(boom))({}, res, next);
    expect(next).toHaveBeenCalledWith(boom);
  });
});

describe("createCachedStateSource", () => {
  it("serves cached states within the TTL and shares one in-flight refresh", async () => {
    let t = 0;
    const probe = vi.fn(async () => healthy());
    const source = createCachedStateSource(probe, { ttlMs: 1_000, now: () => t });
    await Promise.all([source(), source(), source()]);
    expect(probe).toHaveBeenCalledTimes(1);
    t = 999;
    await source();
    expect(probe).toHaveBeenCalledTimes(1);
    t = 1_000;
    await source();
    expect(probe).toHaveBeenCalledTimes(2);
  });

  it("keeps the last known states when a refresh fails (recovery without flapping)", async () => {
    let t = 0;
    const known = withFailure("redis", "timeout");
    const probe = vi.fn().mockResolvedValueOnce(known).mockRejectedValueOnce(new Error("probe crashed"));
    const source = createCachedStateSource(probe, { ttlMs: 10, now: () => t });
    expect(await source()).toBe(known);
    t = 50;
    expect(await source()).toBe(known);
  });
});
