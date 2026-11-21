// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { HealthReport } from "../server/src/services/publicHealth";

const mocks = vi.hoisted(() => ({
  connectDb: vi.fn(),
  findOne: vi.fn(),
}));

vi.mock("../server/src/db/connectDb", () => ({ default: mocks.connectDb }));
vi.mock("../server/src/models/IndexerState", () => ({
  IndexerState: { findOne: mocks.findOne },
}));

import { createHealthHandler } from "./health";

function createResponse() {
  return {
    statusCode: 0,
    body: undefined as any,
    headers: {} as Record<string, string>,
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
}

function report(overrides: Partial<HealthReport> = {}): HealthReport {
  return {
    status: "ok",
    checkedAt: "2026-11-21T10:00:00.000Z",
    dependencies: [
      {
        name: "database",
        critical: true,
        status: "up",
        latencyMs: 3,
        attempts: 1,
        checkedAt: "2026-11-21T10:00:00.000Z",
      },
      {
        name: "indexer",
        critical: false,
        status: "up",
        latencyMs: 4,
        attempts: 1,
        checkedAt: "2026-11-21T10:00:00.000Z",
      },
    ],
    ...overrides,
  };
}

async function call(monitorReport: HealthReport, deps: Parameters<typeof createHealthHandler>[1] = {}) {
  const monitor = { evaluate: vi.fn(async () => ({ report: monitorReport, cached: false })) };
  const handler = createHealthHandler(monitor, deps);
  const res = createResponse();
  await handler({ method: "GET", headers: {}, url: "/api/health" }, res);
  return res;
}

describe("GET /api/health dependency-aware readiness (#1179)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.connectDb.mockResolvedValue(undefined);
    mocks.findOne.mockResolvedValue({ lastIndexedLedger: 42 });
  });

  it("normal path: 200 ok keeps the legacy fields and adds redacted dependencies", async () => {
    const res = await call(report());

    expect(res.statusCode).toBe(200);
    expect(res.headers["Cache-Control"]).toBe("no-store");
    expect(res.body).toMatchObject({
      status: "ok",
      indexer: { lastProcessedLedger: 42 },
    });
    expect(typeof res.body.timestamp).toBe("string");
    expect(typeof res.body.uptime).toBe("number");
    expect(res.body.dependencies.map((dependency: any) => dependency.name)).toEqual([
      "database",
      "indexer",
    ]);
  });

  it("degraded non-critical dependency still serves 200", async () => {
    const res = await call(
      report({
        status: "degraded",
        dependencies: [
          {
            name: "indexer",
            critical: false,
            status: "degraded",
            latencyMs: 4,
            attempts: 1,
            reason: "unhealthy",
            checkedAt: "2026-11-21T10:00:00.000Z",
          },
        ],
      }),
    );

    expect(res.statusCode).toBe(200);
    expect(res.body).toMatchObject({ status: "degraded" });
    expect(res.body.dependencies[0]).toMatchObject({ status: "degraded", reason: "unhealthy" });
  });

  it("failure path: a critical dependency returns 503 with Retry-After and no raw detail", async () => {
    const res = await call(
      report({
        status: "down",
        dependencies: [
          {
            name: "database",
            critical: true,
            status: "down",
            latencyMs: 12,
            attempts: 2,
            detail: "connect ECONNREFUSED mongo-primary.internal:27017",
            observed: { host: "mongo-primary.internal" },
            checkedAt: "2026-11-21T10:00:00.000Z",
          },
        ],
      }),
    );

    expect(res.statusCode).toBe(503);
    expect(res.headers["Retry-After"]).toBe("30");
    const body = JSON.stringify(res.body);
    expect(body).not.toContain("mongo-primary");
    expect(body).not.toContain("27017");
    expect(res.body.dependencies[0]).toMatchObject({ status: "down", reason: "unreachable" });
  });

  it("recovery path: reports ok again after the dependency comes back", async () => {
    await call(report({ status: "down" }));
    const recovered = await call(report());
    expect(recovered.statusCode).toBe(200);
    expect(recovered.body.status).toBe("ok");
    expect(recovered.headers["Retry-After"]).toBeUndefined();
  });

  it("survives a failed database connection and still publishes a redacted report", async () => {
    mocks.connectDb.mockRejectedValue(new Error("connect ECONNREFUSED 10.1.2.3:27017"));
    const res = await call(
      report({
        status: "down",
        dependencies: [
          {
            name: "database",
            critical: true,
            status: "down",
            latencyMs: 2,
            attempts: 2,
            detail: "connect ECONNREFUSED 10.1.2.3:27017",
            checkedAt: "2026-11-21T10:00:00.000Z",
          },
        ],
      }),
    );

    expect(res.statusCode).toBe(503);
    expect(res.body.indexer).toEqual({ lastProcessedLedger: 0 });
    expect(JSON.stringify(res.body)).not.toContain("10.1.2.3");
  });

  it("turns a crashed monitor into a 503 instead of a 500", async () => {
    const handler = createHealthHandler({
      evaluate: vi.fn(async () => {
        throw new Error("monitor exploded");
      }),
    });
    const res = createResponse();
    await handler({ method: "GET", headers: {}, url: "/api/health" }, res);

    expect(res.statusCode).toBe(503);
    expect(res.headers["Retry-After"]).toBe("30");
    expect(res.body).toMatchObject({ status: "down", dependencies: [] });
    expect(JSON.stringify(res.body)).not.toContain("monitor exploded");
  });

  it("authorization path: stays public, ignores caller credentials, and never echoes them", async () => {
    const monitor = { evaluate: vi.fn(async () => ({ report: report(), cached: false })) };
    const handler = createHealthHandler(monitor);
    const res = createResponse();

    await handler(
      {
        method: "GET",
        headers: { authorization: "Bearer super-secret-token" },
        url: "/api/health",
      },
      res,
    );

    expect(res.statusCode).toBe(200);
    expect(JSON.stringify(res.body)).not.toContain("super-secret-token");
    expect(JSON.stringify(res.body)).not.toContain("Bearer");
  });
});
