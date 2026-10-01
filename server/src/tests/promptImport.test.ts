import { describe, expect, it } from "vitest";
import { planPromptImport } from "../services/promptImport.js";

const valid = {
  externalId: "catalog-1",
  creatorWallet: "GCREATOR",
  title: "A valid prompt",
  category: "Programming",
  image: "https://example.com/p.png",
  price: 1,
  payloadRef: "opaque-ref",
} as const;

describe("prompt import planning and dry-run validation", () => {
  it("reports counts, invalid rows, and duplicate rows without exposing sensitive payloads", () => {
    const r = planPromptImport([
      valid,
      { ...valid },
      { ...valid, externalId: "bad", title: "", price: -1 },
    ]);
    expect(r.dryRun).toBe(true);
    expect(r.committed).toBe(false);
    expect(r.counts).toEqual({ total: 3, created: 1, updated: 0, skipped: 0, invalid: 2 });
    expect(r.created).toHaveLength(1);
    expect(r.invalid).toHaveLength(2);
    expect(r.remediationGuidance).toHaveLength(2);
    expect(r.rollbackGuidance).toContain("Dry run mode active");
    expect(JSON.stringify(r)).not.toContain("opaque-ref");
  });

  it("is idempotent and protects creator ownership", () => {
    const r = planPromptImport([valid], [{ externalId: "catalog-1", creatorWallet: "GCREATOR" }]);
    expect(r.counts.updated).toBe(1);
    expect(r.updated).toHaveLength(1);

    const errorResult = planPromptImport([valid], [{ externalId: "catalog-1", creatorWallet: "GOTHER" }]);
    expect(errorResult.invalid[0].errors[0]).toMatch(/ownership/);
    expect(errorResult.counts.invalid).toBe(1);
  });

  it("supports explicit live mode vs dry-run mode flag", () => {
    const dryRunRes = planPromptImport([valid], [], { dryRun: true });
    expect(dryRunRes.dryRun).toBe(true);
    expect(dryRunRes.committed).toBe(false);

    const liveRes = planPromptImport([valid], [], { dryRun: false });
    expect(liveRes.dryRun).toBe(false);
    expect(liveRes.committed).toBe(true);
  });
});
