/**
 * Tamper-evident audit ledger integrity — Issue #982.
 *
 * AuditLog is replaced with an in-memory store that behaves like the database
 * where it matters for the chain:
 *   - reads of the head happen before the store yields, so concurrent appends
 *     really do race on the same head (the fork the queue must prevent);
 *   - a second record with an already-used previousHash is rejected with
 *     E11000, the same as the partial unique index on previousHash.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { AuditLog, AUDIT_SCHEMA_ACTIONS } from "../models/AuditLog";
import {
  AUDIT_INTEGRITY_VERSION,
  computeRecordHash,
  recordAuditEvent,
  recordMaintenanceChange,
  verifyAuditTrail,
} from "../services/auditTrail";

const GENESIS = "0".repeat(64);
const tick = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

let rows: any[] = [];

/** Builds a row exactly as recordAuditEvent would store it. */
function chainedRow(previousHash: string, actor: string, metadata: unknown = null): any {
  const row: any = {
    _id: `id-${rows.length + 1}-${actor}`,
    action: "admin_auth_success",
    result: "success",
    promptId: null,
    walletAddress: null,
    actor,
    target: null,
    targetType: null,
    beforeState: null,
    afterState: null,
    requestId: null,
    reason: null,
    metadata,
    createdAt: new Date(Date.UTC(2026, 9, 1, 0, 0, rows.length)),
    previousHash,
    integrityVersion: AUDIT_INTEGRITY_VERSION,
  };
  row.recordHash = computeRecordHash(row);
  return row;
}

/**
 * Head lookup. The head is captured synchronously and returned after a yield,
 * so two callers that overlap both see the same, now-stale, head.
 */
function mockHeadReads(getHead: () => unknown) {
  vi.spyOn(AuditLog, "findOne").mockImplementation((() => ({
    sort: () => ({
      lean: async () => {
        const head = getHead();
        await tick();
        return head;
      },
    }),
  })) as any);
}

function mockInsertWithUniquePreviousHash() {
  vi.spyOn(AuditLog, "create").mockImplementation((async (doc: any) => {
    await tick();
    if (rows.some((row) => row.previousHash === doc.previousHash)) {
      throw Object.assign(new Error("E11000 duplicate key error on previousHash"), {
        code: 11000,
      });
    }
    const stored = { ...doc, _id: `id-${rows.length + 1}` };
    rows.push(stored);
    return stored;
  }) as any);
}

function mockChainWalk() {
  vi.spyOn(AuditLog, "find").mockImplementation((() => ({
    sort: () => ({
      lean: () => ({
        cursor: () =>
          (async function* () {
            for (const row of rows) yield row;
          })(),
      }),
    }),
  })) as any);
}

describe("audit ledger integrity (#982)", () => {
  beforeEach(() => {
    rows = [];
    mockInsertWithUniquePreviousHash();
    mockChainWalk();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("keeps one linear chain under concurrent appends", async () => {
    mockHeadReads(() => rows[rows.length - 1] ?? null);

    await Promise.all(
      Array.from({ length: 10 }, (_, i) =>
        recordAuditEvent({
          action: "admin_auth_success",
          result: "success",
          actor: `ops-${i}`,
          requestId: `req-${i}`,
        }),
      ),
    );

    expect(rows).toHaveLength(10);
    const previousHashes = rows.map((row) => row.previousHash);
    expect(new Set(previousHashes).size).toBe(10);
    expect(previousHashes[0]).toBe(GENESIS);

    const result = await verifyAuditTrail();
    expect(result.valid).toBe(true);
    expect(result.totalRecords).toBe(10);
  });

  it("recovers from a stale head through the duplicate previousHash retry", async () => {
    // Another replica has already appended a record on genesis.
    rows = [chainedRow(GENESIS, "other-replica")];

    // The first head read is stale (genesis), so the insert conflicts; the
    // retry reads the real head and succeeds.
    let staleReads = 1;
    mockHeadReads(() => (staleReads-- > 0 ? null : rows[rows.length - 1] ?? null));

    await recordAuditEvent({
      action: "admin_auth_success",
      result: "success",
      actor: "ops-retry",
      requestId: "req-retry",
    }, { throwOnError: true });

    expect(rows).toHaveLength(2);
    expect(rows[1].previousHash).toBe(rows[0].recordHash);
    expect((await verifyAuditTrail()).valid).toBe(true);
  });

  it("surfaces the error when a fork persists past the retry budget", async () => {
    rows = [chainedRow(GENESIS, "other-replica")];
    // Every head read stays stale, so every attempt conflicts.
    mockHeadReads(() => null);

    await expect(
      recordAuditEvent(
        { action: "admin_auth_success", result: "success", actor: "ops-stuck" },
        { throwOnError: true },
      ),
    ).rejects.toMatchObject({ code: 11000 });
    expect(rows).toHaveLength(1);
  });

  it("detects tampering with metadata, which v3 records now cover", async () => {
    mockHeadReads(() => rows[rows.length - 1] ?? null);
    await recordAuditEvent({
      action: "admin_auth_success",
      result: "success",
      actor: "ops-meta",
      metadata: { limit: 5 },
    });
    expect((await verifyAuditTrail()).valid).toBe(true);

    rows[0].metadata = { limit: 500 };
    const result = await verifyAuditTrail();
    expect(result.valid).toBe(false);
    expect(result.errors.join("\n")).toMatch(/hash mismatch/);
  });

  it("still verifies v2 rows whose digests predate metadata coverage", async () => {
    const legacy: any = {
      _id: "legacy-1",
      action: "admin_auth_success",
      result: "success",
      promptId: null,
      walletAddress: null,
      requestId: null,
      createdAt: new Date(Date.UTC(2026, 0, 1)),
      previousHash: GENESIS,
      integrityVersion: 2,
    };
    legacy.recordHash = computeRecordHash(legacy);
    rows = [legacy];

    expect((await verifyAuditTrail()).valid).toBe(true);
  });

  it("persists maintenance-banner changes as schema-valid chained records", async () => {
    expect(AUDIT_SCHEMA_ACTIONS).toContain("admin_maintenance_change");

    mockHeadReads(() => rows[rows.length - 1] ?? null);
    await recordMaintenanceChange({
      actor: "ops-banner",
      bannerId: "banner-1",
      scopes: ["global"],
      beforeState: null,
      afterState: { title: "Maintenance" },
      reason: "maintenance_banner_created",
    });

    expect(rows).toHaveLength(1);
    expect(rows[0].action).toBe("admin_maintenance_change");
    expect(rows[0].previousHash).toBe(GENESIS);
    expect(rows[0].recordHash).toBe(computeRecordHash(rows[0]));
    expect((await verifyAuditTrail()).valid).toBe(true);
  });
});
