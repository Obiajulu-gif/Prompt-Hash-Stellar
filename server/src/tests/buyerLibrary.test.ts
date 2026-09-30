import { describe, it, expect, vi, beforeEach } from "vitest";
import { Keypair } from "@stellar/stellar-sdk";

/** Minimal in-memory Mongo-style models for the library's collections. */
const db = vi.hoisted(() => {
  const clone = (value: any) => (value === undefined ? value : structuredClone(value));

  function matchValue(value: any, cond: any): boolean {
    if (cond && typeof cond === "object" && "$in" in cond) return cond.$in.includes(value);
    return value === cond;
  }
  const matches = (doc: any, filter: any) =>
    Object.entries(filter).every(([key, cond]) => matchValue(doc[key], cond));

  const withSave = (doc: any) =>
    Object.defineProperty(doc, "save", { value: async () => doc, enumerable: false, configurable: true });

  function makeModel(docs: any[], uniqueKey?: (doc: any) => string) {
    const query = (result: () => any) => {
      let lean = false;
      let order: [string, number] | null = null;
      const chain: any = {
        select: () => chain,
        sort: (spec: Record<string, number>) => {
          order = Object.entries(spec)[0] ?? null;
          return chain;
        },
        limit: () => chain,
        lean: () => {
          lean = true;
          return chain;
        },
        then: (resolve: any, reject: any) =>
          Promise.resolve()
            .then(() => {
              let value = result();
              if (order && Array.isArray(value)) {
                const [key, direction] = order;
                value = [...value].sort((a, b) => (a[key] > b[key] ? 1 : a[key] < b[key] ? -1 : 0) * direction);
              }
              if (lean) return clone(value);
              return value && !Array.isArray(value) ? withSave(value) : value;
            })
            .then(resolve, reject),
      };
      return chain;
    };

    let nextId = 1;
    return {
      docs,
      find: (filter: any = {}) => query(() => docs.filter((d) => matches(d, filter))),
      findOne: (filter: any) => query(() => docs.find((d) => matches(d, filter)) ?? null),
      countDocuments: async (filter: any) => docs.filter((d) => matches(d, filter)).length,
      create: async (input: any) => {
        if (uniqueKey && docs.some((d) => uniqueKey(d) === uniqueKey(input))) {
          throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
        }
        // 24 hex characters, like an ObjectId.
        const doc = { _id: String(nextId++).padStart(24, "0"), ...input, updatedAt: new Date() };
        docs.push(doc);
        return doc;
      },
      findOneAndUpdate: (filter: any, update: any, options: any) =>
        query(() => {
          let doc = docs.find((d) => matches(d, filter));
          if (!doc && options?.upsert) {
            doc = { _id: `doc-${nextId++}`, ...filter };
            docs.push(doc);
          }
          if (doc) Object.assign(doc, update.$set ?? {});
          return doc ?? null;
        }),
      deleteOne: async (filter: any) => {
        const index = docs.findIndex((d) => matches(d, filter));
        if (index >= 0) docs.splice(index, 1);
        return { deletedCount: index >= 0 ? 1 : 0 };
      },
    };
  }

  return {
    Purchase: makeModel([]),
    Prompt: makeModel([]),
    FulfillmentRecord: makeModel([]),
    LibraryItem: makeModel([]),
    LibraryCollection: makeModel([], (d) => `${d.buyerWallet}|${d.name}`),
  };
});

vi.mock("../models/Purchase", () => ({ default: db.Purchase }));
vi.mock("../models/Prompt", () => ({ default: db.Prompt }));
vi.mock("../models/FulfillmentRecord", () => ({ default: db.FulfillmentRecord }));
vi.mock("../models/LibraryItem", () => ({ default: db.LibraryItem }));
vi.mock("../models/LibraryCollection", () => ({
  default: db.LibraryCollection,
  MAX_COLLECTIONS_PER_BUYER: 50,
}));

import {
  createWalletSession,
  issueWalletChallenge,
  requireWalletSession,
  walletSessionSecret,
} from "../middleware/walletSession";
import {
  createCollection,
  deleteCollection,
  getBuyerLibrary,
  setPromptArchived,
  updateCollection,
} from "../services/buyerLibrary";

process.env.CHALLENGE_TOKEN_SECRET = "buyer-library-test-challenge-secret";

function sign(keypair: Keypair, message: string): string {
  return Buffer.from(keypair.sign(Buffer.from(message, "utf8"))).toString("base64");
}

async function sessionFor(keypair: Keypair): Promise<string> {
  const secret = walletSessionSecret()!;
  const challenge = issueWalletChallenge(secret, keypair.publicKey());
  const session = await createWalletSession(
    secret,
    keypair.publicKey(),
    challenge.token,
    sign(keypair, challenge.challenge),
  );
  return session!.sessionToken;
}

function runMiddleware(walletAddress: string, authorization?: string) {
  const req: any = { params: { walletAddress }, headers: authorization ? { authorization } : {} };
  const res: any = { status: vi.fn().mockReturnThis(), json: vi.fn().mockReturnThis() };
  const next = vi.fn();
  requireWalletSession((r: any) => r.params.walletAddress)(req, res, next);
  return { req, res, next };
}

describe("wallet session permissions (#784)", () => {
  it("issues a session only for a fresh challenge signed by the wallet", async () => {
    const buyer = Keypair.random();
    const other = Keypair.random();
    const secret = walletSessionSecret()!;
    const challenge = issueWalletChallenge(secret, buyer.publicKey());

    expect(
      await createWalletSession(secret, buyer.publicKey(), challenge.token, sign(other, challenge.challenge)),
    ).toBeNull();

    const signed = sign(buyer, challenge.challenge);
    expect(await createWalletSession(secret, buyer.publicKey(), challenge.token, signed)).toEqual({
      sessionToken: expect.any(String),
      expiresAt: expect.any(Number),
    });
    // The challenge nonce is single-use.
    expect(await createWalletSession(secret, buyer.publicKey(), challenge.token, signed)).toBeNull();
  });

  it("admits a request only for the wallet its session was issued to", async () => {
    const buyer = Keypair.random();
    const other = Keypair.random();
    const token = await sessionFor(buyer);

    const own = runMiddleware(buyer.publicKey().toLowerCase(), `Bearer ${token}`);
    expect(own.next).toHaveBeenCalledOnce();
    expect(own.req.sessionWallet).toBe(buyer.publicKey());

    const foreign = runMiddleware(other.publicKey(), `Bearer ${token}`);
    expect(foreign.next).not.toHaveBeenCalled();
    expect(foreign.res.status).toHaveBeenCalledWith(401);

    const anonymous = runMiddleware(buyer.publicKey());
    expect(anonymous.res.status).toHaveBeenCalledWith(401);
  });

  it("does not accept an unsigned challenge token as a session", () => {
    const buyer = Keypair.random();
    const challenge = issueWalletChallenge(walletSessionSecret()!, buyer.publicKey());

    const attempt = runMiddleware(buyer.publicKey(), `Bearer ${challenge.token}`);
    expect(attempt.next).not.toHaveBeenCalled();
    expect(attempt.res.status).toHaveBeenCalledWith(401);
  });
});

const BUYER = "GBUYER";
const OTHER = "GOTHER";

describe("buyer library (#784)", () => {
  beforeEach(() => {
    for (const model of Object.values(db)) model.docs.length = 0;

    const buyer = BUYER.toLowerCase();
    const day = (d: number) => new Date(Date.UTC(2026, 8, d));
    db.Purchase.docs.push(
      { promptId: "1", buyerWallet: buyer, status: "purchased", txHash: "tx1", createdAt: day(5) },
      { promptId: "2", buyerWallet: buyer, status: "resolved", disputeResolution: "refunded", createdAt: day(4) },
      { promptId: "3", buyerWallet: buyer, status: "revoked", createdAt: day(3) },
      { promptId: "4", buyerWallet: buyer, status: "purchased", createdAt: day(2) },
      { promptId: "5", buyerWallet: OTHER.toLowerCase(), status: "purchased", createdAt: day(1) },
    );
    db.FulfillmentRecord.docs.push({ promptId: "4", buyerWallet: buyer, status: "failed" });
    for (const id of ["1", "2", "3", "4", "5"]) {
      db.Prompt.docs.push({
        onChainId: id,
        title: `Prompt ${id}`,
        category: "Writing",
        image: "",
        content: "SECRET PROMPT CONTENT",
      });
    }
  });

  it("lists only the buyer's purchases, with entitlement health and no prompt content", async () => {
    const library = await getBuyerLibrary(BUYER);

    expect(library.entries.map((e) => [e.promptId, e.entitlement.health])).toEqual([
      ["1", "active"],
      ["2", "refunded"],
      ["3", "revoked"],
      ["4", "recovery_needed"],
    ]);
    expect(JSON.stringify(library)).not.toContain("SECRET PROMPT CONTENT");
  });

  it("uses the buyer's latest purchase of a prompt", async () => {
    // An older refunded purchase followed by a re-purchase: the licence is active.
    db.Purchase.docs.push({
      promptId: "1",
      buyerWallet: BUYER.toLowerCase(),
      status: "resolved",
      disputeResolution: "refunded",
      createdAt: new Date("2020-01-01T00:00:00.000Z"),
    });

    const entry = (await getBuyerLibrary(BUYER)).entries.find((e) => e.promptId === "1");
    expect(entry?.entitlement.health).toBe("active");
    expect(entry?.txHash).toBe("tx1");
  });

  it("searches within the buyer's own purchases only", async () => {
    expect((await getBuyerLibrary(BUYER, { q: "prompt 5" })).entries).toEqual([]);
    expect((await getBuyerLibrary(BUYER, { q: "prompt 1" })).entries.map((e) => e.promptId)).toEqual(["1"]);
  });

  it("archives and restores entries without touching purchase records", async () => {
    const purchasesBefore = structuredClone(db.Purchase.docs);

    await setPromptArchived(BUYER, "1", true);
    expect((await getBuyerLibrary(BUYER)).entries.map((e) => e.promptId)).not.toContain("1");
    const archived = await getBuyerLibrary(BUYER, { archived: "only" });
    expect(archived.entries.map((e) => e.promptId)).toEqual(["1"]);
    expect(archived.counts).toEqual({ total: 4, archived: 1 });

    await setPromptArchived(BUYER, "1", false);
    expect((await getBuyerLibrary(BUYER)).entries.map((e) => e.promptId)).toContain("1");
    expect(db.Purchase.docs).toEqual(purchasesBefore);
  });

  it("refuses to archive a prompt bought by someone else", async () => {
    await expect(setPromptArchived(BUYER, "5", true)).rejects.toMatchObject({ status: 404 });
    expect(db.LibraryItem.docs).toHaveLength(0);
  });

  it("only lets a buyer collect prompts they currently own", async () => {
    await expect(createCollection(BUYER, { name: "Theirs", promptIds: ["5"] })).rejects.toMatchObject({ status: 403 });
    await expect(createCollection(BUYER, { name: "Refunded", promptIds: ["2"] })).rejects.toMatchObject({ status: 403 });
    await expect(createCollection(BUYER, { name: "Revoked", promptIds: ["3"] })).rejects.toMatchObject({ status: 403 });

    const favourites = await createCollection(BUYER, { name: "Favourites", promptIds: ["1"] });
    const updated = await updateCollection(BUYER, favourites.id, { addPromptIds: ["4"] });
    expect(updated.promptIds).toEqual(["1", "4"]);

    const filtered = await getBuyerLibrary(BUYER, { collectionId: favourites.id });
    expect(filtered.entries.map((e) => e.promptId)).toEqual(["1", "4"]);
  });

  it("keeps collections private to the buyer that created them", async () => {
    const favourites = await createCollection(BUYER, { name: "Favourites", promptIds: ["1"] });

    await expect(updateCollection(OTHER, favourites.id, { addPromptIds: ["5"] })).rejects.toMatchObject({ status: 404 });
    await expect(getBuyerLibrary(OTHER, { collectionId: favourites.id })).rejects.toMatchObject({ status: 404 });
    await expect(deleteCollection(OTHER, favourites.id)).rejects.toMatchObject({ status: 404 });
    expect((await getBuyerLibrary(OTHER)).collections).toEqual([]);

    await deleteCollection(BUYER, favourites.id);
    expect(db.LibraryCollection.docs).toHaveLength(0);
  });

  it("rejects duplicate collection names", async () => {
    await createCollection(BUYER, { name: "Favourites" });
    await expect(createCollection(BUYER, { name: "Favourites" })).rejects.toMatchObject({ status: 409 });
  });
});
