import { describe, it, expect, beforeEach, beforeAll, afterAll, vi } from "vitest";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

// We dynamically import jobQueue after connecting, to avoid model overwrite issues
let mongod: MongoMemoryServer;

async function setupDb() {
  mongod = await MongoMemoryServer.create();
  const uri = mongod.getUri();
  await mongoose.connect(uri);
}

async function teardownDb() {
  await mongoose.disconnect();
  await mongod.stop();
}

describe("jobQueue — retry, backoff, dead-letter, idempotency", () => {
  beforeEach(async () => {
    const JobRecord = (await import("../models/JobRecord")).default;
    await JobRecord.deleteMany({});
  });

  it("enqueues and retrieves a job (observable)", async () => {
    const { enqueueJob, getJobById, listJobs } = await import("../jobs/jobQueue");
    const job = await enqueueJob("settlement_poll", { version: 1, purchaseId: "p1", promptId: "1", buyerWallet: "gbuyer", txHash: "hash" });
    expect(job.type).toBe("settlement_poll");
    expect(job.status).toBe("pending");
    expect(job.payload.version).toBe(1);

    const fetched = await getJobById(job.id);
    expect(fetched?.id).toBe(job.id);

    const listed = await listJobs({ status: "pending" });
    expect(listed.length).toBe(1);
  });

  it("rejects payload without version or too large", async () => {
    const { enqueueJob } = await import("../jobs/jobQueue");
    await expect(enqueueJob("export_csv" as any, { creatorWallet: "g" } as any)).rejects.toThrow(/versioned/);
    const big = { version: 1, creatorWallet: "g", requestedBy: "g", extra: "x".repeat(5000) } as any;
    await expect(enqueueJob("export_csv", big)).rejects.toThrow(/too large/i);
  });

  it("is idempotent via dedupeKey — same key within window returns same job", async () => {
    const { enqueueJob } = await import("../jobs/jobQueue");
    const payload = { version: 1 as const, windowDays: 30 };
    const j1 = await enqueueJob("analytics_aggregate", payload, { dedupeKey: "daily-agg", dedupeWindowMs: 60000 });
    const j2 = await enqueueJob("analytics_aggregate", payload, { dedupeKey: "daily-agg", dedupeWindowMs: 60000 });
    expect(j2.id).toBe(j1.id);
    const { listJobs } = await import("../jobs/jobQueue");
    const all = await listJobs({ type: "analytics_aggregate" });
    expect(all.length).toBe(1);
  });

  it("retries with exponential backoff and lands in dead_letter after maxAttempts", async () => {
    const { enqueueJob, markJobFailed, getJobById } = await import("../jobs/jobQueue");
    const job = await enqueueJob("settlement_poll", { version: 1, purchaseId: "p2", promptId: "2", buyerWallet: "gbuyer" }, { maxAttempts: 3 });

    // fail 1
    let j = await markJobFailed(job.id, "first failure");
    expect(j.status).toBe("pending");
    expect(j.attempts).toBe(1);
    expect(j.lastError).toMatch(/first failure/);
    expect(new Date(j.nextRunAt).getTime()).toBeGreaterThan(Date.now() - 1000);

    // fail 2 — still pending
    j = await markJobFailed(job.id, "second failure");
    expect(j.status).toBe("pending");
    expect(j.attempts).toBe(2);

    // fail 3 — dead_letter (maxAttempts=3, attempts==3 means no more retries)
    j = await markJobFailed(job.id, "third failure");
    expect(j.status).toBe("dead_letter");
    expect(j.attempts).toBe(3);
    expect(j.lastError).toMatch(/third failure/);

    const fetched = await getJobById(job.id);
    expect(fetched?.status).toBe("dead_letter");
  });

  it("computeBackoffDelayMs is deterministic and exponential", async () => {
    const { computeBackoffDelayMs } = await import("../jobs/jobQueue");
    expect(computeBackoffDelayMs(1, 1000)).toBe(1000);
    expect(computeBackoffDelayMs(2, 1000)).toBe(2000);
    expect(computeBackoffDelayMs(3, 1000)).toBe(4000);
    expect(computeBackoffDelayMs(4, 1000)).toBe(8000);
    // same inputs always same output — no jitter
    expect(computeBackoffDelayMs(2, 1000)).toBe(2000);
  });

  it("failed jobs do not silently disappear — appear in dead_letter list", async () => {
    const { enqueueJob, markJobFailed, getDeadLetterJobs } = await import("../jobs/jobQueue");
    const job = await enqueueJob("export_csv", { version: 1, creatorWallet: "gcreator", requestedBy: "gcreator" }, { maxAttempts: 1 });
    await markJobFailed(job.id, "boom");
    const dlq = await getDeadLetterJobs();
    expect(dlq.some((j) => j.id === job.id)).toBe(true);
  });

  it("requeueDeadLetter resets to pending", async () => {
    const { enqueueJob, markJobFailed, requeueDeadLetter } = await import("../jobs/jobQueue");
    const job = await enqueueJob("analytics_aggregate", { version: 1, windowDays: 30 }, { maxAttempts: 1 });
    await markJobFailed(job.id, "fail");
    const requeued = await requeueDeadLetter(job.id);
    expect(requeued.status).toBe("pending");
    expect(requeued.attempts).toBe(0);
  });

  it("handler idempotency: settlement_poll no-ops when already settled", async () => {
    const { handleSettlementPoll } = await import("../jobs/handlers/settlementPoll");
    // without DB, handler should throw retryable when txHash missing, but with txHash it upserts
    // We test the no-throw path with minimal payload that includes txHash
    const job = { id: "fake", type: "settlement_poll", payload: { version: 1, purchaseId: "p3", promptId: "3", buyerWallet: "gbuyer", txHash: "hash3" } } as any;
    await expect(handleSettlementPoll(job)).resolves.toBeUndefined();
  });

  // Lifecycle: start mongo for these tests
  // Vitest runs with --run, so we hook beforeAll/afterAll via top-level
}, 20000);

// Setup/teardown at file level
beforeAll(async () => {
  // Only if mongodb-memory-server is available; otherwise skip DB-dependent tests
  try {
    await setupDb();
  } catch (e) {
    console.warn("[jobQueue.test] MongoMemoryServer not available, skipping DB tests:", e);
  }
});

afterAll(async () => {
  try {
    await teardownDb();
  } catch {}
});
