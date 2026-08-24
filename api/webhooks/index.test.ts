// @vitest-environment node

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";
// Mock the DB connection so the handler never touches Mongo.
vi.mock("../../server/src/db/connectDb", () => ({
  default: vi.fn().mockResolvedValue(undefined),
}));

// Mock the subscription model with an in-memory-ish fake. State is created via
// vi.hoisted so it is available to the hoisted vi.mock factory below.
const hoisted = vi.hoisted(() => {
  const fakeSub = {
    _id: "sub-1",
    walletAddress: "",
    url: "https://old.example.com/hook",
    events: ["PromptPurchased"],
    active: true,
    failureCount: 0,
    toObject() {
      return {
        _id: this._id,
        walletAddress: this.walletAddress,
        url: this.url,
        events: this.events,
        active: this.active,
        failureCount: this.failureCount,
      };
    },
    save: vi.fn().mockResolvedValue(undefined),
  };

  const findOneMock = vi.fn().mockReturnValue({ select: () => fakeSub });
  const deleteOneMock = vi.fn();

  const SubMock = vi.fn().mockImplementation(function (this: any, data: any) {
    Object.assign(this, data);
    this.save = vi.fn().mockResolvedValue(undefined);
    this.toObject = function () {
      return { ...this };
    };
  });
  SubMock.findOne = findOneMock;
  SubMock.deleteOne = deleteOneMock;

  return { fakeSub, findOneMock, deleteOneMock, SubMock };
});

vi.mock("../../server/src/models/WebhookSubscription", () => ({
  default: hoisted.SubMock,
}));

const { fakeSub, findOneMock, deleteOneMock } = hoisted;

// Partially mock the auth challenge module: keep the real verification and
// token-building primitives, but control the nonce ledger so we can simulate
// replay (consume => false).
vi.mock("../../src/lib/auth/challenge", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    globalNonceLedger: {
      consume: vi.fn().mockResolvedValue(true),
    },
  };
});

import { webhookHandler } from "./index";
import {
  createChallengeToken,
  buildChallengeMessage,
} from "../../src/lib/auth/challenge";
import SubModel from "../../server/src/models/WebhookSubscription";

const SECRET = "test-webhook-secret";

function makeRes() {
  const res: any = {
    statusCode: 0,
    headers: {} as Record<string, string>,
    body: undefined as any,
  };
  res.status = (code: number) => {
    res.statusCode = code;
    return res;
  };
  res.json = (body: any) => {
    res.body = body;
    return res;
  };
  res.setHeader = (k: string, v: string) => {
    res.headers[k] = v;
  };
  return res;
}

function signedProof(keypair: Keypair, promptId = "webhook-registration") {
  const challenge = createChallengeToken(SECRET, keypair.publicKey(), promptId, Date.now());
  const message = buildChallengeMessage({
    address: keypair.publicKey(),
    promptId,
    nonce: challenge.nonce,
    issuedAt: challenge.issuedAt,
    expiresAt: challenge.expiresAt,
  });
  const signedMessage = Buffer.from(
    keypair.sign(Buffer.from(message, "utf8")),
  ).toString("base64");
  return { token: challenge.token, signedMessage };
}

describe("api/webhooks ownership verification", () => {
  const creator = Keypair.random();
  const attacker = Keypair.random();

  beforeEach(() => {
    process.env.CHALLENGE_TOKEN_SECRET = SECRET;
    // Default GET behavior: findOne resolves to the existing subscription.
    findOneMock.mockReset().mockResolvedValue(fakeSub);
    deleteOneMock.mockReset().mockResolvedValue({ deletedCount: 1 });
    fakeSub.walletAddress = creator.publicKey().toLowerCase();
    fakeSub.url = "https://old.example.com/hook";
  });

  afterEach(() => {
    delete process.env.CHALLENGE_TOKEN_SECRET;
  });

  it("rejects an unsigned (unauthenticated) POST with 400", async () => {
    const res = makeRes();
    await webhookHandler(
      {
        method: "POST",
        body: { walletAddress: creator.publicKey(), url: "https://attacker.com/hook" },
      },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("MISSING_FIELDS");
  });

  it("rejects a POST with a valid signature for a DIFFERENT address (401)", async () => {
    // Attacker signs a challenge bound to their own address, but tries to
    // register a webhook for the victim's wallet.
    const proof = signedProof(attacker);
    const res = makeRes();
    await webhookHandler(
      {
        method: "POST",
        body: {
          walletAddress: creator.publicKey(),
          url: "https://attacker.com/hook",
          token: proof.token,
          signedMessage: proof.signedMessage,
        },
      },
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("INVALID_SIGNATURE");
  });

  it("accepts a POST with a valid signature for the SAME address", async () => {
    findOneMock.mockResolvedValue(null);
    const proof = signedProof(creator);
    const res = makeRes();
    await webhookHandler(
      {
        method: "POST",
        body: {
          walletAddress: creator.publicKey(),
          url: "https://creator.com/hook",
          token: proof.token,
          signedMessage: proof.signedMessage,
        },
      },
      res,
    );
    expect(res.statusCode).toBe(201);
    expect(res.body.secret).toBeDefined();
  });

  it("rejects a POST whose signed challenge was already consumed (replay)", async () => {
    const { globalNonceLedger } = await import("../../src/lib/auth/challenge");
    (globalNonceLedger.consume as any).mockResolvedValueOnce(false);

    const proof = signedProof(creator);
    const res = makeRes();
    await webhookHandler(
      {
        method: "POST",
        body: {
          walletAddress: creator.publicKey(),
          url: "https://creator.com/hook",
          token: proof.token,
          signedMessage: proof.signedMessage,
        },
      },
      res,
    );
    expect(res.statusCode).toBe(401);
    expect(res.body.code).toBe("INVALID_SIGNATURE");
  });

  it("hides the delivery url from an unauthenticated GET caller", async () => {
    findOneMock.mockResolvedValue(fakeSub);
    const res = makeRes();
    await webhookHandler(
      { method: "GET", query: { walletAddress: creator.publicKey() } },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBeUndefined();
    expect(res.body.events).toEqual(["PromptPurchased"]);
  });

  it("returns the delivery url to an authenticated GET caller", async () => {
    findOneMock.mockResolvedValue(fakeSub);
    const proof = signedProof(creator);
    const res = makeRes();
    await webhookHandler(
      {
        method: "GET",
        query: {
          walletAddress: creator.publicKey(),
          token: proof.token,
          signedMessage: proof.signedMessage,
        },
      },
      res,
    );
    expect(res.statusCode).toBe(200);
    expect(res.body.url).toBe("https://old.example.com/hook");
  });

  it("rejects an unauthenticated DELETE with 400", async () => {
    const res = makeRes();
    await webhookHandler(
      { method: "DELETE", body: { walletAddress: creator.publicKey() } },
      res,
    );
    expect(res.statusCode).toBe(400);
    expect(res.body.code).toBe("MISSING_FIELDS");
    expect(deleteOneMock).not.toHaveBeenCalled();
  });
});
