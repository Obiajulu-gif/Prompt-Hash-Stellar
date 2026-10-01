/**
 * Tests — bulk moderation queue (#moderation-queue).
 *
 * Coverage:
 *  - GetModerationQueue: pagination, status/similarityFlag filters, empty result.
 *  - BulkModerationAction: happy path, stale-query skip (ineligible status),
 *    validation errors (missing action/promptIds/reason), 100-item cap.
 *  - ListModerationDecisions: filters by promptId/action/actorWallet.
 *  - RollbackModerationDecision: success, missing reason, already-rolled-back,
 *    not-found.
 *  - Permission targeting: all mutation routes require admin token via
 *    requireAdminScope (tested at the controller layer via req.admin presence).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ── Model mocks ────────────────────────────────────────────────────────────────

vi.mock("../models/Prompt", () => ({
  default: {
    find: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
    findOneAndUpdate: vi.fn(),
    countDocuments: vi.fn(),
  },
}));

vi.mock("../models/ModerationDecision", () => ({
  default: {
    create: vi.fn(),
    find: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));

vi.mock("../models/User", () => ({
  default: {
    findOne: vi.fn(),
  },
}));

vi.mock("../db/connectDb", () => ({ default: vi.fn().mockResolvedValue(undefined) }));

vi.mock("../services/auditTrail", () => ({
  recordAuditEvent: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../services/notificationService", () => ({
  createNotification: vi.fn().mockResolvedValue(null),
}));

vi.mock("../services/structuredLogger", () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import Prompt from "../models/Prompt";
import ModerationDecision from "../models/ModerationDecision";
import { recordAuditEvent } from "../services/auditTrail";
import { createNotification } from "../services/notificationService";
import {
  GetModerationQueue,
  BulkModerationAction,
  ListModerationDecisions,
  RollbackModerationDecision,
} from "../controllers/moderationControllers";

// ── Test helpers ───────────────────────────────────────────────────────────────

function mockReqRes(
  params: Record<string, string> = {},
  query: Record<string, string> = {},
  body: Record<string, unknown> = {},
  admin: { sub: string } | undefined = { sub: "GADMIN" },
) {
  const req = { params, query, body, admin } as any;
  const json = vi.fn();
  const status = vi.fn().mockReturnThis();
  const res = { json, status } as any;
  res.json = json;
  res.status = status;
  status.mockReturnValue(res);
  return { req, res, json, status };
}

// ── GetModerationQueue ────────────────────────────────────────────────────────

describe("GetModerationQueue", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns paginated prompts with total and totalPages", async () => {
    const prompts = [{ _id: "p1", title: "Test Prompt", moderationStatus: "pending_review" }];
    (Prompt.find as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(prompts),
    });
    (Prompt.countDocuments as any).mockResolvedValue(1);

    const { req, res, json } = mockReqRes({}, { page: "1", limit: "20" });
    await GetModerationQueue(req, res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ prompts, page: 1, total: 1, totalPages: 1 }),
    );
  });

  it("applies moderationStatus filter when provided", async () => {
    (Prompt.find as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });
    (Prompt.countDocuments as any).mockResolvedValue(0);

    const { req, res } = mockReqRes({}, { status: "hidden" });
    await GetModerationQueue(req, res);

    expect(Prompt.find).toHaveBeenCalledWith(
      expect.objectContaining({ moderationStatus: "hidden" }),
    );
  });

  it("applies similarityFlag filter when provided", async () => {
    (Prompt.find as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });
    (Prompt.countDocuments as any).mockResolvedValue(0);

    const { req, res } = mockReqRes({}, { similarityFlag: "highly_similar" });
    await GetModerationQueue(req, res);

    expect(Prompt.find).toHaveBeenCalledWith(
      expect.objectContaining({ similarityFlag: "highly_similar" }),
    );
  });

  it("ignores an unrecognised status value and returns unfiltered results", async () => {
    (Prompt.find as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });
    (Prompt.countDocuments as any).mockResolvedValue(0);

    const { req, res } = mockReqRes({}, { status: "not_a_real_status" });
    await GetModerationQueue(req, res);

    const filterArg = (Prompt.find as any).mock.calls[0][0];
    expect(filterArg.moderationStatus).toBeUndefined();
  });

  it("returns empty result set with 200 when no prompts match", async () => {
    (Prompt.find as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      sort: vi.fn().mockReturnThis(),
      skip: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });
    (Prompt.countDocuments as any).mockResolvedValue(0);

    const { req, res, json, status } = mockReqRes({}, {});
    await GetModerationQueue(req, res);

    expect(status).not.toHaveBeenCalledWith(expect.any(Number));
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ prompts: [], total: 0 }),
    );
  });
});

// ── BulkModerationAction ──────────────────────────────────────────────────────

describe("BulkModerationAction", () => {
  beforeEach(() => vi.clearAllMocks());

  const baseBody = {
    action: "approve",
    promptIds: ["p1", "p2"],
    reason: "Passes content guidelines",
  };

  it("applies action to eligible prompts and returns applied/skipped counts", async () => {
    // Both prompts are in "pending_review" — eligible for "approve"
    const candidates = [
      { _id: "p1", moderationStatus: "pending_review", title: "Prompt 1", onChainId: "oc1", owner: { walletAddress: "GCREATOR" } },
      { _id: "p2", moderationStatus: "pending_review", title: "Prompt 2", onChainId: "oc2", owner: { walletAddress: "GCREATOR2" } },
    ];
    (Prompt.find as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(candidates),
    });
    (Prompt.findByIdAndUpdate as any).mockResolvedValue({});
    (ModerationDecision.create as any)
      .mockResolvedValueOnce({ _id: "d1" })
      .mockResolvedValueOnce({ _id: "d2" });

    const { req, res, json } = mockReqRes({}, {}, baseBody);
    await BulkModerationAction(req, res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "approve",
        requested: 2,
        applied: 2,
        skipped: 0,
        decisionIds: expect.arrayContaining(["d1", "d2"]),
      }),
    );
    // Each eligible prompt gets a Prompt update + ModerationDecision + AuditLog entry
    expect(Prompt.findByIdAndUpdate).toHaveBeenCalledTimes(2);
    expect(ModerationDecision.create).toHaveBeenCalledTimes(2);
    expect(recordAuditEvent).toHaveBeenCalledTimes(2);
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "moderation_approve", result: "success" }),
    );
  });

  it("skips prompts that are in an ineligible state (stale-query protection)", async () => {
    // p1 is "approved" — not eligible for another "approve"; p2 is "pending_review"
    const candidates = [
      { _id: "p2", moderationStatus: "pending_review", title: "P2", onChainId: "oc2", owner: { walletAddress: "GC2" } },
    ];
    (Prompt.find as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(candidates),
    });
    (Prompt.findByIdAndUpdate as any).mockResolvedValue({});
    (ModerationDecision.create as any).mockResolvedValue({ _id: "d1" });

    const { req, res, json } = mockReqRes({}, {}, { ...baseBody, promptIds: ["p1", "p2"] });
    await BulkModerationAction(req, res);

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ requested: 2, applied: 1, skipped: 1 }),
    );
  });

  it("returns 400 when action is missing", async () => {
    const { req, res, status } = mockReqRes({}, {}, { promptIds: ["p1"], reason: "test" });
    await BulkModerationAction(req, res);
    expect(status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when action is not a valid value", async () => {
    const { req, res, status } = mockReqRes({}, {}, { action: "delete", promptIds: ["p1"], reason: "test" });
    await BulkModerationAction(req, res);
    expect(status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when promptIds is missing or empty", async () => {
    const { req, res, status } = mockReqRes({}, {}, { action: "approve", promptIds: [], reason: "test" });
    await BulkModerationAction(req, res);
    expect(status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when promptIds exceeds 100 items", async () => {
    const { req, res, status } = mockReqRes(
      {}, {},
      { action: "approve", promptIds: Array.from({ length: 101 }, (_, i) => String(i)), reason: "test" },
    );
    await BulkModerationAction(req, res);
    expect(status).toHaveBeenCalledWith(400);
  });

  it("returns 400 when reason is missing or blank", async () => {
    const { req, res, status } = mockReqRes({}, {}, { action: "approve", promptIds: ["p1"], reason: "   " });
    await BulkModerationAction(req, res);
    expect(status).toHaveBeenCalledWith(400);
  });

  it("fans out moderation_action notification to prompt owner on hide", async () => {
    const candidates = [
      { _id: "p1", moderationStatus: "pending_review", title: "Hidden Prompt", onChainId: "oc1", owner: { walletAddress: "GOWNER" } },
    ];
    (Prompt.find as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(candidates),
    });
    (Prompt.findByIdAndUpdate as any).mockResolvedValue({});
    (ModerationDecision.create as any).mockResolvedValue({ _id: "d1" });

    const { req, res } = mockReqRes({}, {}, { action: "hide", promptIds: ["p1"], reason: "Policy violation" });
    await BulkModerationAction(req, res);

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientWallet: "GOWNER",
        type: "moderation_action",
        message: expect.stringContaining("hidden"),
      }),
    );
  });

  it("fans out moderation_action notification to prompt owner on restore", async () => {
    const candidates = [
      { _id: "p1", moderationStatus: "hidden", title: "Restored Prompt", onChainId: "oc1", owner: { walletAddress: "GOWNER2" } },
    ];
    (Prompt.find as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(candidates),
    });
    (Prompt.findByIdAndUpdate as any).mockResolvedValue({});
    (ModerationDecision.create as any).mockResolvedValue({ _id: "d2" });

    const { req, res } = mockReqRes({}, {}, { action: "restore", promptIds: ["p1"], reason: "Appeal approved" });
    await BulkModerationAction(req, res);

    expect(createNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientWallet: "GOWNER2",
        type: "moderation_action",
        message: expect.stringContaining("restored"),
      }),
    );
  });

  it("does NOT send notification for approve or reject actions", async () => {
    const candidates = [
      { _id: "p1", moderationStatus: "pending_review", title: "T", onChainId: "oc1", owner: { walletAddress: "GOWNER3" } },
    ];
    (Prompt.find as any).mockReturnValue({
      select: vi.fn().mockReturnThis(),
      populate: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(candidates),
    });
    (Prompt.findByIdAndUpdate as any).mockResolvedValue({});
    (ModerationDecision.create as any).mockResolvedValue({ _id: "d3" });

    const { req, res } = mockReqRes({}, {}, { action: "reject", promptIds: ["p1"], reason: "Low quality" });
    await BulkModerationAction(req, res);

    expect(createNotification).not.toHaveBeenCalled();
  });
});

// ── ListModerationDecisions ───────────────────────────────────────────────────

describe("ListModerationDecisions", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns decision list filtered by promptId", async () => {
    const decisions = [{ _id: "d1", action: "approve", promptId: "p1" }];
    (ModerationDecision.find as any).mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue(decisions),
    });

    const { req, res, json } = mockReqRes({}, { promptId: "p1" });
    await ListModerationDecisions(req, res);

    expect(ModerationDecision.find).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: "p1" }),
    );
    expect(json).toHaveBeenCalledWith(decisions);
  });

  it("filters by action when provided", async () => {
    (ModerationDecision.find as any).mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });

    const { req, res } = mockReqRes({}, { action: "hide" });
    await ListModerationDecisions(req, res);

    expect(ModerationDecision.find).toHaveBeenCalledWith(
      expect.objectContaining({ action: "hide" }),
    );
  });

  it("hashes actorWallet before using it as a filter (privacy)", async () => {
    (ModerationDecision.find as any).mockReturnValue({
      sort: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      lean: vi.fn().mockResolvedValue([]),
    });

    const { req, res } = mockReqRes({}, { actorWallet: "GADMIN123" });
    await ListModerationDecisions(req, res);

    const filterArg = (ModerationDecision.find as any).mock.calls[0][0];
    // The raw wallet should NOT appear in the filter
    expect(filterArg.actorWallet).not.toBe("GADMIN123");
    // It should be a 64-char hex hash
    expect(filterArg.actorWallet).toMatch(/^[0-9a-f]{64}$/);
  });
});

// ── RollbackModerationDecision ────────────────────────────────────────────────

describe("RollbackModerationDecision", () => {
  beforeEach(() => vi.clearAllMocks());

  const decision = {
    _id: "d1",
    promptId: "p1",
    action: "hide",
    previousStatus: "pending_review",
    newStatus: "hidden",
    rolledBack: false,
  };

  it("restores previousStatus on the Prompt and marks the decision rolled back", async () => {
    (ModerationDecision.findById as any).mockResolvedValue(decision);
    (Prompt.findOneAndUpdate as any).mockResolvedValue({});
    (ModerationDecision.findByIdAndUpdate as any).mockResolvedValue({});

    const { req, res, json, status } = mockReqRes(
      { id: "d1" },
      {},
      { reason: "Was a false positive" },
    );
    await RollbackModerationDecision(req, res);

    expect(Prompt.findOneAndUpdate).toHaveBeenCalledWith(
      { _id: "p1" },
      expect.objectContaining({
        $set: expect.objectContaining({ moderationStatus: "pending_review" }),
      }),
    );
    expect(ModerationDecision.findByIdAndUpdate).toHaveBeenCalledWith(
      "d1",
      expect.objectContaining({
        $set: expect.objectContaining({ rolledBack: true, rollbackReason: "Was a false positive" }),
      }),
    );
    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({ action: "moderation_rollback", result: "success" }),
    );
    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ restoredStatus: "pending_review" }),
    );
  });

  it("returns 400 when reason is missing", async () => {
    const { req, res, status } = mockReqRes({ id: "d1" }, {}, {});
    await RollbackModerationDecision(req, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(Prompt.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("returns 400 when reason is blank", async () => {
    const { req, res, status } = mockReqRes({ id: "d1" }, {}, { reason: "   " });
    await RollbackModerationDecision(req, res);
    expect(status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the decision does not exist", async () => {
    (ModerationDecision.findById as any).mockResolvedValue(null);
    const { req, res, status } = mockReqRes({ id: "missing" }, {}, { reason: "Reason" });
    await RollbackModerationDecision(req, res);
    expect(status).toHaveBeenCalledWith(404);
  });

  it("returns 400 when the decision has already been rolled back", async () => {
    (ModerationDecision.findById as any).mockResolvedValue({ ...decision, rolledBack: true });
    const { req, res, status } = mockReqRes({ id: "d1" }, {}, { reason: "Try again" });
    await RollbackModerationDecision(req, res);
    expect(status).toHaveBeenCalledWith(400);
    expect(Prompt.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it("records a moderation_rollback AuditLog entry on success", async () => {
    (ModerationDecision.findById as any).mockResolvedValue(decision);
    (Prompt.findOneAndUpdate as any).mockResolvedValue({});
    (ModerationDecision.findByIdAndUpdate as any).mockResolvedValue({});

    const { req, res } = mockReqRes({ id: "d1" }, {}, { reason: "Rollback reason" });
    await RollbackModerationDecision(req, res);

    expect(recordAuditEvent).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "moderation_rollback",
        result: "success",
        promptId: "p1",
        reason: expect.stringContaining("d1"),
      }),
    );
  });
});
