import { describe, expect, it } from "vitest";
import {
  DEFAULT_RETRY_AFTER_MS,
  formatRetryDelay,
  hasCriticalOutage,
  normalizeDependencyHealth,
  retryAfterDelayMs,
} from "../../lib/health/dependencyHealth";

describe("normalizeDependencyHealth", () => {
  it("maps a healthy readiness payload", () => {
    const view = normalizeDependencyHealth(
      {
        status: "ok",
        checkedAt: "2026-11-21T10:00:00.000Z",
        cached: false,
        dependencies: [
          { name: "database", status: "up", critical: true, latencyMs: 3 },
          { name: "stellar_rpc", status: "up", critical: false, latencyMs: 41.6 },
        ],
      },
      200,
    );

    expect(view.reported).toBe(true);
    expect(view.status).toBe("ok");
    expect(view.dependencies).toEqual([
      { name: "database", status: "up", critical: true, latencyMs: 3 },
      { name: "stellar_rpc", status: "up", critical: false, latencyMs: 42 },
    ]);
    expect(hasCriticalOutage(view)).toBe(false);
  });

  it("keeps documented reason codes but drops everything else", () => {
    const view = normalizeDependencyHealth(
      {
        status: "degraded",
        dependencies: [
          {
            name: "indexer",
            status: "degraded",
            critical: false,
            latencyMs: 4,
            reason: "unhealthy",
            detail: "mongo-primary.internal:27017",
            observed: { host: "mongo-primary.internal" },
          },
          {
            name: "stellar_rpc",
            status: "down",
            critical: false,
            latencyMs: 2003,
            reason: "connect ECONNREFUSED 10.0.0.7:8000",
          },
        ],
      },
      200,
    );

    expect(view.dependencies[0]).toEqual({
      name: "indexer",
      status: "degraded",
      critical: false,
      latencyMs: 4,
      reason: "unhealthy",
    });
    expect(view.dependencies[1].reason).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain("mongo-primary");
    expect(JSON.stringify(view)).not.toContain("10.0.0.7");
  });

  it("drops malformed dependency entries instead of rendering them", () => {
    const view = normalizeDependencyHealth(
      {
        status: "degraded",
        dependencies: [
          { name: "", status: "up", critical: true, latencyMs: 1 },
          { name: "database", status: "exploded", critical: true, latencyMs: 1 },
          { status: "up", critical: false, latencyMs: 1 },
          null,
          "not-a-dependency",
          { name: "indexer", status: "down", critical: false, latencyMs: -5 },
        ],
      },
      200,
    );

    expect(view.dependencies).toEqual([
      { name: "indexer", status: "down", critical: false, latencyMs: 0 },
    ]);
  });

  it("treats the legacy {status:'ok'} payload as not reporting dependencies", () => {
    const view = normalizeDependencyHealth(
      { status: "ok", timestamp: "2026-11-21T10:00:00.000Z", uptime: 10 },
      200,
    );

    expect(view).toMatchObject({ status: "ok", reported: false, dependencies: [] });
  });

  it("classifies an unparsable 5xx body as an outage", () => {
    expect(normalizeDependencyHealth(null, 503)).toMatchObject({
      status: "down",
      reported: false,
    });
  });

  it("flags a critical outage only for a critical dependency", () => {
    const down = (critical: boolean) =>
      normalizeDependencyHealth(
        {
          status: "down",
          dependencies: [{ name: "database", status: "down", critical, latencyMs: 2 }],
        },
        503,
      );

    expect(hasCriticalOutage(down(true))).toBe(true);
    expect(hasCriticalOutage(down(false))).toBe(false);
  });
});

describe("retryAfterDelayMs", () => {
  const now = Date.parse("2026-11-21T10:00:00.000Z");

  it("parses delta-seconds", () => {
    expect(retryAfterDelayMs("5", now)).toBe(5_000);
    expect(retryAfterDelayMs(" 0 ", now)).toBe(0);
  });

  it("parses an HTTP date and never returns a negative delay", () => {
    expect(retryAfterDelayMs("Sat, 21 Nov 2026 10:00:10 GMT", now)).toBe(10_000);
    expect(retryAfterDelayMs("Sat, 21 Nov 2026 09:59:00 GMT", now)).toBe(0);
  });

  it("clamps to a minute and falls back when unusable", () => {
    expect(retryAfterDelayMs("600", now)).toBe(60_000);
    expect(retryAfterDelayMs("soon", now)).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(retryAfterDelayMs(null, now)).toBe(DEFAULT_RETRY_AFTER_MS);
    expect(retryAfterDelayMs(undefined, now)).toBe(DEFAULT_RETRY_AFTER_MS);
  });
});

describe("formatRetryDelay", () => {
  it("renders seconds and minutes", () => {
    expect(formatRetryDelay(5_000)).toBe("5s");
    expect(formatRetryDelay(60_000)).toBe("1m");
    expect(formatRetryDelay(90_000)).toBe("1m 30s");
  });
});
