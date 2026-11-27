/**
 * Mongo adapter for the entitlement repair job (#1129), against a real mongod.
 *
 * Covers what the in-memory port cannot: the ObjectId pagination cursor, the real
 * grant/revoke writes, and the audit rows that name the operator. The page size is
 * 1 so the run crosses several cursor boundaries.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import mongoose from "mongoose";
import { setupRealMongo, teardownRealMongo, resetRealMongo } from "./helpers/realMongo";
import { runBackfill, memoryCheckpointStore } from "../services/backfillEngine";
import { entitlementRepairJob } from "../services/entitlementRepairJob";
import { mongoEntitlementRepairPort } from "../services/entitlementRepairAdapter";
import { Entitlement } from "../models/Entitlement";
import { AuditLog } from "../models/AuditLog";

let mongoUp = false;
const OP = "ops-alice";

beforeAll(async () => {
  mongoUp = await setupRealMongo();
}, 60_000);

afterAll(async () => {
  await teardownRealMongo();
});

beforeEach(async () => {
  if (mongoUp) await resetRealMongo();
});

async function seedPurchases() {
  const ids = [
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
    new mongoose.Types.ObjectId(),
  ];
  // Raw inserts bypass the Purchase validators; this test is about the repair path.
  await mongoose.connection.collection("purchases").insertMany([
    { _id: ids[0], buyerWallet: "gbuy1", promptId: "pr1", status: "paid", txHash: "tx1" },
    { _id: ids[1], buyerWallet: "gbuy2", promptId: "pr2", disputeResolution: "refunded" },
    { _id: ids[2], buyerWallet: "gbuy3", promptId: "pr3", status: "paid" },
  ]);
  // gbuy2 still has an active entitlement, so the refund must revoke it.
  await mongoose.connection.collection("entitlements").insertOne({
    userAddress: "gbuy2",
    promptId: "pr2",
    status: "active",
  });
  return ids;
}

describe("entitlement repair — Mongo adapter (#1129)", () => {
  it("dry run over real records reports the diffs and leaves entitlements untouched", async ({ skip }) => {
    if (!mongoUp) return skip();
    await seedPurchases();
    const report = await runBackfill(
      entitlementRepairJob(mongoEntitlementRepairPort(), OP),
      memoryCheckpointStore(),
      { dryRun: true, batchSize: 1 },
    );
    expect(report.scanned).toBe(3);
    expect(report.planned).toBe(3);
    expect(report.applied).toBe(0);
    expect(await Entitlement.countDocuments({ userAddress: "gbuy1" })).toBe(0);
    expect((await Entitlement.findOne({ userAddress: "gbuy2" }).lean())?.status).toBe("active");
    expect(await AuditLog.countDocuments({ action: "entitlement_repair" })).toBe(0);
  });

  it("apply pages across ObjectId cursors, converges, and audits each write with the operator", async ({ skip }) => {
    if (!mongoUp) return skip();
    await seedPurchases();
    const store = memoryCheckpointStore();
    const report = await runBackfill(
      entitlementRepairJob(mongoEntitlementRepairPort(), OP),
      store,
      { dryRun: false, batchSize: 1 },
    );

    expect(report.scanned).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.complete).toBe(true);
    expect((await Entitlement.findOne({ userAddress: "gbuy1" }).lean())?.status).toBe("active");
    expect((await Entitlement.findOne({ userAddress: "gbuy2" }).lean())?.status).toBe("refunded");
    expect((await Entitlement.findOne({ userAddress: "gbuy3" }).lean())?.status).toBe("active");

    const audits = await AuditLog.find({ action: "entitlement_repair" }).lean();
    expect(audits).toHaveLength(3);
    expect(audits.every((a: any) => a.actor === OP)).toBe(true);

    // Replaying the same repair writes nothing new.
    const again = await runBackfill(
      entitlementRepairJob(mongoEntitlementRepairPort(), OP),
      memoryCheckpointStore(),
      { dryRun: false, batchSize: 1 },
    );
    expect(again.applied).toBe(0);
    expect(await AuditLog.countDocuments({ action: "entitlement_repair" })).toBe(3);
  });
});
