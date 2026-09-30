import { describe, expect, it } from "vitest";
import { rankPublicPrompts } from "./searchRanking";
describe("public prompt ranking", () => { it("filters unsafe records and provides deterministic tie breaks", () => { expect(rankPublicPrompts([{ id: "b", relevance: 1, quality: 1, trust: 1, freshness: 1 }, { id: "a", relevance: 1, quality: 1, trust: 1, freshness: 1 }, { id: "x", relevance: 9, quality: 9, trust: 9, freshness: 9, flagged: true }]).map(x => x.id)).toEqual(["a", "b"]); }); });
