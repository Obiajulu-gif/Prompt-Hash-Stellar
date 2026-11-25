import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { Request, Response } from "express";
import { Keypair } from "@stellar/stellar-sdk";
import { promptRouter } from "../routes/promptRoutes";
import {
  createWalletSession,
  issueWalletChallenge,
  walletSessionSecret,
} from "../middleware/walletSession";
import { recordAccessOrOwnershipChange } from "../services/auditTrail";
import Prompt from "../models/Prompt";
import User from "../models/User";
import OwnershipTransfer from "../models/OwnershipTransfer";
import OwnershipTransferDispute from "../models/OwnershipTransferDispute";
import {
  RequestOwnershipTransfer,
  GetOwnershipTransfers,
  RespondOwnershipTransfer,
  CancelOwnershipTransfer,
} from "../controllers/transferControllers";

vi.mock("../db/connectDb", () => ({
  default: vi.fn(),
}));
// promptRoutes transitively imports notification senders; stub them as
// adminAuth.test.ts does so importing the router needs no credentials.
vi.mock("../services/emailNotifications", () => ({
  notifyPromptReported: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../services/discordNotifications", () => ({
  announceNewPrompt: vi.fn().mockResolvedValue(undefined),
}));
// Controller unit tests: keep audit writes and the maintainer-approval gate
// (covered by their own suites) off the unconnected mongoose models.
vi.mock("../services/auditTrail", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../services/auditTrail")>()),
  // Implementations passed to vi.fn survive the suites' vi.restoreAllMocks().
  recordAuditEvent: vi.fn(async () => undefined),
  recordAccessOrOwnershipChange: vi.fn(async () => undefined),
}));
vi.mock("../services/approvalService", () => ({
  ApprovalService: {
    checkProtectedActionApproval: vi.fn(async () => ({ requiresApproval: false })),
  },
}));

/** Minimal mongoose chain for findOne(...).populate().lean().exec(). */
function chain<T>(doc: T) {
  const ch: any = {
    populate: vi.fn(() => ch),
    lean: vi.fn(() => ({ exec: vi.fn().mockResolvedValue(doc) })),
    select: vi.fn(() => ch),
    exec: vi.fn().mockResolvedValue(doc),
    ...(doc as any),
  };
  return ch;
}

const objectId = () => new mongoose.Types.ObjectId();

function mkTransfer(overrides: Partial<any> = {}) {
  return {
    _id: objectId(),
    promptId: "101",
    promptTitle: "SQL Prompt",
    fromWallet: FROM.toLowerCase(),
    toWallet: TO.toLowerCase(),
    status: "pending",
    expiresAt: new Date(Date.now() + 60 * 60 * 1000),
    createdAt: new Date("2026-07-01T10:00:00Z"),
    decidedAt: null,
    decidedBy: null,
    ...overrides,
  };
}

/** deterministic valid-format 56-char uppercase Stellar-like addresses */
const FROM = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA1111111111111111111111111";
const TO = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB2222222222222222222222222";
const OTHER = "GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC3333333333333333333333333";

function req(overrides: Partial<Request> = {}): Partial<Request> {
  return { params: {}, query: {}, body: {}, headers: {}, ...overrides };
}

function res(): Partial<Response> {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn(),
    send: vi.fn().mockReturnThis(),
  };
}

describe("RequestOwnershipTransfer (#708)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
    // No open dispute holds the listing unless a test says so (#907).
    vi.spyOn(OwnershipTransferDispute, "exists").mockResolvedValue(null as any);
  });

  it("rejects requests without all fields", async () => {
    const mockRes = res();
    await RequestOwnershipTransfer(req({ body: {} }) as Request, mockRes as Response);
    expect(mockRes.status).toHaveBeenCalledWith(400);
  });

  it("returns 404 when the prompt has no owner record", async () => {
    vi.spyOn(Prompt, "findOne").mockReturnValue(chain(null) as any);
    const mockRes = res();
    await RequestOwnershipTransfer(
      req({
        body: { promptId: "999", fromWallet: FROM, toWallet: TO, signature: "sig" },
      }) as Request,
      mockRes as Response,
    );
    expect(mockRes.status).toHaveBeenCalledWith(404);
    expect(mockRes.json).toHaveBeenCalledWith({ error: "Prompt not found." });
  });

  it("returns 403 when the requester is not the current owner", async () => {
    vi.spyOn(Prompt, "findOne").mockReturnValue(
      chain({ owner: { walletAddress: FROM.toLowerCase() } }) as any,
    );
    const mockRes = res();
    await RequestOwnershipTransfer(
      req({
        body: { promptId: "101", fromWallet: TO, toWallet: FROM, signature: "sig" },
      }) as Request,
      mockRes as Response,
    );
    expect(mockRes.status).toHaveBeenCalledWith(403);
  });

  it("creates a pending transfer when the owner requests it", async () => {
    vi.spyOn(Prompt, "findOne")
      .mockReturnValueOnce(chain({ owner: { walletAddress: FROM.toLowerCase() } }) as any)
      .mockReturnValueOnce(chain({ title: "SQL Prompt" }) as any);
    vi.spyOn(OwnershipTransfer, "updateMany").mockResolvedValue({ modifiedCount: 0 } as any);
    vi.spyOn(OwnershipTransfer, "findOne").mockResolvedValue(null);
    const created = mkTransfer();
    vi.spyOn(OwnershipTransfer, "create").mockResolvedValue(created as any);

    const mockRes = res();
    await RequestOwnershipTransfer(
      req({
        body: { promptId: "101", fromWallet: FROM, toWallet: TO, signature: "sig" },
      }) as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(201);
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: "101", status: "pending", toWallet: TO.toLowerCase() }),
    );
  });

  it("sets a bounded expiry on every new transfer", async () => {
    vi.spyOn(Prompt, "findOne")
      .mockReturnValueOnce(chain({ owner: { walletAddress: FROM.toLowerCase() } }) as any)
      .mockReturnValueOnce(chain({ title: "SQL Prompt" }) as any);
    vi.spyOn(OwnershipTransfer, "updateMany").mockResolvedValue({ modifiedCount: 0 } as any);
    vi.spyOn(OwnershipTransfer, "findOne").mockResolvedValue(null);
    const create = vi.spyOn(OwnershipTransfer, "create").mockResolvedValue(mkTransfer() as any);
    const before = Date.now();

    await RequestOwnershipTransfer(
      req({ body: { promptId: "101", fromWallet: FROM, toWallet: TO } }) as Request,
      res() as Response,
    );

    const expiresAt = create.mock.calls[0][0].expiresAt as Date;
    expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + TRANSFER_TTL_MS - 1_000);
    expect(expiresAt.getTime()).toBeLessThanOrEqual(Date.now() + TRANSFER_TTL_MS + 1_000);
  });

  it("holds the listing with 423 while an open ownership dispute exists, and creates nothing (#907)", async () => {
    vi.spyOn(Prompt, "findOne").mockReturnValueOnce(
      chain({ owner: { walletAddress: FROM.toLowerCase() } }) as any,
    );
    vi.spyOn(OwnershipTransfer, "updateMany").mockResolvedValue({ modifiedCount: 0 } as any);
    vi.spyOn(OwnershipTransfer, "findOne").mockResolvedValue(null);
    vi.spyOn(OwnershipTransferDispute, "exists").mockResolvedValue({ _id: objectId() } as any);
    const create = vi.spyOn(OwnershipTransfer, "create");

    const mockRes = res();
    await RequestOwnershipTransfer(
      req({ body: { promptId: "101", fromWallet: FROM, toWallet: TO } }) as Request,
      mockRes as Response,
    );

    expect(OwnershipTransferDispute.exists).toHaveBeenCalledWith({ promptId: "101", status: "open" });
    expect(mockRes.status).toHaveBeenCalledWith(423);
    expect(create).not.toHaveBeenCalled();
  });

  it("returns 409 when a pending request already exists", async () => {
    vi.spyOn(Prompt, "findOne").mockReturnValue(chain({ owner: { walletAddress: FROM.toLowerCase() } }) as any);
    vi.spyOn(OwnershipTransfer, "updateMany").mockResolvedValue({ modifiedCount: 0 } as any);
    vi.spyOn(OwnershipTransfer, "findOne").mockResolvedValue(mkTransfer() as any);

    const mockRes = res();
    await RequestOwnershipTransfer(
      req({
        body: { promptId: "101", fromWallet: FROM, toWallet: TO, signature: "sig" },
      }) as Request,
      mockRes as Response,
    );
    expect(mockRes.status).toHaveBeenCalledWith(409);
  });

  it("allows only one live pending transfer per listing, whatever the target (#1034)", async () => {
    vi.spyOn(Prompt, "findOne").mockReturnValue(chain({ owner: { walletAddress: FROM.toLowerCase() } }) as any);
    vi.spyOn(OwnershipTransfer, "updateMany").mockResolvedValue({ modifiedCount: 0 } as any);
    const findOne = vi
      .spyOn(OwnershipTransfer, "findOne")
      .mockResolvedValue(mkTransfer({ toWallet: OTHER.toLowerCase() }) as any);
    const create = vi.spyOn(OwnershipTransfer, "create");

    const mockRes = res();
    await RequestOwnershipTransfer(
      req({ body: { promptId: "101", fromWallet: FROM, toWallet: TO } }) as Request,
      mockRes as Response,
    );

    expect(findOne).toHaveBeenCalledWith({
      promptId: "101",
      status: "pending",
      expiresAt: { $gt: expect.any(Date) },
    });
    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(create).not.toHaveBeenCalled();
  });

  it("expires this listing's lapsed requests before checking for a live one (#1034)", async () => {
    vi.spyOn(Prompt, "findOne")
      .mockReturnValueOnce(chain({ owner: { walletAddress: FROM.toLowerCase() } }) as any)
      .mockReturnValueOnce(chain({ title: "SQL Prompt" }) as any);
    const updateMany = vi
      .spyOn(OwnershipTransfer, "updateMany")
      .mockResolvedValue({ modifiedCount: 1 } as any);
    vi.spyOn(OwnershipTransfer, "findOne").mockResolvedValue(null);
    vi.spyOn(OwnershipTransfer, "create").mockResolvedValue(mkTransfer() as any);

    const mockRes = res();
    await RequestOwnershipTransfer(
      req({ body: { promptId: "101", fromWallet: FROM, toWallet: TO } }) as Request,
      mockRes as Response,
    );

    expect(updateMany).toHaveBeenCalledWith(
      { promptId: "101", status: "pending", expiresAt: { $lte: expect.any(Date) } },
      { $set: { status: "expired" } },
    );
    expect(mockRes.status).toHaveBeenCalledWith(201);
  });
});

describe("GetOwnershipTransfers (#708)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("expires overdue requests and returns inbound and outbound lists", async () => {
    vi.spyOn(OwnershipTransfer, "updateMany").mockResolvedValue({ modifiedCount: 1 } as any);

    const inbound = mkTransfer();
    const outbound = mkTransfer({ toWallet: OTHER.toLowerCase() });

    const findChain = (docs: any[]) => ({
      ...chain(docs),
      sort: vi.fn(() => ({ ...chain(docs), limit: vi.fn(() => chain(docs)) })),
    });

    const findSpy = vi.spyOn(OwnershipTransfer, "find") as any;
    findSpy
      .mockImplementationOnce(() => findChain([inbound]))
      .mockImplementationOnce(() => findChain([outbound]));

    const mockRes = res();
    await GetOwnershipTransfers(
      req({ params: { walletAddress: TO } }) as Request,
      mockRes as Response,
    );

    expect(OwnershipTransfer.updateMany).toHaveBeenCalledWith(
      {
        status: "pending",
        expiresAt: { $lte: expect.any(Date) },
        $or: [{ toWallet: TO.toLowerCase() }, { fromWallet: TO.toLowerCase() }],
      },
      { $set: { status: "expired" } },
    );
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({
        inbound: expect.arrayContaining([expect.objectContaining({ promptId: "101" })]),
        outbound: expect.arrayContaining([
          expect.objectContaining({ toWallet: OTHER.toLowerCase() }),
        ]),
      }),
    );
  });
});

describe("RespondOwnershipTransfer (#708)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("approves and re-points the indexed prompt owner", async () => {
    const pending = mkTransfer();
    const approved = { ...pending, status: "approved", decidedBy: TO.toLowerCase(), decidedAt: new Date() };
    const findByIdSpy = vi.spyOn(OwnershipTransfer, "findById");
    findByIdSpy
      .mockImplementationOnce(() => Promise.resolve(pending) as any)
      .mockImplementationOnce(() => chain(approved) as any);
    vi.spyOn(OwnershipTransfer, "updateOne").mockResolvedValue({ modifiedCount: 1 } as any);
    const previousOwnerId = objectId();
    const recipientId = objectId();
    vi.spyOn(User, "findOne")
      .mockResolvedValueOnce({ _id: previousOwnerId })
      .mockResolvedValueOnce({ _id: recipientId });
    vi.spyOn(Prompt, "findOneAndUpdate").mockImplementationOnce(
      () => chain({ _id: objectId() }) as any,
    );

    const mockRes = res();
    await RespondOwnershipTransfer(
      req({
        params: { transferId: pending._id.toString() },
        body: { walletAddress: TO, decision: "approved", signature: "sig" },
      }) as Request,
      mockRes as Response,
    );

    // The claim is bound to the expiry so a request that lapses mid-flight
    // cannot be approved.
    expect(OwnershipTransfer.updateOne).toHaveBeenCalledWith(
      { _id: pending._id, status: "pending", expiresAt: { $gt: expect.any(Date) } },
      expect.objectContaining({ $set: expect.objectContaining({ status: "approved" }) }),
    );
    // Compare-and-swap on the current owner (#1034).
    expect(Prompt.findOneAndUpdate).toHaveBeenCalledWith(
      { onChainId: pending.promptId, owner: previousOwnerId },
      { $set: { owner: recipientId } },
      { new: true },
    );
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: "101", status: "approved" }),
    );
    expect(recordAccessOrOwnershipChange).toHaveBeenCalledWith(
      expect.objectContaining({ action: "ownership_transfer_accepted" }),
    );
  });

  it("cancels a stale request when the listing changed hands since it was made (#1034)", async () => {
    const pending = mkTransfer();
    vi.spyOn(OwnershipTransfer, "findById").mockReturnValueOnce(Promise.resolve(pending) as any);
    vi.spyOn(OwnershipTransfer, "updateOne").mockResolvedValue({ modifiedCount: 1 } as any);
    vi.spyOn(User, "findOne")
      .mockResolvedValueOnce({ _id: objectId() })
      .mockResolvedValueOnce({ _id: objectId() });
    // CAS misses: the prompt is no longer owned by the requester.
    vi.spyOn(Prompt, "findOneAndUpdate").mockImplementationOnce(() => chain(null) as any);

    const mockRes = res();
    await RespondOwnershipTransfer(
      req({
        params: { transferId: pending._id.toString() },
        body: { walletAddress: TO, decision: "approved" },
      }) as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(OwnershipTransfer.updateOne).toHaveBeenLastCalledWith(
      { _id: pending._id, status: "approved" },
      { $set: { status: "cancelled", rejectionReason: "owner_changed" } },
    );
    expect(recordAccessOrOwnershipChange).not.toHaveBeenCalledWith(
      expect.objectContaining({ action: "ownership_transfer_accepted" }),
    );
  });

  it("returns 409 without touching the listing when the claim misses an expiry race", async () => {
    const pending = mkTransfer();
    vi.spyOn(OwnershipTransfer, "findById").mockReturnValueOnce(Promise.resolve(pending) as any);
    vi.spyOn(OwnershipTransfer, "updateOne").mockResolvedValue({ modifiedCount: 0 } as any);
    const promptUpdate = vi.spyOn(Prompt, "findOneAndUpdate");

    const mockRes = res();
    await RespondOwnershipTransfer(
      req({
        params: { transferId: pending._id.toString() },
        body: { walletAddress: TO, decision: "approved" },
      }) as Request,
      mockRes as Response,
    );

    expect(mockRes.status).toHaveBeenCalledWith(409);
    expect(promptUpdate).not.toHaveBeenCalled();
  });

  it("rejects a transfer as decided when already approved", async () => {
    const pending = mkTransfer();
    vi.spyOn(OwnershipTransfer, "findById").mockReturnValueOnce(Promise.resolve(pending) as any);
    vi.spyOn(OwnershipTransfer, "updateOne").mockResolvedValue({ modifiedCount: 0 } as any);
    const mockRes = res();
    await RespondOwnershipTransfer(
      req({
        params: { transferId: pending._id.toString() },
        body: { walletAddress: TO, decision: "approved", signature: "sig" },
      }) as Request,
      mockRes as Response,
    );
    expect(mockRes.status).toHaveBeenCalledWith(409);
  });

  it("blocks non-recipients from responding", async () => {
    const pending = mkTransfer();
    vi.spyOn(OwnershipTransfer, "findById").mockReturnValueOnce(Promise.resolve(pending) as any);
    const mockRes = res();
    await RespondOwnershipTransfer(
      req({
        params: { transferId: pending._id.toString() },
        body: { walletAddress: FROM, decision: "approved", signature: "sig" },
      }) as Request,
      mockRes as Response,
    );
    expect(mockRes.status).toHaveBeenCalledWith(403);
  });

  it("returns 410 for an expired request", async () => {
    const expired = mkTransfer({ expiresAt: new Date(Date.now() - 1000) });
    vi.spyOn(OwnershipTransfer, "findById").mockReturnValueOnce(Promise.resolve(expired) as any);
    vi.spyOn(OwnershipTransfer, "updateOne").mockResolvedValue({ modifiedCount: 1 } as any);
    const mockRes = res();
    await RespondOwnershipTransfer(
      req({
        params: { transferId: expired._id.toString() },
        body: { walletAddress: TO, decision: "approved", signature: "sig" },
      }) as Request,
      mockRes as Response,
    );
    expect(mockRes.status).toHaveBeenCalledWith(410);
  });

  it("rolls approval back to pending when the prompt owner update fails", async () => {
    const pending = mkTransfer();
    vi.spyOn(OwnershipTransfer, "findById").mockReturnValueOnce(Promise.resolve(pending) as any);
    vi.spyOn(OwnershipTransfer, "updateOne").mockResolvedValue({ modifiedCount: 1 } as any);
    const recipientId = objectId();
    vi.spyOn(User, "findOne").mockResolvedValue({ _id: recipientId });
    vi.spyOn(Prompt, "findOneAndUpdate").mockImplementationOnce(() => {
      throw new Error("db unavailable");
    });

    const mockRes = res();
    await RespondOwnershipTransfer(
      req({
        params: { transferId: pending._id.toString() },
        body: { walletAddress: TO, decision: "approved", signature: "sig" },
      }) as Request,
      mockRes as Response,
    );
    expect(mockRes.status).toHaveBeenCalledWith(500);
    // The approval claim was released back to pending so the recipient can retry (#1034).
    expect(OwnershipTransfer.updateOne).toHaveBeenCalledTimes(2);
    expect(OwnershipTransfer.updateOne).toHaveBeenLastCalledWith(
      { _id: pending._id, status: "approved" },
      { $set: { status: "pending", decidedAt: null, decidedBy: null } },
    );
  });

  it("lets the recipient retry after a transient failure (#1034)", async () => {
    const pending = mkTransfer();
    const approved = { ...pending, status: "approved", decidedBy: TO.toLowerCase(), decidedAt: new Date() };
    vi.spyOn(OwnershipTransfer, "findById")
      .mockImplementationOnce(() => Promise.resolve(pending) as any)
      .mockImplementationOnce(() => Promise.resolve(pending) as any)
      .mockImplementationOnce(() => chain(approved) as any);
    vi.spyOn(OwnershipTransfer, "updateOne").mockResolvedValue({ modifiedCount: 1 } as any);
    vi.spyOn(User, "findOne").mockResolvedValue({ _id: objectId() });
    vi.spyOn(Prompt, "findOneAndUpdate")
      .mockImplementationOnce(() => {
        throw new Error("db unavailable");
      })
      .mockImplementationOnce(() => chain({ _id: objectId() }) as any);

    const attempt = async () => {
      const mockRes = res();
      await RespondOwnershipTransfer(
        req({
          params: { transferId: pending._id.toString() },
          body: { walletAddress: TO, decision: "approved" },
        }) as Request,
        mockRes as Response,
      );
      return mockRes;
    };

    expect((await attempt()).status).toHaveBeenCalledWith(500);
    const retried = await attempt();
    expect(retried.status).not.toHaveBeenCalled();
    expect(retried.json).toHaveBeenCalledWith(expect.objectContaining({ status: "approved" }));
  });

  it("records a rejection", async () => {
    const pending = mkTransfer();
    const rejected = {
      ...pending,
      status: "rejected",
      decidedBy: TO.toLowerCase(),
      decidedAt: new Date(),
    };
    vi.spyOn(OwnershipTransfer, "findById")
      .mockImplementationOnce(() => Promise.resolve(pending) as any)
      .mockImplementationOnce(() => chain(rejected) as any);
    vi.spyOn(OwnershipTransfer, "updateOne").mockResolvedValue({ modifiedCount: 1 } as any);

    const mockRes = res();
    await RespondOwnershipTransfer(
      req({
        params: { transferId: pending._id.toString() },
        body: { walletAddress: TO, decision: "rejected", signature: "sig" },
      }) as Request,
      mockRes as Response,
    );
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ status: "rejected" }),
    );
  });
});

describe("CancelOwnershipTransfer (#708)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.restoreAllMocks();
  });

  it("cancels a pending request made by the caller", async () => {
    const pending = mkTransfer();
    const cancelled = {
      ...pending,
      status: "cancelled",
      decidedBy: FROM.toLowerCase(),
      decidedAt: new Date(),
    };
    vi.spyOn(OwnershipTransfer, "updateOne").mockResolvedValue({ modifiedCount: 1 } as any);
    vi.spyOn(OwnershipTransfer, "findById").mockImplementationOnce(
      () => chain(cancelled) as any,
    );
    const mockRes = res();
    await CancelOwnershipTransfer(
      req({
        params: { transferId: pending._id.toString() },
        body: { walletAddress: FROM, signature: "sig" },
      }) as Request,
      mockRes as Response,
    );
    expect(mockRes.json).toHaveBeenCalledWith(expect.objectContaining({ status: "cancelled" }));
  });

  it("rejects cancellation when nothing could be claimed", async () => {
    const pending = mkTransfer();
    vi.spyOn(OwnershipTransfer, "updateOne").mockResolvedValue({ modifiedCount: 0 } as any);
    const mockRes = res();
    await CancelOwnershipTransfer(
      req({
        params: { transferId: pending._id.toString() },
        body: { walletAddress: TO, signature: "sig" },
      }) as Request,
      mockRes as Response,
    );
    expect(mockRes.status).toHaveBeenCalledWith(409);
  });
});
describe("ownership transfer route authorization (#1034)", () => {
  process.env.CHALLENGE_TOKEN_SECRET = "ownership-transfer-test-challenge-secret";

  async function sessionFor(keypair: Keypair): Promise<string> {
    const secret = walletSessionSecret()!;
    const challenge = issueWalletChallenge(secret, keypair.publicKey());
    const signed = Buffer.from(
      keypair.sign(Buffer.from(challenge.challenge, "utf8")),
    ).toString("base64");
    const session = await createWalletSession(secret, keypair.publicKey(), challenge.token, signed);
    return session!.sessionToken;
  }

  /** First handler mounted on a transfer mutation route: the session gate. */
  function gateFor(path: string) {
    const layer = (promptRouter as any).stack.find(
      (l: any) => l.route?.path === path && l.route.methods.post,
    );
    return layer.route.stack[0].handle;
  }

  function runGate(path: string, body: Record<string, unknown>, authorization?: string) {
    const gateReq: any = { body, params: {}, headers: authorization ? { authorization } : {} };
    const gateRes: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
    const next = vi.fn();
    gateFor(path)(gateReq, gateRes, next);
    return { gateReq, gateRes, next };
  }

  const MUTATIONS = [
    "/transfers/request",
    "/transfers/:transferId/respond",
    "/transfers/:transferId/cancel",
  ];

  it.each(MUTATIONS)("%s rejects a request without a wallet session", (path) => {
    const wallet = Keypair.random().publicKey();
    const { gateRes, next } = runGate(path, { fromWallet: wallet, walletAddress: wallet });
    expect(gateRes.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("rejects a session that belongs to a different wallet than the actor", async () => {
    const owner = Keypair.random();
    const attacker = Keypair.random();
    const token = await sessionFor(attacker);

    const { gateRes, next } = runGate(
      "/transfers/request",
      { fromWallet: owner.publicKey(), toWallet: attacker.publicKey(), promptId: "101" },
      `Bearer ${token}`,
    );
    expect(gateRes.status).toHaveBeenCalledWith(401);
    expect(next).not.toHaveBeenCalled();
  });

  it("admits the acting wallet's own session", async () => {
    const recipient = Keypair.random();
    const token = await sessionFor(recipient);

    const { gateReq, next } = runGate(
      "/transfers/:transferId/respond",
      { walletAddress: recipient.publicKey().toLowerCase(), decision: "approved" },
      `Bearer ${token}`,
    );
    expect(next).toHaveBeenCalledOnce();
    expect(gateReq.sessionWallet).toBe(recipient.publicKey());
  });
});
