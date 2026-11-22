import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import TransferRun from "../models/TransferRun";
import {
  beginTransfer,
  createTransfer,
  cancelTransfer,
  getTransfer,
  TransferCancelledError,
} from "../services/transferExecution";
import { transferRouter } from "../routes/transferRoutes";
import { exportRouter } from "../routes/exportRoutes";
import { createAdminToken } from "../services/adminToken";
import {
  startHttpServer,
  jsonCall,
  type HttpTestServer,
} from "./helpers/httpApp";

vi.mock("../db/connectDb", () => ({ default: vi.fn() }));
vi.mock("../services/auditTrail", () => ({
  recordAuditEvent: vi.fn(),
  hashWalletAddress: vi.fn(),
}));
let mongo: MongoMemoryServer;
let http: HttpTestServer;
const secret = "transfer-tests-secret-at-least-16";
function auth(sub = "alice", scope = ["transfers:write"]) {
  return {
    authorization: `Bearer ${createAdminToken(secret, { sub, scope, iss: "test", aud: "prompt-hash-admin" }).token}`,
  };
}
beforeAll(async () => {
  vi.stubEnv("ADMIN_TOKEN_SECRET", secret);
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await TransferRun.init();
  http = await startHttpServer((app) => {
    app.use("/transfers", transferRouter);
    app.use("/exports", exportRouter);
  });
}, 120000);
afterAll(async () => {
  await http?.close();
  await mongoose.disconnect();
  await mongo?.stop();
  vi.unstubAllEnvs();
});
beforeEach(async () => {
  await TransferRun.deleteMany({});
});

describe("durable transfer execution", () => {
  it("records intent before a side effect and commit afterwards without storing input", async () => {
    const execution = await beginTransfer("alice", "import", {
      content: "private prompt",
    });
    await execution.step("row_0", "prompt-reference", async () => {
      const during = await getTransfer(execution.id, "alice");
      expect(during.steps.row_0).toEqual({
        state: "prepared",
        reference: "prompt-reference",
      });
    });
    await execution.finish("completed");
    const final = await getTransfer(execution.id, "alice");
    expect(final.status).toBe("completed");
    expect(final.steps.row_0.state).toBe("committed");
    expect(JSON.stringify(final)).not.toContain("private prompt");
    expect(final.finishedAt).toBeInstanceOf(Date);
    await expect(
      beginTransfer("alice", "import", {}, execution.id),
    ).rejects.toThrow();
  });
  it("retains prepared evidence on failure and binds retries to the original input", async () => {
    const execution = await beginTransfer("alice", "import", { count: 1 });
    await expect(
      execution.step("row_0", "id", async () => {
        throw new Error("lost reply");
      }),
    ).rejects.toThrow("lost reply");
    await execution.finish("failed");
    expect((await getTransfer(execution.id, "alice")).steps.row_0.state).toBe(
      "prepared",
    );
    await expect(
      beginTransfer("alice", "import", { count: 2 }, execution.id),
    ).rejects.toThrow("input changed");
    await expect(
      beginTransfer("bob", "import", { count: 1 }, execution.id),
    ).rejects.toThrow("not found");
    const retry = await beginTransfer(
      "alice",
      "import",
      { count: 1 },
      execution.id,
    );
    await retry.step("row_0", "id", async () => undefined);
    await retry.finish("completed");
  });
  it("only admits one concurrent executor", async () => {
    const run = await createTransfer("alice", "import");
    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () =>
        beginTransfer("alice", "import", {}, String(run._id)),
      ),
    );
    expect(attempts.filter((r) => r.status === "fulfilled")).toHaveLength(1);
  });
  it("finishes an in-flight write, then prevents further writes and completion after cancellation", async () => {
    const execution = await beginTransfer("alice", "import", {});
    const effect = vi.fn(async () => {
      await cancelTransfer(execution.id, "alice");
    });
    await execution.step("row_0", "id", effect);
    expect((await getTransfer(execution.id, "alice")).steps.row_0.state).toBe(
      "committed",
    );
    await expect(execution.step("row_1", "id2", effect)).rejects.toBeInstanceOf(
      TransferCancelledError,
    );
    await expect(execution.finish("completed")).rejects.toBeInstanceOf(
      TransferCancelledError,
    );
    await execution.finish("cancelled");
    await expect(
      beginTransfer("alice", "import", {}, execution.id),
    ).rejects.toBeInstanceOf(TransferCancelledError);
    expect(effect).toHaveBeenCalledTimes(1);
  });
  it("supports pre-cancellation, repeated cancellation and abort signals", async () => {
    const run = await createTransfer("alice", "export");
    await cancelTransfer(String(run._id), "alice");
    expect((await cancelTransfer(String(run._id), "alice")).status).toBe(
      "cancelled",
    );
    await expect(
      beginTransfer("alice", "export", {}, String(run._id)),
    ).rejects.toBeInstanceOf(TransferCancelledError);
    const abort = new AbortController();
    const execution = await beginTransfer(
      "alice",
      "export",
      {},
      undefined,
      abort.signal,
    );
    abort.abort();
    await expect(execution.check()).rejects.toBeInstanceOf(
      TransferCancelledError,
    );
  });
  it("requires signed scoped authorization and isolates owners over HTTP", async () => {
    expect(
      (
        await jsonCall(http.baseUrl, "/transfers", {
          method: "POST",
          body: '{"kind":"import"}',
        })
      ).status,
    ).toBe(401);
    expect(
      (
        await jsonCall(http.baseUrl, "/transfers", {
          method: "POST",
          headers: auth("alice", ["transfers:read"]),
          body: '{"kind":"import"}',
        })
      ).status,
    ).toBe(401);
    const created = await jsonCall(http.baseUrl, "/transfers", {
      method: "POST",
      headers: auth(),
      body: '{"kind":"import"}',
    });
    expect(created.status).toBe(201);
    const id = created.body.transferId;
    expect(
      (
        await jsonCall(http.baseUrl, `/transfers/${id}/cancel`, {
          method: "POST",
          headers: auth("bob"),
        })
      ).status,
    ).toBe(404);
    expect(
      (await jsonCall(http.baseUrl, `/transfers/${id}`, { headers: auth() }))
        .body.status,
    ).toBe("pending");
    expect(
      (
        await jsonCall(http.baseUrl, `/transfers/${id}/cancel`, {
          method: "POST",
          headers: auth(),
        })
      ).body.status,
    ).toBe("cancelled");
    expect(
      (await jsonCall(http.baseUrl, "/transfers/invalid", { headers: auth() }))
        .status,
    ).toBe(400);
  });
  it("denies unauthenticated and insufficient-scope export access before reading or creating artifacts", async () => {
    expect((await jsonCall(http.baseUrl, "/exports")).status).toBe(401);
    expect(
      (await jsonCall(http.baseUrl, "/exports", { method: "POST", body: "{}" }))
        .status,
    ).toBe(401);
    expect(
      (
        await jsonCall(http.baseUrl, "/exports", {
          method: "POST",
          headers: auth(),
          body: "{}",
        })
      ).status,
    ).toBe(401);
    expect(await TransferRun.countDocuments()).toBe(0);
  });
});
