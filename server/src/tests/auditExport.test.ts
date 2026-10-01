import { describe, it, expect, vi, beforeEach } from "vitest";
import { AuditLog } from "../models/AuditLog";
import {
  AUDIT_EXPORT_SCOPES,
  buildAuditExportQuery,
  canonicalJson,
  computeRecordHash,
  exportAuditBundle,
  hashWalletAddress,
  recordAuditEvent,
  verifyAuditExport,
} from "../services/auditTrail";

const GENESIS = "0".repeat(64);

interface RowSpec {
  action?: string;
  promptId?: string | null;
  walletAddress?: string | null;
  actor?: string | null;
  reason?: string | null;
  clientIp?: string | null;
  integrityVersion?: number | null;
}

/** Builds a correctly chained set of stored audit rows. */
function buildChain(specs: RowSpec[]): any[] {
  let previousHash = GENESIS;
  return specs.map((spec, index) => {
    const row: any = {
      _id: `65f00000000000000000000${index}`,
      action: spec.action ?? "admin_auth_success",
      result: "success",
      promptId: spec.promptId ?? null,
      walletAddress: spec.walletAddress ?? null,
      actor: spec.actor ?? null,
      requestId: `req-${index}`,
      reason: spec.reason ?? null,
      clientIp: spec.clientIp ?? null,
      createdAt: new Date(Date.UTC(2026, 8, 1, 0, index)),
      previousHash,
      integrityVersion: spec.integrityVersion === undefined ? 2 : spec.integrityVersion,
    };
    row.recordHash = computeRecordHash(row);
    previousHash = row.recordHash;
    return row;
  });
}

/** Stubs AuditLog.find for both the export cursor and the verify lookup. */
function mockStore(rows: any[]) {
  vi.spyOn(AuditLog, "find").mockImplementation(((query: any) => {
    if (query?.recordHash) {
      const wanted = new Set(query.recordHash.$in);
      return { lean: async () => rows.filter((row) => wanted.has(row.recordHash)) };
    }
    const chain: any = {
      sort: () => chain,
      limit: (n: number) => {
        chain.n = n;
        return chain;
      },
      lean: () => chain,
      cursor: () => rows.slice(0, chain.n),
    };
    return chain;
  }) as any);
}

describe("audit export filters (#783)", () => {
  it("matches an actor either by admin subject or by wallet hash", () => {
    const query: any = buildAuditExportQuery({ actor: "ops-jane" });
    expect(query.$and[0].$or).toEqual([
      { actor: "ops-jane" },
      { walletAddress: hashWalletAddress("ops-jane") },
    ]);
  });

  it("filters by action, prompt, and date range", () => {
    const since = new Date("2026-09-01T00:00:00.000Z");
    const until = new Date("2026-09-02T00:00:00.000Z");
    const query: any = buildAuditExportQuery({
      action: ["prompt_restrict"],
      promptId: "42",
      since,
      until,
    });
    expect(query.action).toEqual({ $in: ["prompt_restrict"] });
    expect(query.promptId).toBe("42");
    expect(query.createdAt).toEqual({ $gte: since, $lte: until });
  });

  it("expands a scope into its action codes", () => {
    const query: any = buildAuditExportQuery({ scope: "moderation" });
    expect(query.action.$in).toEqual([...AUDIT_EXPORT_SCOPES.moderation]);
    expect(query.action.$in).toContain("prompt_retire");
    expect(query.action.$in).not.toContain("unlock_success");
  });

  it("intersects explicit actions with the scope", () => {
    expect((buildAuditExportQuery({ scope: "dispute", action: ["unlock_success"] }) as any).action)
      .toEqual({ $in: [] });
    expect((buildAuditExportQuery({ scope: "dispute", action: ["dispute_resolved"] }) as any).action)
      .toEqual({ $in: ["dispute_resolved"] });
  });

  it("rejects a malformed continuation cursor", () => {
    expect(() => buildAuditExportQuery({ after: "not-a-cursor" })).toThrow("Invalid export cursor.");
  });
});

describe("audit export bundle (#783)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("pages large exports with a continuation cursor that resumes after the last record", async () => {
    const rows = buildChain([{}, {}, {}]);
    mockStore(rows);

    const bundle = await exportAuditBundle({ limit: 2 });

    expect(bundle.recordCount).toBe(2);
    expect(bundle.hasMore).toBe(true);
    expect(bundle.nextCursor).toEqual(expect.any(String));

    const next: any = buildAuditExportQuery({ after: bundle.nextCursor! });
    expect(next.$and[0].$or[1]).toEqual({
      createdAt: rows[1].createdAt,
      _id: { $gt: rows[1]._id },
    });
  });

  it("exports chain references but never client IPs", async () => {
    mockStore(buildChain([{ clientIp: "203.0.113.9" }]));

    const bundle = await exportAuditBundle({});

    expect(bundle.records[0].previousHash).toBe(GENESIS);
    expect(bundle.records[0].recordHash).toMatch(/^[a-f0-9]{64}$/);
    expect(bundle.integrityChecksum).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(bundle)).not.toContain("203.0.113.9");
  });

  it("serializes canonically regardless of key order", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: [3, { f: 1, e: 2 }] } })).toBe(
      canonicalJson({ a: { c: [3, { e: 2, f: 1 }], d: 2 }, b: 1 }),
    );
  });
});

describe("audit export verification (#783)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("verifies an untouched export against the stored trail", async () => {
    mockStore(buildChain([{ actor: "ops-jane" }, { action: "prompt_retire", promptId: "7" }]));
    const bundle = await exportAuditBundle({});

    const result = await verifyAuditExport(bundle);

    expect(result).toEqual({ valid: true, recordCount: 2, checksumValid: true, errors: [] });
  });

  it("detects a record edited after export", async () => {
    mockStore(buildChain([{}, { reason: "sub=ops-jane scope=audit:export" }]));
    const bundle = await exportAuditBundle({});

    bundle.records[1].reason = "sub=someone-else";
    const result = await verifyAuditExport(bundle);

    expect(result.valid).toBe(false);
    expect(result.checksumValid).toBe(false);
    expect(result.errors).toContain("Record 2: content does not match its recordHash.");
  });

  it("detects a forged record whose hash was recomputed", async () => {
    mockStore(buildChain([{}]));
    const bundle = await exportAuditBundle({});

    const forged = { ...bundle.records[0], actor: "forger" };
    forged.recordHash = computeRecordHash({ ...forged, walletAddress: forged.walletHash, createdAt: new Date(forged.createdAt) });
    const result = await verifyAuditExport({ ...bundle, records: [forged] });

    expect(result.valid).toBe(false);
    expect(result.errors).toContain("Record 1: no stored audit record has this recordHash.");
  });

  it("detects tampering in the stored trail itself", async () => {
    const rows = buildChain([{ reason: "original" }]);
    mockStore(rows);
    const bundle = await exportAuditBundle({});

    rows[0].reason = "rewritten in the database";
    const result = await verifyAuditExport(bundle);

    expect(result.valid).toBe(false);
    expect(result.errors).toEqual([
      "Record 1: differs from the stored audit record.",
      "Record 1: stored record fails its own integrity hash.",
    ]);
  });

  it("still verifies legacy records written before #783", async () => {
    mockStore(buildChain([{ integrityVersion: null, walletAddress: hashWalletAddress("GABC") }]));
    const bundle = await exportAuditBundle({});

    expect(bundle.records[0].integrityVersion).toBe(1);
    expect((await verifyAuditExport(bundle)).valid).toBe(true);
  });
});

describe("recordAuditEvent integrity (#783)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("persists the exact timestamp it hashed, with actor and hash version", async () => {
    vi.spyOn(AuditLog, "findOne").mockReturnValue({
      sort: () => ({ lean: async () => ({ recordHash: "a".repeat(64) }) }),
    } as any);
    const create = vi.spyOn(AuditLog, "create").mockResolvedValue({} as any);

    await recordAuditEvent({
      action: "dispute_resolved",
      result: "success",
      promptId: "42",
      walletAddress: "GABC",
      actor: "ops-jane",
      reason: "failed->resolved",
    });

    const doc: any = create.mock.calls[0][0];
    expect(doc.createdAt).toBeInstanceOf(Date);
    expect(doc.previousHash).toBe("a".repeat(64));
    expect(doc.integrityVersion).toBe(2);
    expect(doc.actor).toBe("ops-jane");
    expect(doc.walletAddress).toBe(hashWalletAddress("GABC"));
    expect(computeRecordHash(doc)).toBe(doc.recordHash);
    // actor and reason are covered by the hash, not just stored beside it.
    expect(computeRecordHash({ ...doc, reason: "edited" })).not.toBe(doc.recordHash);
    expect(computeRecordHash({ ...doc, actor: "other" })).not.toBe(doc.recordHash);
  });
});
