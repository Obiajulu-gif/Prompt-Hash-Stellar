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
import InboundWebhookEvent from "../models/InboundWebhookEvent";
import QuarantinedEvent from "../models/QuarantinedEvent";
import JobRecord from "../models/JobRecord";
import Report from "../models/Report";
import RetentionHold from "../models/RetentionHold";
import { runRetentionCleanup } from "../jobs/handlers/retentionCleanup";

vi.mock("../services/structuredLogger", () => ({
  logger: { info: vi.fn(), error: vi.fn() },
}));
const now = new Date("2026-10-19T12:00:00Z");
const old = new Date("2024-01-01T00:00:00Z");
const boundary = new Date(now.getTime() - 30 * 86400000);
let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 120000);
afterAll(async () => {
  await mongoose.disconnect();
  await mongo?.stop();
});
beforeEach(async () => {
  vi.restoreAllMocks();
  for (const model of [
    InboundWebhookEvent,
    QuarantinedEvent,
    JobRecord,
    Report,
    RetentionHold,
  ])
    await model.deleteMany({});
});
async function inbound(extra: Record<string, unknown> = {}) {
  const id = new mongoose.Types.ObjectId();
  await InboundWebhookEvent.collection.insertOne({
    _id: id,
    idempotencyKey: String(id),
    eventType: "test",
    source: "test",
    processingStatus: "processed",
    rawBody: "private diagnostic payload",
    rawHeaders: { trace: "private" },
    errorMessage: "private diagnostic error details",
    createdAt: old,
    updatedAt: old,
    ...extra,
  });
  return id;
}
describe("sensitive operational retention against real MongoDB", () => {
  it("scrubs every batch past held/archived rows, preserves cutoff and unresolved records, and is repeatable", async () => {
    const flagged = await inbound({ retentionHold: true });
    const archived = await inbound({ archivedAt: old, rawBody: "" });
    const ledgerHeld = await inbound();
    await RetentionHold.collection.insertOne({
      caseType: "legal",
      caseRef: "case",
      status: "active",
      links: [{ store: "inboundWebhookEvents", recordId: String(ledgerHeld) }],
    });
    const ids = await Promise.all([inbound(), inbound(), inbound()]);
    const edge = await inbound({ createdAt: boundary });
    const unresolved = await inbound({ processingStatus: "failed" });
    const before = await InboundWebhookEvent.find().lean();
    const preview = await runRetentionCleanup({
      now,
      dryRun: true,
      batchSize: 1,
    });
    expect(preview.inboundWebhookEvents.eligible).toBe(3);
    expect(await InboundWebhookEvent.find().lean()).toEqual(before);
    const result = await runRetentionCleanup({ now, batchSize: 1 });
    expect(result.inboundWebhookEvents.archived).toBe(3);
    for (const id of ids) {
      const doc = await InboundWebhookEvent.findById(id).lean();
      expect(doc.rawBody).toBe("");
      expect(doc.rawHeaders).toEqual({});
      expect(doc.errorMessage).toBeNull();
      expect(doc.idempotencyKey).toBe(String(id));
      expect(doc.archivedAt).toEqual(now);
    }
    for (const id of [flagged, ledgerHeld, edge, unresolved]) {
      expect((await InboundWebhookEvent.findById(id).lean()).rawBody).toBe(
        "private diagnostic payload",
      );
    }
    expect(
      (await runRetentionCleanup({ now, batchSize: 1 })).inboundWebhookEvents
        .archived,
    ).toBe(0);
    expect(await InboundWebhookEvent.findById(archived)).not.toBeNull();
    await RetentionHold.deleteMany({});
    expect(
      (await runRetentionCleanup({ now, batchSize: 1 })).inboundWebhookEvents
        .archived,
    ).toBe(1);
  });
  it("scrubs quarantine, export job errors and support evidence while preserving stable identities", async () => {
    const q = new mongoose.Types.ObjectId(),
      job = new mongoose.Types.ObjectId(),
      report = new mongoose.Types.ObjectId();
    await QuarantinedEvent.collection.insertOne({
      _id: q,
      status: "discarded",
      updatedAt: old,
      rawTopic: "private",
      rawValue: "private",
      rawXdr: "private",
      errorDetails: "private",
      eventId: "event",
    });
    await JobRecord.collection.insertOne({
      _id: job,
      type: "export_csv",
      status: "dead_letter",
      updatedAt: old,
      payload: { version: 1, creatorWallet: "private" },
      lastError: "private",
      attemptHistory: [{ error: "private" }],
    });
    await Report.collection.insertOne({
      _id: report,
      status: "resolved",
      resolvedAt: old,
      reporterAddress: "private",
      description: "private",
      adminNotes: "private",
      evidence: [{ url: "private" }],
    });
    const result = await runRetentionCleanup({ now, batchSize: 1 });
    expect(result.quarantinedEvents.archived).toBe(1);
    expect(result.exports.archived).toBe(1);
    expect(result.supportEvidence.archived).toBe(1);
    const quarantine = await QuarantinedEvent.findById(q).lean();
    for (const key of ["rawTopic", "rawValue", "rawXdr", "errorDetails"])
      expect(quarantine[key]).toBeUndefined();
    const exported = await JobRecord.findById(job).lean();
    expect(exported.payload).toEqual({ version: 1, archived: true });
    expect(exported.lastError).toBeNull();
    expect(exported.attemptHistory).toEqual([]);
    const evidence = await Report.findById(report).lean();
    expect(evidence.reporterAddress).toBe("[redacted]");
    expect(evidence.evidence).toEqual([]);
    expect(evidence.description).toBe("");
    expect(evidence.adminNotes).toBe("");
  });
  it("fails closed when hold lookup fails, then recovers on retry", async () => {
    const id = await inbound();
    vi.spyOn(RetentionHold, "find").mockImplementationOnce(() => {
      throw new Error("hold ledger unavailable");
    });
    await expect(runRetentionCleanup({ now })).rejects.toThrow(
      "hold ledger unavailable",
    );
    expect((await InboundWebhookEvent.findById(id).lean()).rawBody).toBe(
      "private diagnostic payload",
    );
    expect(
      (await runRetentionCleanup({ now })).inboundWebhookEvents.archived,
    ).toBe(1);
  });
  it("rechecks a newly applied per-record hold at the destructive update boundary", async () => {
    const id = await inbound();
    const update = InboundWebhookEvent.updateMany.bind(InboundWebhookEvent);
    vi.spyOn(InboundWebhookEvent, "updateMany").mockImplementationOnce(
      async (...args: any[]) => {
        await InboundWebhookEvent.updateOne(
          { _id: id },
          { $set: { retentionHold: true } },
        );
        return update(...args);
      },
    );
    expect(
      (await runRetentionCleanup({ now })).inboundWebhookEvents.archived,
    ).toBe(0);
    expect((await InboundWebhookEvent.findById(id).lean()).rawBody).toBe(
      "private diagnostic payload",
    );
  });
});
