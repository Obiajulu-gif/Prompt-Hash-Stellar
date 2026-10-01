import { beforeEach, describe, expect, it, vi } from "vitest";

const findOne = vi.fn();
const create = vi.fn();
const find = vi.fn();
const recordAuditEvent = vi.fn().mockResolvedValue(undefined);

vi.mock("../models/ExternalIdentityLink", () => ({
  default: { findOne, create, find },
}));
vi.mock("./auditTrail", () => ({ recordAuditEvent }));

import {
  ExternalIdentityError,
  normalizeProvider,
  normalizeSubject,
  linkExternalIdentity,
  unlinkExternalIdentity,
} from "./externalIdentityService";

describe("external identity links (#921)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("normalizes providers and rejects unsafe subjects", () => {
    expect(normalizeProvider(" GitHub ")).toBe("github");
    expect(normalizeProvider("bad provider")).toBeNull();
    expect(normalizeSubject("account-42")).toBe("account-42");
    expect(normalizeSubject("bad\nsubject")).toBeNull();
  });

  it("blocks duplicate active links", async () => {
    findOne.mockReturnValueOnce({ lean: () => Promise.resolve({ _id: "existing" }) });
    await expect(linkExternalIdentity({
      walletAddress: "GOWNER",
      provider: "github",
      subject: "octocat",
      challenge: "challenge",
      signature: "signature",
    })).rejects.toMatchObject(new ExternalIdentityError(409, "This external identity is already linked."));
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ result: "blocked" }));
    expect(create).not.toHaveBeenCalled();
  });

  it("creates a verified link and stores only a digest of the proof", async () => {
    findOne.mockReturnValueOnce({ lean: () => Promise.resolve(null) });
    findOne.mockReturnValueOnce({ lean: () => Promise.resolve(null) });
    const created = { provider: "github", subject: "octocat", status: "active", verificationMethod: "wallet_signature" };
    create.mockResolvedValue(created);
    const result = await linkExternalIdentity({
      walletAddress: "GOWNER",
      provider: "github",
      subject: "octocat",
      challenge: "challenge",
      signature: "signature",
    });
    expect(result).toBe(created);
    expect(create.mock.calls[0][0].verificationHash).toMatch(/^[a-f0-9]{64}$/);
    expect(create.mock.calls[0][0]).not.toHaveProperty("signature");
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ result: "success" }));
  });

  it("unlinks only an active identity owned by the wallet", async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const current = { status: "active", save };
    findOne.mockResolvedValue(current);
    await unlinkExternalIdentity({ walletAddress: "GOWNER", provider: "github", subject: "octocat" });
    expect(current.status).toBe("unlinked");
    expect(save).toHaveBeenCalledOnce();
  });

  it("rejects an unauthorized or already-unlinked identity", async () => {
    findOne.mockResolvedValue(null);
    await expect(unlinkExternalIdentity({ walletAddress: "GOTHER", provider: "github", subject: "octocat" }))
      .rejects.toMatchObject({ status: 404 });
    expect(recordAuditEvent).toHaveBeenCalledWith(expect.objectContaining({ action: "identity_unlink", result: "blocked" }));
  });
});
