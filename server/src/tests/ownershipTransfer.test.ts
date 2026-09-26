import { describe, it, expect, beforeEach, vi } from "vitest";
import mongoose from "mongoose";
import { Request, Response } from "express";
import Prompt from "../models/Prompt";
import User from "../models/User";
import OwnershipTransfer from "../models/OwnershipTransfer";
import {
  RequestOwnershipTransfer,
  GetOwnershipTransfers,
  RespondOwnershipTransfer,
  CancelOwnershipTransfer,
} from "../controllers/transferControllers";

vi.mock("../db/connectDb", () => ({
  default: vi.fn(),
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
  });

  it("rejects requests without all fields or a signature", async () => {
    const mockRes = res();
    await RequestOwnershipTransfer(req({ body: {} }) as Request, mockRes as Response);
    expect(mockRes.status).toHaveBeenCalledWith(400);

    const mockRes2 = res();
    await RequestOwnershipTransfer(
      req({
        body: { promptId: "101", fromWallet: FROM, toWallet: TO },
      }) as Request,
      mockRes2 as Response,
    );
    expect(mockRes2.status).toHaveBeenCalledWith(401);
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

  it("returns 409 when a pending request already exists", async () => {
    vi.spyOn(Prompt, "findOne").mockReturnValue(chain({ owner: { walletAddress: FROM.toLowerCase() } }) as any);
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
      { status: "pending", expiresAt: { $lte: expect.any(Date) } },
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
    const recipientId = objectId();
    vi.spyOn(User, "findOne").mockResolvedValue({ _id: recipientId });
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

    expect(Prompt.findOneAndUpdate).toHaveBeenCalledWith(
      { onChainId: pending.promptId },
      { $set: { owner: recipientId } },
      { new: true },
    );
    expect(mockRes.json).toHaveBeenCalledWith(
      expect.objectContaining({ promptId: "101", status: "approved" }),
    );
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

  it("rolls approval back to rejected when the prompt owner update fails", async () => {
    const pending = mkTransfer();
    vi.spyOn(OwnershipTransfer, "findById").mockReturnValueOnce(Promise.resolve(pending) as any);
    vi.spyOn(OwnershipTransfer, "updateOne").mockResolvedValue({ modifiedCount: 1 } as any);
    const recipientId = objectId();
    vi.spyOn(User, "findOne").mockResolvedValue({ _id: recipientId });
    vi.spyOn(Prompt, "findOneAndUpdate").mockRejectedValue(new Error("db unavailable"));

    const mockRes = res();
    await RespondOwnershipTransfer(
      req({
        params: { transferId: pending._id.toString() },
        body: { walletAddress: TO, decision: "approved", signature: "sig" },
      }) as Request,
      mockRes as Response,
    );
    expect(mockRes.status).toHaveBeenCalledWith(500);
    // The approval claim was rolled back to rejected.
    expect(OwnershipTransfer.updateOne).toHaveBeenCalledTimes(2);
    expect(OwnershipTransfer.updateOne).toHaveBeenLastCalledWith(
      { _id: pending._id, status: "approved" },
      expect.objectContaining({ $set: expect.objectContaining({ status: "rejected" }) }),
    );
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