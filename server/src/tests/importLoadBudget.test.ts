import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";

/**
 * Worst-case import load budgets (#1173).
 *
 * These tests assert the resource ceilings themselves (boundaries, every
 * violation class, retry determinism, no input mutation) and the endpoint's
 * ordering: authorization first, then budget, then policy/transfer work. That
 * ordering is the security property — an unauthorized or oversized caller
 * must not be able to make the server parse and hold a hostile payload.
 *
 * Wall-clock time is deliberately not asserted here; the executable probe
 * (scripts/importLoadProbe.ts) measures the worst case.
 */

vi.mock("../services/policyLimitService", () => ({
  policyLimitService: { evaluate: vi.fn() },
}));
vi.mock("../services/transferExecution", () => ({
  beginTransfer: vi.fn(),
  responseAbortSignal: vi.fn(() => undefined),
  TransferCancelledError: class TransferCancelledError extends Error {},
  TransferError: class TransferError extends Error {
    status = 500;
  },
}));
vi.mock("../models/Prompt", () => ({
  default: { findOneAndUpdate: vi.fn() },
}));
vi.mock("../services/provenanceService", () => ({
  provenanceService: {
    createProvenanceRecord: vi.fn(),
    queryProvenance: vi.fn(),
    getImportStatistics: vi.fn(),
  },
}));
vi.mock("../services/auditTrail", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/structuredLogger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));
vi.mock("mongoose", () => ({
  default: { isValidObjectId: vi.fn(() => true) },
}));

import {
  assertImportLoadBudget,
  evaluateImportLoadBudget,
  IMPORT_LOAD_BUDGETS,
  ImportLoadBudgetError,
} from "../services/importLoadBudget";
import { bulkImportPrompts } from "../controllers/bulkImportController";
import { policyLimitService } from "../services/policyLimitService";
import { beginTransfer } from "../services/transferExecution";

const evaluate = policyLimitService.evaluate as unknown as ReturnType<typeof vi.fn>;
const begin = beginTransfer as unknown as ReturnType<typeof vi.fn>;

function item(overrides: Record<string, unknown> = {}) {
  return {
    title: "A prompt",
    content: "content",
    image: "https://example.com/p.png",
    category: "Programming",
    price: 1,
    ...overrides,
  };
}

function makeRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  res.setHeader = vi.fn();
  return res as Response;
}

function makeReq(body: any, user: any): Request {
  return {
    body,
    headers: { "user-agent": "vitest" },
    ip: "127.0.0.1",
    user,
    socket: { remoteAddress: "127.0.0.1" },
  } as unknown as Request;
}

const ADMIN = { _id: "507f1f77bcf86cd799439011", role: "admin", username: "ops" };
const REGULAR = { _id: "507f1f77bcf86cd799439012", role: "user", username: "member" };

describe("import load budgets — evaluation", () => {
  it("accepts a batch exactly at the item ceiling", () => {
    const items = Array.from({ length: IMPORT_LOAD_BUDGETS.maxItems }, (_, index) =>
      item({ externalId: `catalog-${index}` }),
    );
    const evaluation = evaluateImportLoadBudget(items);
    expect(evaluation.allowed).toBe(true);
    expect(evaluation.itemCount).toBe(IMPORT_LOAD_BUDGETS.maxItems);
    expect(evaluation.violations).toEqual([]);
  });

  it("rejects one item past the item ceiling with remediation", () => {
    const items = Array.from({ length: IMPORT_LOAD_BUDGETS.maxItems + 1 }, (_, index) =>
      item({ externalId: `catalog-${index}` }),
    );
    const evaluation = evaluateImportLoadBudget(items);
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.violations.map((violation) => violation.code)).toContain(
      "batch_too_large",
    );
    expect(evaluation.violations[0].remediation).toMatch(/Split the import/);
  });

  it("rejects an oversized individual row and identifies it", () => {
    const oversized = item({ content: "x".repeat(IMPORT_LOAD_BUDGETS.maxRowBytes) });
    const evaluation = evaluateImportLoadBudget([item(), oversized]);

    expect(evaluation.allowed).toBe(false);
    const violation = evaluation.violations.find((entry) => entry.code === "row_too_large")!;
    expect(violation.rowIndex).toBe(1);
    expect(violation.message).not.toContain("xxxx"); // never echoes the payload
  });

  it("rejects a batch whose total bytes exceed the batch ceiling", () => {
    // Each row is under the per-row ceiling; together they exceed the batch one.
    const rows = Array.from({ length: 17 }, () =>
      item({ content: "x".repeat(500 * 1024) }),
    );
    const evaluation = evaluateImportLoadBudget(rows);

    expect(evaluation.allowed).toBe(false);
    expect(evaluation.violations.map((violation) => violation.code)).toContain(
      "batch_bytes_exceeded",
    );
    expect(evaluation.totalBytes).toBeGreaterThan(IMPORT_LOAD_BUDGETS.maxBatchBytes);
  });

  it("rejects non-JSON values instead of throwing during serialization", () => {
    const circular: any = item();
    circular.self = circular;
    const evaluation = evaluateImportLoadBudget([circular]);
    expect(evaluation.allowed).toBe(false);
    expect(evaluation.violations[0]).toMatchObject({
      code: "unserializable_row",
      rowIndex: 0,
    });
  });

  it("is deterministic and does not mutate the caller's rows (retry-safe)", () => {
    const items = [item({ externalId: "a" }), item({ content: "y".repeat(1024) })];
    const snapshot = JSON.stringify(items);
    const first = evaluateImportLoadBudget(items);
    const second = evaluateImportLoadBudget(items);

    expect(second).toEqual(first);
    expect(JSON.stringify(items)).toBe(snapshot);
  });

  it("throws a 413-shaped error from the assertion helper", () => {
    try {
      assertImportLoadBudget([item({ content: "x".repeat(IMPORT_LOAD_BUDGETS.maxRowBytes) })]);
      throw new Error("expected assertImportLoadBudget to throw");
    } catch (error) {
      expect(error).toBeInstanceOf(ImportLoadBudgetError);
      const budgetError = error as ImportLoadBudgetError;
      expect(budgetError.status).toBe(413);
      expect(budgetError.code).toBe("import_batch_exceeds_budget");
      expect(budgetError.evaluation.allowed).toBe(false);
    }
  });
});

describe("bulk import endpoint — ordering and rejection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    evaluate.mockReturnValue({ allowed: true });
    begin.mockReturnValue({
      id: "transfer-1",
      check: vi.fn(),
      step: vi.fn(),
      finish: vi.fn(),
    });
  });

  it("denies a non-admin before evaluating budgets or starting a transfer", async () => {
    const res = makeRes();
    await bulkImportPrompts(
      makeReq({ items: [item({ content: "x".repeat(IMPORT_LOAD_BUDGETS.maxRowBytes) })] }, REGULAR),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(403);
    expect(begin).not.toHaveBeenCalled();
    expect(evaluate).not.toHaveBeenCalled();
  });

  it("rejects an oversized admin batch with 413 before policy or transfer work", async () => {
    const res = makeRes();
    await bulkImportPrompts(
      makeReq({ items: [item({ content: "x".repeat(IMPORT_LOAD_BUDGETS.maxRowBytes) })] }, ADMIN),
      res,
    );

    expect(res.status).toHaveBeenCalledWith(413);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        code: "row_too_large",
        retryable: false,
        limits: IMPORT_LOAD_BUDGETS,
      }),
    );
    expect(evaluate).not.toHaveBeenCalled();
    expect(begin).not.toHaveBeenCalled();
  });

  it("keeps the historical 400 for an empty or non-array items payload", async () => {
    const res = makeRes();
    await bulkImportPrompts(makeReq({ items: [] }, ADMIN), res);
    expect(res.status).toHaveBeenCalledWith(400);
    expect(begin).not.toHaveBeenCalled();
  });

  it("applies policy limits only after the budget passes", async () => {
    evaluate.mockReturnValue({ allowed: false, remediation: "split it" });
    const res = makeRes();
    await bulkImportPrompts(makeReq({ items: [item()] }, ADMIN), res);

    expect(res.status).toHaveBeenCalledWith(429);
    expect(evaluate).toHaveBeenCalledOnce();
    expect(begin).not.toHaveBeenCalled();
  });

  it("returns the same rejection on retry (no partial state, no transfer id)", async () => {
    const first = makeRes();
    const second = makeRes();
    const req = () =>
      makeReq({ items: [item({ content: "x".repeat(IMPORT_LOAD_BUDGETS.maxRowBytes) })] }, ADMIN);

    await bulkImportPrompts(req(), first);
    await bulkImportPrompts(req(), second);

    expect(first.status).toHaveBeenCalledWith(413);
    expect(second.status).toHaveBeenCalledWith(413);
    expect((first.json as any).mock.calls).toEqual((second.json as any).mock.calls);
    expect(begin).not.toHaveBeenCalled();
  });
});
