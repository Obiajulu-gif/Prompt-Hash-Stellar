import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  canonicalize,
  computeRecordDigest,
  createImportAttestation,
  createRecordEnvelope,
  ImportProvenanceError,
  loadImportProvenanceKeyRing,
  MIN_SIGNING_SECRET_LENGTH,
  verifyImportAttestation,
  type AttestedImportRecord,
  type ImportAttestation,
  type ProvenanceSigner,
} from "../services/importProvenance";

/**
 * Cryptographic provenance for imported records (#1206).
 *
 * Covers the normal sign/verify path, every tamper class (record, envelope,
 * ordering, manifest), unsigned input, key rotation, retry determinism and
 * configuration failure. The route-level authorization checks live in
 * importAttestationRoute.test.ts.
 */

const SIGNER: ProvenanceSigner = {
  keyId: "import-v1",
  secret: "test-signing-secret-not-for-production",
};
const FIXED_TIME = new Date("2026-03-01T12:00:00.000Z");

const records: AttestedImportRecord[] = [
  {
    rowRef: "row_a",
    record: { externalId: "catalog-1", creatorWallet: "GCREATOR", title: "First" },
  },
  {
    rowRef: "row_b",
    record: { externalId: "catalog-2", creatorWallet: "GCREATOR", title: "Second" },
  },
  {
    rowRef: "row_c",
    record: { externalId: "catalog-3", creatorWallet: "GOTHER", title: "Third" },
  },
];

function sign(overrides: Partial<{ records: AttestedImportRecord[]; signer: ProvenanceSigner }> = {}) {
  return createImportAttestation({
    subject: "prev_import_1",
    records: overrides.records ?? records,
    signer: overrides.signer ?? SIGNER,
    issuedAt: FIXED_TIME,
  });
}

/** A resolver that knows only the test key. */
const resolveKey = (keyId: string) => (keyId === SIGNER.keyId ? SIGNER.secret : undefined);

describe("canonicalize", () => {
  it("is independent of object key insertion order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
  });

  it("normalizes nested objects, Dates and omitted undefined values", () => {
    expect(
      canonicalize({ z: [{ b: 1, a: undefined, c: new Date("2026-01-01T00:00:00Z") }] }),
    ).toBe('{"z":[{"b":1,"c":"2026-01-01T00:00:00.000Z"}]}');
  });

  it("refuses values JSON cannot represent deterministically", () => {
    expect(() => canonicalize({ n: Number.NaN })).toThrow(ImportProvenanceError);
    expect(() => canonicalize({ n: 1n })).toThrow(ImportProvenanceError);
  });
});

describe("createImportAttestation", () => {
  it("signs every accepted record and links the hash chain", () => {
    const attestation = sign();

    expect(attestation.version).toBe(1);
    expect(attestation.algorithm).toBe("hmac-sha256");
    expect(attestation.keyId).toBe(SIGNER.keyId);
    expect(attestation.subject).toBe("prev_import_1");
    expect(attestation.issuedAt).toBe(FIXED_TIME.toISOString());
    expect(attestation.entryCount).toBe(records.length);
    expect(attestation.entries.map((entry) => entry.rowRef)).toEqual([
      "row_a",
      "row_b",
      "row_c",
    ]);

    expect(attestation.entries[0].previousDigest).toBeNull();
    expect(attestation.entries[1].previousDigest).toBe(attestation.entries[0].recordDigest);
    expect(attestation.entries[2].previousDigest).toBe(attestation.entries[1].recordDigest);
    expect(attestation.head).toBe(attestation.entries[2].digest);

    for (const entry of attestation.entries) {
      expect(entry.recordDigest).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.digest).toMatch(/^[a-f0-9]{64}$/);
      expect(entry.signature).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(attestation.manifestDigest).toMatch(/^[a-f0-9]{64}$/);
    expect(attestation.signature).toMatch(/^[a-f0-9]{64}$/);
  });

  it("is deterministic for the same inputs (retry-safe)", () => {
    expect(sign()).toEqual(sign());
  });

  it("produces a different attestation when a record changes", () => {
    const changed = sign({
      records: [
        records[0],
        { ...records[1], record: { ...records[1].record, title: "Edited" } },
        records[2],
      ],
    });
    expect(changed.entries[1].recordDigest).not.toBe(sign().entries[1].recordDigest);
    expect(changed.manifestDigest).not.toBe(sign().manifestDigest);
  });

  it("refuses duplicate row references", () => {
    expect(() =>
      sign({ records: [records[0], { ...records[1], rowRef: "row_a" }] }),
    ).toThrow(/Duplicate rowRef/);
  });

  it("refuses weak or missing signing secrets", () => {
    expect(() => sign({ signer: { keyId: "k", secret: "short" } })).toThrow(
      new RegExp(`${MIN_SIGNING_SECRET_LENGTH}`),
    );
    expect(() => sign({ signer: { keyId: "", secret: SIGNER.secret } })).toThrow(/keyId/);
  });

  it("supports an empty batch without claiming a head", () => {
    const empty = createImportAttestation({
      subject: "empty",
      records: [],
      signer: SIGNER,
      issuedAt: FIXED_TIME,
    });
    expect(empty.entries).toEqual([]);
    expect(empty.entryCount).toBe(0);
    expect(
      verifyImportAttestation({
        attestation: empty,
        records: [],
        resolveKey,
        expectedSubject: "empty",
      }).valid,
    ).toBe(true);
  });
});

describe("verifyImportAttestation — normal path", () => {
  it("accepts the exact records that were signed", () => {
    const result = verifyImportAttestation({
      attestation: sign(),
      records,
      resolveKey,
      expectedSubject: "prev_import_1",
    });

    expect(result).toMatchObject({
      valid: true,
      subject: "prev_import_1",
      keyId: SIGNER.keyId,
      reasons: [],
    });
    expect(result.entries).toHaveLength(records.length);
    expect(result.entries.every((entry) => entry.valid)).toBe(true);
  });

  it("accepts records in a different order (matching is by rowRef)", () => {
    const result = verifyImportAttestation({
      attestation: sign(),
      records: [records[2], records[0], records[1]],
      resolveKey,
    });
    expect(result.valid).toBe(true);
  });
});

describe("verifyImportAttestation — failure paths", () => {
  it("rejects unsigned imports and names every record", () => {
    const result = verifyImportAttestation({
      attestation: null,
      records,
      resolveKey,
    });
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(["unsigned"]);
    expect(result.entries.map((entry) => entry.reasons)).toEqual([
      ["unsigned"],
      ["unsigned"],
      ["unsigned"],
    ]);
  });

  it("detects edited record content", () => {
    const attestation = sign();
    const tampered = records.map((record, index) =>
      index === 1 ? { ...record, record: { ...record.record, title: "Rewritten" } } : record,
    );
    const result = verifyImportAttestation({ attestation, records: tampered, resolveKey });

    expect(result.valid).toBe(false);
    const entry = result.entries.find((candidate) => candidate.rowRef === "row_b")!;
    expect(entry.valid).toBe(false);
    expect(entry.reasons).toContain("record_digest_mismatch");
  });

  it("detects a reordered chain", () => {
    const attestation = sign();
    const reordered: ImportAttestation = {
      ...attestation,
      entries: [attestation.entries[1], attestation.entries[0], attestation.entries[2]],
    };
    const result = verifyImportAttestation({
      attestation: reordered,
      records,
      resolveKey,
    });

    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("manifest_digest_mismatch");
    expect(result.entries.find((entry) => entry.rowRef === "row_b")!.reasons).toContain(
      "chain_mismatch",
    );
  });

  it("detects an edited envelope digest or signature", () => {
    const attestation = sign();

    const editedDigest: ImportAttestation = {
      ...attestation,
      entries: attestation.entries.map((entry, index) =>
        index === 0 ? { ...entry, digest: "0".repeat(64) } : entry,
      ),
    };
    const digestResult = verifyImportAttestation({
      attestation: editedDigest,
      records,
      resolveKey,
    });
    expect(digestResult.valid).toBe(false);
    expect(digestResult.reasons).toContain("manifest_digest_mismatch");
    expect(digestResult.entries[0].reasons).toContain("entry_digest_mismatch");

    const editedSignature: ImportAttestation = {
      ...attestation,
      entries: attestation.entries.map((entry, index) =>
        index === 2 ? { ...entry, signature: "f".repeat(64) } : entry,
      ),
    };
    const signatureResult = verifyImportAttestation({
      attestation: editedSignature,
      records,
      resolveKey,
    });
    expect(signatureResult.valid).toBe(false);
    expect(signatureResult.entries[2].reasons).toContain("entry_signature_invalid");
  });

  it("detects a tampered manifest, head or entry count", () => {
    const attestation = sign();

    const tamperedManifest = verifyImportAttestation({
      attestation: { ...attestation, entryCount: attestation.entryCount + 1 },
      records,
      resolveKey,
    });
    expect(tamperedManifest.reasons).toContain("entry_count_mismatch");
    expect(tamperedManifest.reasons).toContain("manifest_digest_mismatch");

    const tamperedHead = verifyImportAttestation({
      attestation: { ...attestation, head: "a".repeat(64) },
      records,
      resolveKey,
    });
    expect(tamperedHead.reasons).toContain("head_mismatch");
    expect(tamperedHead.reasons).toContain("manifest_digest_mismatch");

    const tamperedSignature = verifyImportAttestation({
      attestation: { ...attestation, signature: "b".repeat(64) },
      records,
      resolveKey,
    });
    expect(tamperedSignature.reasons).toEqual(
      expect.arrayContaining(["attestation_signature_invalid"]),
    );
  });

  it("rejects a signature made with a different secret under the same key id", () => {
    const forged = sign({ signer: { keyId: SIGNER.keyId, secret: "a-different-secret-value" } });
    const result = verifyImportAttestation({ attestation: forged, records, resolveKey });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("attestation_signature_invalid");
    expect(result.entries[0].reasons).toContain("entry_signature_invalid");
  });

  it("rejects an unknown signing key", () => {
    const result = verifyImportAttestation({
      attestation: sign(),
      records,
      resolveKey: () => undefined,
    });
    expect(result.valid).toBe(false);
    expect(result.reasons).toEqual(["unknown_key"]);
    expect(result.entries.every((entry) => entry.reasons.includes("unknown_key"))).toBe(true);
  });

  it("rejects a mismatched subject when one is expected", () => {
    const result = verifyImportAttestation({
      attestation: sign(),
      records,
      resolveKey,
      expectedSubject: "some-other-import",
    });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("subject_mismatch");
  });

  it("reports missing records and unattested extras", () => {
    const attestation = sign();

    const missing = verifyImportAttestation({
      attestation,
      records: records.slice(0, 2),
      resolveKey,
    });
    expect(missing.valid).toBe(false);
    expect(missing.entries.find((entry) => entry.rowRef === "row_c")!.reasons).toContain(
      "missing_record",
    );

    const extra = verifyImportAttestation({
      attestation,
      records: [...records, { rowRef: "row_extra", record: { externalId: "x" } }],
      resolveKey,
    });
    expect(extra.valid).toBe(false);
    expect(extra.entries.find((entry) => entry.rowRef === "row_extra")!.reasons).toEqual([
      "unattested_record",
    ]);
  });

  it("rejects duplicate record references", () => {
    const result = verifyImportAttestation({
      attestation: sign(),
      records: [...records, records[0]],
      resolveKey,
    });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("duplicate_record_ref");
  });

  it("rejects a record addressed by the wrong rowRef", () => {
    const moved = records.map((record, index) =>
      index === 0 ? { record: record.record, rowRef: "row_b" } : record,
    );
    const result = verifyImportAttestation({
      attestation: sign(),
      records: moved,
      resolveKey,
    });
    expect(result.valid).toBe(false);
    expect(result.reasons).toContain("duplicate_record_ref");
  });
});

describe("key ring configuration and rotation", () => {
  const envKeys = [
    "IMPORT_PROVENANCE_SIGNING_KEY",
    "IMPORT_PROVENANCE_KEY_ID",
    "IMPORT_PROVENANCE_SIGNING_KEY_PREVIOUS",
    "IMPORT_PROVENANCE_KEY_ID_PREVIOUS",
  ] as const;
  const original: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const key of envKeys) {
      original[key] = process.env[key];
      delete process.env[key];
    }
  });

  afterEach(() => {
    for (const key of envKeys) {
      if (original[key] === undefined) delete process.env[key];
      else process.env[key] = original[key];
    }
  });

  it("leaves signing disabled when no secret is configured (fail closed)", () => {
    const ring = loadImportProvenanceKeyRing({} as NodeJS.ProcessEnv);
    expect(ring.configured).toBe(false);
    expect(ring.signer).toBeUndefined();
    expect(ring.resolveKey("import-v1")).toBeUndefined();
  });

  it("ignores a short secret rather than signing with a weak key", () => {
    const ring = loadImportProvenanceKeyRing({
      IMPORT_PROVENANCE_SIGNING_KEY: "too-short",
    } as NodeJS.ProcessEnv);
    expect(ring.configured).toBe(false);
  });

  it("exposes the active and previous key during rotation", () => {
    const ring = loadImportProvenanceKeyRing({
      IMPORT_PROVENANCE_SIGNING_KEY: "current-signing-secret-value",
      IMPORT_PROVENANCE_KEY_ID: "2026-03",
      IMPORT_PROVENANCE_SIGNING_KEY_PREVIOUS: "previous-signing-secret-value",
    } as NodeJS.ProcessEnv);

    expect(ring.configured).toBe(true);
    expect(ring.signer?.keyId).toBe("2026-03");
    expect(ring.resolveKey("2026-03")).toBe("current-signing-secret-value");
    expect(ring.resolveKey("2026-03-previous")).toBe("previous-signing-secret-value");

    const oldKey = createImportAttestation({
      subject: "prev_old",
      records,
      signer: { keyId: "2026-03-previous", secret: "previous-signing-secret-value" },
      issuedAt: FIXED_TIME,
    });
    expect(
      verifyImportAttestation({ attestation: oldKey, records, resolveKey: ring.resolveKey }).valid,
    ).toBe(true);
  });
});

describe("record envelope primitive", () => {
  it("links an envelope to a caller-supplied previous digest", () => {
    const first = createRecordEnvelope({
      rowRef: "row_a",
      record: records[0].record,
      previousDigest: null,
      signer: SIGNER,
      issuedAt: FIXED_TIME,
    });
    const second = createRecordEnvelope({
      rowRef: "row_b",
      record: records[1].record,
      previousDigest: first.recordDigest,
      signer: SIGNER,
      issuedAt: FIXED_TIME,
    });

    expect(second.previousDigest).toBe(first.recordDigest);
    expect(computeRecordDigest(records[0].record)).toBe(first.recordDigest);
  });
});
