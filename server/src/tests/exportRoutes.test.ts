import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { jsonCall, startHttpServer, type HttpTestServer } from "./helpers/httpApp";

const mocks = vi.hoisted(() => ({ find: vi.fn(), collect: vi.fn(), verify: vi.fn() }));
vi.mock("../db/connectDb", () => ({ default: vi.fn() }));
vi.mock("../models/ExportRecord", () => ({
  ExportRecord: { findById: () => ({ lean: mocks.find }) },
}));
vi.mock("../middleware/adminAuth", () => ({
  requireAdminScope: () => (req: any, res: any, next: () => void) => {
    const requester = req.get("x-test-export-reader");
    if (!requester) return res.sendStatus(401);
    req.admin = { sub: requester };
    next();
  },
}));
vi.mock("../middleware/idempotency", () => ({ requireIdempotency: vi.fn() }));
vi.mock("../middleware/rateLimiter", () => ({
  authLimiter: (_req: unknown, _res: unknown, next: () => void) => next(),
}));
vi.mock("../services/exportService", async (importOriginal) => ({
  ...await importOriginal<typeof import("../services/exportService")>(),
  collectExportRecords: mocks.collect,
  verifyExportChecksum: mocks.verify,
}));
import { exportRouter } from "../routes/exportRoutes";

let server: HttpTestServer;
beforeAll(async () => {
  server = await startHttpServer((app) => app.use("/exports", exportRouter));
});
afterAll(async () => server?.close());
beforeEach(() => {
  vi.resetAllMocks();
  mocks.find.mockResolvedValue({
    userId: "owner",
    auditTrail: { performedBy: "owner" },
    status: "completed",
    expiresAt: new Date(Date.now() + 60000),
    scope: "prompt",
    integrityChecksum: "checksum",
  });
});

const download = (requester?: string) => jsonCall(server.baseUrl, "/exports/job-1/download", {
  headers: requester ? { "x-test-export-reader": requester } : {},
});

describe("export downloads", () => {
  it("denies unsigned requests and other readers of an owner-only artifact", async () => {
    expect((await download()).status).toBe(401);
    expect(mocks.find).not.toHaveBeenCalled();
    expect((await download("other-admin")).status).toBe(403);
    expect(mocks.collect).not.toHaveBeenCalled();
  });

  it("withholds changed records and permits a subsequent matching download", async () => {
    const records = [{ title: "Example", contentHash: "owner-digest" }];
    mocks.collect.mockResolvedValue(records);
    mocks.verify.mockReturnValueOnce(false).mockReturnValueOnce(true);
    const changed = await download("owner");
    expect(changed.status).toBe(409);
    expect(changed.body).not.toHaveProperty("records");
    const retry = await download("owner");
    expect(retry.status).toBe(200);
    expect(retry.body).toEqual({ records, integrityChecksum: "checksum" });
    expect(mocks.collect).toHaveBeenLastCalledWith("owner", "prompt", true);
  });
});
