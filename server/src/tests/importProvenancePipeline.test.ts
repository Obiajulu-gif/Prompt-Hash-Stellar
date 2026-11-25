import { describe, expect, it } from "vitest";
import {
  commitPromptImport,
  computeRowRef,
  createMemoryImportStore,
  previewPromptImport,
} from "../services/promptImportPipeline";
import type { PromptImportRow } from "../services/promptImport";
import {
  verifyImportAttestation,
  type ProvenanceSigner,
} from "../services/importProvenance";

/**
 * Integration between the secure import pipeline and cryptographic
 * provenance (#1206): signed receipts, retry determinism, and detection of
 * post-commit edits.
 */

const SIGNER: ProvenanceSigner = {
  keyId: "pipeline-test",
  secret: "pipeline-signing-secret-long-enough",
};
const resolveKey = (keyId: string) => (keyId === SIGNER.keyId ? SIGNER.secret : undefined);

function makeRow(overrides: Record<string, unknown> = {}): PromptImportRow {
  return {
    externalId: "catalog-1",
    creatorWallet: "GCREATOR",
    title: "A valid prompt",
    category: "Programming",
    image: "https://example.com/p.png",
    price: 1,
    ...overrides,
  } as unknown as PromptImportRow;
}

/** The persisted representation, which is what the attestation signs. */
function storedRecords(store: ReturnType<typeof createMemoryImportStore>) {
  return store.dump().map((record) => ({
    rowRef: record.rowRef,
    record: record.row as unknown as Record<string, unknown>,
  }));
}

describe("signed import receipts", () => {
  it("attests exactly the accepted rows, not quarantined ones", async () => {
    const store = createMemoryImportStore();
    const rows = [
      makeRow({ externalId: "catalog-1" }),
      makeRow({ externalId: "catalog-2" }),
      makeRow({ externalId: "catalog-3", title: "" }), // quarantined
    ];
    const preview = previewPromptImport(rows, await store.listExisting());

    const receipt = await commitPromptImport(store, rows, {
      previewId: preview.previewId,
      now: new Date("2026-03-01T12:00:00Z"),
      provenance: { signer: SIGNER },
    });

    expect(receipt.attestation).toBeDefined();
    expect(receipt.attestation!.entryCount).toBe(2);
    expect(receipt.attestation!.subject).toBe(receipt.importId);
    expect(receipt.attestation!.issuedAt).toBe("2026-03-01T12:00:00.000Z");

    const verification = verifyImportAttestation({
      attestation: receipt.attestation,
      records: storedRecords(store),
      resolveKey,
      expectedSubject: receipt.importId,
    });
    expect(verification.valid).toBe(true);
  });

  it("reproduces the same attestation on a retried commit", async () => {
    const store = createMemoryImportStore();
    const rows = [makeRow({ externalId: "catalog-1" }), makeRow({ externalId: "catalog-2" })];
    const preview = previewPromptImport(rows, await store.listExisting());
    const now = new Date("2026-03-01T12:00:00Z");

    const first = await commitPromptImport(store, rows, {
      previewId: preview.previewId,
      now,
      provenance: { signer: SIGNER },
    });
    const second = await commitPromptImport(store, rows, {
      previewId: preview.previewId,
      now,
      provenance: { signer: SIGNER },
    });

    expect(second.receiptHash).toBe(first.receiptHash);
    expect(second.attestation).toEqual(first.attestation);
    expect(store.dump()).toHaveLength(2);
  });

  it("preserves the unsigned receipt contract when no signer is supplied", async () => {
    const store = createMemoryImportStore();
    const rows = [makeRow()];
    const preview = previewPromptImport(rows, await store.listExisting());
    const receipt = await commitPromptImport(store, rows, { previewId: preview.previewId });

    expect(receipt).not.toHaveProperty("attestation");
    expect(receipt.receiptHash).toMatch(/^[a-f0-9]{64}$/);
    expect(receipt.rows).toHaveLength(1);
  });

  it("detects a record edited after the signed commit", async () => {
    const store = createMemoryImportStore();
    const rows = [makeRow({ externalId: "catalog-1" }), makeRow({ externalId: "catalog-2" })];
    const preview = previewPromptImport(rows, await store.listExisting());
    const receipt = await commitPromptImport(store, rows, {
      previewId: preview.previewId,
      now: new Date("2026-03-01T12:00:00Z"),
      provenance: { signer: SIGNER },
    });

    // Simulate a store-level edit with write access: the row still resolves to
    // the same rowRef, but its content changed.
    const edited = storedRecords(store).map((entry) =>
      entry.rowRef === computeRowRef(rows[0])
        ? { ...entry, record: { ...entry.record, title: "Silently rewritten" } }
        : entry,
    );

    const verification = verifyImportAttestation({
      attestation: receipt.attestation,
      records: edited,
      resolveKey,
    });

    expect(verification.valid).toBe(false);
    expect(verification.entries.some((entry) => entry.reasons.includes("record_digest_mismatch"))).toBe(
      true,
    );
  });

  it("refuses to attest a commit whose preview no longer matches", async () => {
    const store = createMemoryImportStore();
    const preview = previewPromptImport([makeRow()]);

    await expect(
      commitPromptImport(store, [makeRow({ title: "Edited after preview" })], {
        previewId: preview.previewId,
        provenance: { signer: SIGNER },
      }),
    ).rejects.toThrow(/previewId does not match/);
    expect(store.dump()).toHaveLength(0);
  });
});
