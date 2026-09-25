import { describe, expect, it } from "vitest";
import { planPromptImport } from "./promptImport";
const valid = { externalId: "catalog-1", creatorWallet: "GCREATOR", title: "A valid prompt", category: "Programming", image: "https://example.com/p.png", price: 1, payloadRef: "opaque-ref" } as const;
describe("prompt import planning", () => {
  it("reports invalid rows and duplicate rows without exposing payloads", () => { const r = planPromptImport([valid, { ...valid }, { ...valid, externalId: "bad", category: "Nope" }]); expect(r.created).toHaveLength(1); expect(r.invalid).toHaveLength(2); expect(JSON.stringify(r)).not.toContain("opaque-ref"); });
  it("is idempotent and protects creator ownership", () => { const r = planPromptImport([valid], [{ externalId: "catalog-1", creatorWallet: "GCREATOR" }]); expect(r.updated).toHaveLength(1); expect(planPromptImport([valid], [{ externalId: "catalog-1", creatorWallet: "GOTHER" }]).invalid[0].errors[0]).toMatch(/ownership/); });
});
