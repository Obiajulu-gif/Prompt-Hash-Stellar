import {
  beforeAll,
  afterAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { EventEmitter } from "node:events";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import Prompt from "../models/Prompt";
import ProvenanceRecord from "../models/ProvenanceRecord";
import TransferRun from "../models/TransferRun";
import { ExportRecord } from "../models/ExportRecord";
import { bulkImportPrompts } from "../controllers/bulkImportController";
import { provenanceService } from "../services/provenanceService";
import {
  runUserExport,
  cleanupExpiredExports,
  verifyExportChecksum,
} from "../services/exportService";
import {
  createTransfer,
  cancelTransfer,
  getTransfer,
  TransferCancelledError,
} from "../services/transferExecution";

vi.mock("../db/connectDb", () => ({ default: vi.fn() }));
vi.mock("../services/auditTrail", () => ({
  recordAuditEvent: vi.fn(),
  hashWalletAddress: (value: string) => `hash-${value}`,
}));
vi.mock("../services/policyLimitService", () => ({
  policyLimitService: { evaluate: () => ({ allowed: true }) },
}));
vi.mock("../services/structuredLogger", () => ({
  logger: { info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));
let mongo: MongoMemoryServer;
const owner = new mongoose.Types.ObjectId().toString();
const items = [0, 1].map((i) => ({
  title: `Imported prompt ${i}`,
  content: "private prompt content",
  image: "https://example.com/p.png",
  category: "Other",
  price: 1,
}));
function response() {
  const res: any = new EventEmitter();
  res.statusCode = 200;
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (data: unknown) => {
    res.body = data;
    return res;
  };
  res.setHeader = vi.fn();
  return res;
}
async function importItems(transferId: string, actor = owner) {
  const res = response();
  await bulkImportPrompts(
    {
      admin: { sub: actor },
      body: { items, transferId },
      headers: {},
      ip: "127.0.0.1",
    } as any,
    res,
  );
  if (!res.body?.result && res.statusCode !== 404)
    throw new Error(JSON.stringify(res.body));
  return res;
}
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
  await Promise.all([
    Prompt.init(),
    ProvenanceRecord.init(),
    TransferRun.init(),
    ExportRecord.init(),
  ]);
}, 120000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  await Promise.all([
    Prompt.deleteMany({}),
    ProvenanceRecord.deleteMany({}),
    TransferRun.deleteMany({}),
    ExportRecord.deleteMany({}),
  ]);
});

describe("bulk import recovery", () => {
  it("checkpoints prompt creation, provenance and finalization, and rejects another owner", async () => {
    const transfer = await createTransfer(owner, "import");
    const denied = await importItems(
      String(transfer._id),
      new mongoose.Types.ObjectId().toString(),
    );
    expect(denied.statusCode).toBe(404);
    expect(await Prompt.countDocuments()).toBe(0);
    const res = await importItems(String(transfer._id));
    expect(res.body.result.successfulItems).toBe(2);
    const run = await getTransfer(String(transfer._id), owner);
    expect(run.status).toBe("completed");
    expect(Object.keys(run.steps)).toHaveLength(6);
    expect(await ProvenanceRecord.countDocuments()).toBe(2);
    const promptIds = (await Prompt.find().lean())
      .map((p) => String(p._id))
      .sort();
    expect(
      (await ProvenanceRecord.find().lean())
        .map((p) => String(p.promptId))
        .sort(),
    ).toEqual(promptIds);
  });
  it("stops between items and preserves committed references on cancellation", async () => {
    const transfer = await createTransfer(owner, "import");
    const original =
      provenanceService.createProvenanceRecord.bind(provenanceService);
    vi.spyOn(
      provenanceService,
      "createProvenanceRecord",
    ).mockImplementationOnce(async (params) => {
      const record = await original(params);
      await cancelTransfer(String(transfer._id), owner);
      return record;
    });
    const res = await importItems(String(transfer._id));
    expect(res.body.result.status).toBe("cancelled");
    expect(res.body.result.imported).toHaveLength(1);
    expect(await Prompt.countDocuments()).toBe(1);
    expect((await getTransfer(String(transfer._id), owner)).status).toBe(
      "cancelled",
    );
  });
  it("retries a provenance failure without duplicating prompts or records", async () => {
    const transfer = await createTransfer(owner, "import");
    vi.spyOn(provenanceService, "createProvenanceRecord").mockRejectedValueOnce(
      new Error("DB unavailable"),
    );
    const failed = await importItems(String(transfer._id));
    expect(failed.body.result.failedItems).toBe(1);
    expect((await getTransfer(String(transfer._id), owner)).status).toBe(
      "failed",
    );
    const retry = await importItems(String(transfer._id));
    expect(retry.body.result.successfulItems).toBe(2);
    expect(await Prompt.countDocuments()).toBe(2);
    expect(await ProvenanceRecord.countDocuments()).toBe(2);
  });
});

describe("export cancellation and deletion", () => {
  it.each(["prompt", "full"] as const)(
    "preserves owner-only contentHash authorization for %s exports",
    async (scope) => {
      const created = await Prompt.create({
        ...items[0],
        owner,
        contentHash: "owner-private-integrity-hash",
      });
      const prompt = await Prompt.findById(created._id).lean();
      const publicRecord = {
        _id: prompt._id,
        onChainId: prompt.onChainId,
        title: prompt.title,
        category: prompt.category,
        isActive: prompt.isActive,
        price: prompt.price,
        ownerWalletHash: `hash-${owner}`,
        createdAt: prompt.createdAt,
        updatedAt: prompt.updatedAt,
        lifecycleState: prompt.lifecycleState,
      };
      expect(publicRecord.ownerWalletHash).toBe(`hash-${owner}`);
      expect(publicRecord).not.toHaveProperty("owner");
      expect(publicRecord).not.toHaveProperty("encryptedPrompt");
      expect(publicRecord).not.toHaveProperty("description");
      const self = await runUserExport(owner, undefined, scope);
      expect(
        verifyExportChecksum(
          [{ ...publicRecord, contentHash: prompt.contentHash }],
          self.integrityChecksum!,
        ),
      ).toBe(true);
      const admin = await runUserExport("support-operator", owner, scope, true);
      expect(
        verifyExportChecksum([publicRecord], admin.integrityChecksum!),
      ).toBe(true);
      expect(admin.integrityChecksum).not.toBe(self.integrityChecksum);
    },
  );
  it("publishes a completed artifact with count/checksum and checkpoints", async () => {
    await Prompt.create({ ...items[0], owner });
    const record = await runUserExport(owner);
    expect(record.status).toBe("completed");
    expect(record.metadata.recordCount).toBe(1);
    expect(record.integrityChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(record.fileUrl).toContain("/api/exports/");
    expect(
      (await getTransfer(String(record._id), owner)).steps.publish.state,
    ).toBe("committed");
  });
  it("closes the cursor and removes publication fields when cancelled during export", async () => {
    const abort = new AbortController();
    const close = vi.fn();
    const cursor = {
      close,
      async *[Symbol.asyncIterator]() {
        yield { _id: "first", title: "first" };
        abort.abort();
        yield { _id: "second", title: "second" };
      },
    };
    vi.spyOn(Prompt, "find").mockReturnValueOnce({
      select: () => ({ sort: () => ({ lean: () => ({ cursor: () => cursor }) }) }),
    } as any);
    await expect(
      runUserExport(owner, undefined, "full", false, { signal: abort.signal }),
    ).rejects.toBeInstanceOf(TransferCancelledError);
    expect(close).toHaveBeenCalledOnce();
    const record = await ExportRecord.findOne().lean();
    expect(record.status).toBe("cancelled");
    expect(record.fileUrl).toBeUndefined();
    expect(record.integrityChecksum).toBeUndefined();
    expect((await getTransfer(String(record._id), owner)).status).toBe(
      "cancelled",
    );
  });
  it("retains failed artifact identity on retry and rejects unauthorized/invalid requests before writes", async () => {
    await expect(
      runUserExport(owner, new mongoose.Types.ObjectId().toString()),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      runUserExport(owner, undefined, "invalid" as any),
    ).rejects.toMatchObject({ status: 400 });
    expect(await TransferRun.countDocuments()).toBe(0);
    const run = await createTransfer(owner, "export");
    vi.spyOn(Prompt, "find").mockImplementationOnce(() => {
      throw new Error("DB unavailable");
    });
    await expect(
      runUserExport(owner, undefined, "prompt", false, {
        transferId: String(run._id),
      }),
    ).rejects.toThrow("DB unavailable");
    expect((await ExportRecord.findById(run._id)).status).toBe("failed");
    await runUserExport(owner, undefined, "prompt", false, {
      transferId: String(run._id),
    });
    expect(await ExportRecord.countDocuments()).toBe(1);
    expect((await ExportRecord.findById(run._id)).status).toBe("completed");
  });
  it("deletes expired terminal artifacts, preserves active exports, propagates failure and safely retries", async () => {
    const first = await runUserExport(owner);
    await ExportRecord.updateOne(
      { _id: first._id },
      { $set: { expiresAt: new Date(0) } },
    );
    const active = await ExportRecord.create({
      userId: owner,
      scope: "prompt",
      status: "pending",
      expiresAt: new Date(0),
      auditTrail: { action: "test", performedBy: owner, reason: "test" },
    });
    vi.spyOn(ExportRecord, "deleteMany").mockRejectedValueOnce(
      new Error("delete failed"),
    );
    await expect(cleanupExpiredExports()).rejects.toThrow("delete failed");
    expect(await cleanupExpiredExports()).toBe(1);
    expect(await cleanupExpiredExports()).toBe(0);
    expect(await ExportRecord.findById(active._id)).not.toBeNull();
  });
});
