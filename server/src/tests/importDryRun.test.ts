import { describe, expect, it } from "vitest";
import { createImportDryRunReport } from "../services/importDryRun";

const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const OTHER_WALLET = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

describe("import dry-run validation", () => {
  it("classifies safe rows without writing data", () => {
    const report = createImportDryRunReport(
      [
        {
          externalId: "prompt-1",
          title: "Prompt One",
          ownerWallet: WALLET,
          contentHash: "hash-000000000001",
          price: "10",
        },
        {
          externalId: "prompt-2",
          title: "Prompt Two",
          ownerWallet: OTHER_WALLET,
          contentHash: "hash-000000000002",
          price: 5,
        },
      ],
      [{ externalId: "prompt-2", contentHash: "hash-000000000002" }],
    );

    expect(report.dryRun).toBe(true);
    expect(report.valid).toBe(true);
    expect(report.summary).toMatchObject({ creates: 1, updates: 1, errors: 0 });
    expect(report.rows.map((row) => row.action)).toEqual(["create", "update"]);
  });

  it("reports validation errors and duplicate import rows", () => {
    const report = createImportDryRunReport([
      {
        externalId: "dup",
        title: "Ok title",
        ownerWallet: WALLET,
        contentHash: "hash-000000000003",
        price: 1,
      },
      {
        externalId: "dup",
        title: "No",
        ownerWallet: "bad-wallet",
        contentHash: "hash-000000000003",
        price: 0,
      },
    ]);

    expect(report.valid).toBe(false);
    expect(report.summary.errors).toBe(1);
    expect(report.summary.conflicts).toBe(1);
    expect(report.rows[1].reasons).toEqual(
      expect.arrayContaining([
        "title must be at least 3 characters",
        "ownerWallet must be a Stellar account ID",
        "price must be a positive number",
        "duplicate externalId in import file",
        "duplicate contentHash in import file",
      ]),
    );
  });

  it("flags records that point at conflicting existing prompts", () => {
    const report = createImportDryRunReport(
      [
        {
          externalId: "existing-a",
          title: "Conflicting prompt",
          ownerWallet: WALLET,
          contentHash: "hash-existing-b",
          price: 7,
        },
      ],
      [
        { externalId: "existing-a", contentHash: "hash-existing-a" },
        { externalId: "existing-b", contentHash: "hash-existing-b" },
      ],
    );

    expect(report.valid).toBe(false);
    expect(report.summary.conflicts).toBe(1);
    expect(report.rows[0].reasons).toContain("externalId and contentHash match different existing prompts");
  });
});
