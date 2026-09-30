import { describe, it, expect, vi, beforeEach } from "vitest";

/** Minimal in-memory Mongo-style collections for Prompt and PromptRelation. */
const store = vi.hoisted(() => {
  const clone = (value: any) => (value === undefined ? value : structuredClone(value));

  function matchValue(value: any, cond: any): boolean {
    if (cond && typeof cond === "object" && !(cond instanceof Date)) {
      if ("$in" in cond) return cond.$in.includes(value);
      if ("$ne" in cond) return cond.$ne === null ? value != null : value !== cond.$ne;
    }
    return value === cond;
  }

  function matches(doc: any, filter: any): boolean {
    return Object.entries(filter).every(([key, cond]: [string, any]) =>
      key === "$or" ? cond.some((sub: any) => matches(doc, sub)) : matchValue(doc[key], cond),
    );
  }

  function makeModel(docs: any[], populateOwner = false) {
    const query = (result: () => any) => {
      let populate = false;
      const chain: any = {
        select: () => chain,
        sort: () => chain,
        limit: () => chain,
        populate: () => {
          populate = populateOwner;
          return chain;
        },
        lean: () => chain,
        exec: async () => {
          const value = clone(result());
          const withOwner = (doc: any) =>
            doc && populate ? { ...doc, owner: { walletAddress: doc.ownerWallet } } : doc;
          return Array.isArray(value) ? value.map(withOwner) : withOwner(value);
        },
        then: (resolve: any, reject: any) => chain.exec().then(resolve, reject),
      };
      return chain;
    };

    return {
      docs,
      find: (filter: any = {}) => query(() => docs.filter((d) => matches(d, filter))),
      findOne: (filter: any) => query(() => docs.find((d) => matches(d, filter)) ?? null),
      exists: async (filter: any) => (docs.some((d) => matches(d, filter)) ? { _id: "x" } : null),
      findOneAndUpdate: (filter: any, update: any, options: any) =>
        query(() => {
          let doc = docs.find((d) => matches(d, filter));
          if (!doc && options?.upsert) {
            doc = { _id: `rel-${docs.length + 1}`, ...filter, origin: "creator", createdAt: new Date() };
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

  const prompts: any[] = [];
  const relations: any[] = [];
  return {
    prompts,
    relations,
    matches,
    Prompt: makeModel(prompts, true),
    PromptRelation: makeModel(relations),
  };
});

vi.mock("../models/Prompt", () => ({ default: store.Prompt }));
vi.mock("../models/PromptRelation", () => ({
  default: store.PromptRelation,
  PROVENANCE_KINDS: ["parent", "fork", "remix", "source"],
}));

import {
  assertNoCycle,
  backfillProvenanceFromSimilarity,
  declareRelation,
  getLineage,
  getProvenanceFlags,
  MAX_LINEAGE_DEPTH,
  walkAncestors,
} from "../services/provenance";

const CREATOR = "GCREATOR";
const OTHER = "GOTHER";

function prompt(onChainId: string, extra: Record<string, unknown> = {}) {
  store.prompts.push({
    onChainId,
    title: `Prompt ${onChainId}`,
    isActive: true,
    listingStatus: "published",
    owner: "owner-creator",
    ownerWallet: CREATOR.toLowerCase(),
    ...extra,
  });
}

function relation(promptId: string, relatedPromptId: string, kind = "remix", origin = "creator") {
  store.relations.push({ promptId, relatedPromptId, kind, origin });
}

beforeEach(() => {
  store.prompts.length = 0;
  store.relations.length = 0;
});

describe("provenance cycle prevention (#753)", () => {
  it("refuses self-references and edges that would close a cycle", async () => {
    relation("2", "1");
    relation("3", "2");

    await expect(assertNoCycle("4", "4")).rejects.toMatchObject({ status: 409 });
    await expect(assertNoCycle("1", "3")).rejects.toThrow("provenance cycle");
    await expect(assertNoCycle("4", "3")).resolves.toBeUndefined();
  });

  it("refuses a lineage too deep to verify instead of assuming it is acyclic", async () => {
    const deepLoader = async (ids: string[]) =>
      ids.map((id) => ({
        promptId: id,
        relatedPromptId: String(Number(id) + 1),
        kind: "fork" as const,
        origin: "creator" as const,
      }));

    const walk = await walkAncestors("1", deepLoader);
    expect(walk.truncated).toBe(true);
    expect(walk.edges).toHaveLength(MAX_LINEAGE_DEPTH);
    await expect(assertNoCycle("0", "1", deepLoader)).rejects.toThrow("too deep");
  });
});

describe("declaring provenance (#753)", () => {
  beforeEach(() => {
    prompt("1");
    prompt("2");
    prompt("3", { owner: "owner-other", ownerWallet: OTHER.toLowerCase() });
  });

  it("lets the listing's creator record a relationship", async () => {
    const saved = await declareRelation({ promptId: "2", relatedPromptId: "1", kind: "remix", wallet: CREATOR });

    expect(saved).toMatchObject({ promptId: "2", relatedPromptId: "1", kind: "remix", origin: "creator" });
    expect(store.relations).toHaveLength(1);
  });

  it("rejects declarations from anyone but the creator", async () => {
    await expect(
      declareRelation({ promptId: "2", relatedPromptId: "1", kind: "remix", wallet: OTHER }),
    ).rejects.toMatchObject({ status: 403 });
    expect(store.relations).toHaveLength(0);
  });

  it("rejects a declaration that would create a cycle and stores nothing", async () => {
    relation("1", "2");

    await expect(
      declareRelation({ promptId: "2", relatedPromptId: "1", kind: "fork", wallet: CREATOR }),
    ).rejects.toMatchObject({ status: 409 });
    expect(store.relations).toHaveLength(1);
  });

  it("allows only one parent listing", async () => {
    relation("2", "3", "parent");
    await expect(
      declareRelation({ promptId: "2", relatedPromptId: "1", kind: "parent", wallet: CREATOR }),
    ).rejects.toThrow("already has a parent");
  });

  it("confirms a backfilled relation when the creator declares it", async () => {
    relation("2", "1", "source", "backfill");

    await declareRelation({ promptId: "2", relatedPromptId: "1", kind: "fork", wallet: CREATOR });

    expect(store.relations).toEqual([
      expect.objectContaining({ kind: "fork", origin: "creator", declaredBy: CREATOR.toLowerCase() }),
    ]);
  });
});

describe("rendering lineage (#753)", () => {
  it("keeps lineage intact through a deleted parent", async () => {
    prompt("1");
    prompt("3");
    relation("3", "2", "remix");
    relation("2", "1", "source");

    const lineage = await getLineage("3");

    expect(lineage.ancestors).toEqual([
      expect.objectContaining({ promptId: "2", depth: 1, visibility: "deleted", title: null, link: null }),
      expect.objectContaining({
        promptId: "1",
        derivedPromptId: "2",
        depth: 2,
        visibility: "public",
        link: "/prompts/1",
      }),
    ]);
  });

  it("never exposes titles or links for hidden or private listings", async () => {
    prompt("1");
    prompt("5", { moderationStatus: "retired", title: "Retired secret" });
    prompt("6", { isActive: false, title: "Unlisted secret" });
    relation("5", "1");
    relation("6", "1");

    const lineage = await getLineage("1");

    expect(lineage.derivatives.map((d) => [d.promptId, d.visibility])).toEqual([
      ["5", "hidden"],
      ["6", "private"],
    ]);
    expect(JSON.stringify(lineage)).not.toContain("secret");
  });

  it("orders relationships deterministically", async () => {
    prompt("1");
    relation("10", "1", "remix");
    relation("9", "1", "remix");
    relation("12", "1", "source");
    relation("11", "1", "fork");

    const lineage = await getLineage("1");

    expect(lineage.derivatives.map((d) => d.promptId)).toEqual(["12", "11", "9", "10"]);
  });
});

describe("provenance moderation flags (#753)", () => {
  it("flags attribution conflicts, undeclared copies, and deep fork chains", async () => {
    prompt("1", { owner: "owner-a" });
    prompt("2", { owner: "owner-b" });
    prompt("3", { owner: "owner-c" });
    prompt("4", { owner: "owner-d" });
    prompt("7", { owner: "owner-a", similarityFlag: "highly_similar", similarTo: "1" });
    prompt("8", { owner: "owner-b" });
    relation("2", "1", "fork");
    relation("3", "2", "fork");
    relation("4", "3", "remix");
    relation("8", "1", "parent");
    relation("9", "1", "source", "backfill");

    const flags = await getProvenanceFlags();

    expect(flags.map((flag) => [flag.type, flag.promptId])).toEqual([
      ["cross_creator_parent", "8"],
      ["deep_fork_chain", "4"],
      ["undeclared_similarity", "7"],
      ["unconfirmed_attribution", "9"],
    ]);
    expect(flags[1].relatedPromptIds).toEqual(["1", "2", "3"]);
  });
});

describe("backfilling legacy prompt records (#753)", () => {
  function fakeDb(legacyPrompts: any[], existingRelations: any[] = []) {
    const relations = [...existingRelations];
    const db: any = {
      collection: (name: string) =>
        name === "prompts"
          ? {
              find: (filter: any) => ({
                sort: () => legacyPrompts.filter((p) => store.matches(p, filter)),
              }),
              findOne: async (filter: any) =>
                legacyPrompts.find((p) => store.matches(p, filter)) ?? null,
            }
          : {
              createIndex: vi.fn(),
              find: (filter: any) => ({
                project: () => ({
                  toArray: async () => relations.filter((r) => store.matches(r, filter)),
                }),
              }),
              updateOne: async (filter: any, update: any) => {
                if (relations.some((r) => store.matches(r, filter))) return { upsertedCount: 0 };
                relations.push({ ...update.$setOnInsert });
                return { upsertedCount: 1 };
              },
            },
    };
    return { db, relations };
  }

  const older = new Date("2026-01-01T00:00:00.000Z");
  const newer = new Date("2026-02-01T00:00:00.000Z");

  it("migrates similarity links into unconfirmed source relations, skipping unsafe ones", async () => {
    const { db, relations } = fakeDb(
      [
        // Legacy document with a numeric on-chain id.
        { onChainId: 10, similarityFlag: "clean", similarTo: null, createdAt: older },
        { onChainId: 12, similarityFlag: "highly_similar", similarTo: "10", createdAt: newer },
        // Self-reference.
        { onChainId: "13", similarityFlag: "highly_similar", similarTo: "13", createdAt: newer },
        // "Source" is newer than the copy.
        { onChainId: "14", similarityFlag: "highly_similar", similarTo: "15", createdAt: older },
        { onChainId: "15", similarityFlag: "clean", similarTo: null, createdAt: newer },
        // Source no longer exists.
        { onChainId: "16", similarityFlag: "highly_similar", similarTo: "404", createdAt: newer },
        // Would close a cycle with an existing creator-declared relation.
        { onChainId: "20", similarityFlag: "clean", similarTo: null, createdAt: older },
        { onChainId: "21", similarityFlag: "highly_similar", similarTo: "20", createdAt: newer },
      ],
      [{ promptId: "20", relatedPromptId: "21", kind: "remix", origin: "creator" }],
    );

    const first = await backfillProvenanceFromSimilarity(db);

    expect(first).toEqual({ created: 1, skipped: 4 });
    expect(relations).toContainEqual(
      expect.objectContaining({ promptId: "12", relatedPromptId: "10", kind: "source", origin: "backfill" }),
    );

    // Idempotent: a second run creates nothing new.
    expect(await backfillProvenanceFromSimilarity(db)).toEqual({ created: 0, skipped: 5 });
  });
});
