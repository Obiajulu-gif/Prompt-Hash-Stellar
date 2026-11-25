/**
 * Cryptographic provenance for imported records (#1206).
 *
 * The secure import pipeline already gives every accepted row a stable
 * `rowRef` and a deterministic `importId`. Those are *identifiers*, not
 * evidence: anyone with write access to the store could edit a row and keep
 * its id. This module adds tamper-evident evidence by signing a hash chain
 * over the exact imported records.
 *
 *   record ──▶ digest ──▶ envelope (previousDigest ◀── prior record)
 *                                 │ HMAC-SHA256
 *                                 ▼
 *                    attestation manifest (entry digests + head)
 *                                 │ HMAC-SHA256
 *                                 ▼
 *                          ImportAttestation
 *
 * Properties:
 * - **Tamper-evident.** Changing a record, an envelope, its position, or the
 *   manifest invalidates verification with a specific reason code.
 * - **Key rotation aware.** Envelopes pin the `keyId` that signed them; the
 *   verifier resolves a key per id, so old attestations keep verifying after
 *   the active signing key rotates.
 * - **Deterministic given inputs.** The same records, key, subject and
 *   `issuedAt` always produce byte-identical envelopes, so an import retry
 *   reproduces the same attestation.
 * - **No secret leakage.** Only digests are signed and stored; raw payloads
 *   and the secret never appear in an attestation.
 */

import { createHash, createHmac, timingSafeEqual } from "node:crypto";

export const IMPORT_PROVENANCE_VERSION = 1 as const;
export const IMPORT_PROVENANCE_ALGORITHM = "hmac-sha256" as const;

/** Minimum secret length accepted for signing/verification (bytes). */
export const MIN_SIGNING_SECRET_LENGTH = 16;

export interface ProvenanceSigner {
  keyId: string;
  secret: string;
}

/** One imported record, addressed by the pipeline's stable `rowRef`. */
export interface AttestedImportRecord {
  rowRef: string;
  record: Record<string, unknown>;
}

export interface RecordEnvelope {
  version: typeof IMPORT_PROVENANCE_VERSION;
  algorithm: typeof IMPORT_PROVENANCE_ALGORITHM;
  keyId: string;
  rowRef: string;
  recordDigest: string;
  previousDigest: string | null;
  issuedAt: string;
  digest: string;
  signature: string;
}

export interface ImportAttestation {
  version: typeof IMPORT_PROVENANCE_VERSION;
  algorithm: typeof IMPORT_PROVENANCE_ALGORITHM;
  keyId: string;
  /** The import id / batch id the attestation covers. */
  subject: string;
  issuedAt: string;
  entryCount: number;
  /** Digest of the last entry — the chain head. */
  head: string;
  entries: RecordEnvelope[];
  manifestDigest: string;
  signature: string;
}

export type VerificationReason =
  | "unsigned"
  | "unsupported_version"
  | "unsupported_algorithm"
  | "unknown_key"
  | "subject_mismatch"
  | "attestation_signature_invalid"
  | "manifest_digest_mismatch"
  | "entry_count_mismatch"
  | "head_mismatch"
  | "entry_digest_mismatch"
  | "entry_signature_invalid"
  | "record_digest_mismatch"
  | "chain_mismatch"
  | "duplicate_record_ref"
  | "missing_record"
  | "unattested_record";

export interface VerifiedEntry {
  rowRef: string;
  valid: boolean;
  reasons: VerificationReason[];
}

export interface AttestationVerification {
  valid: boolean;
  subject?: string;
  keyId?: string;
  head?: string;
  reasons: VerificationReason[];
  entries: VerifiedEntry[];
}

export type KeyResolver = (keyId: string) => string | undefined;

export class ImportProvenanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ImportProvenanceError";
  }
}

/** Deterministic JSON: object keys sorted, `undefined` omitted, Dates as ISO. */
export function canonicalize(value: unknown): string {
  return JSON.stringify(normalize(value));
}

function normalize(value: unknown): unknown {
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      const entry = source[key];
      if (entry === undefined) continue;
      out[key] = normalize(entry);
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    throw new ImportProvenanceError("Cannot canonicalize a non-finite number.");
  }
  if (typeof value === "bigint" || typeof value === "function" || typeof value === "symbol") {
    throw new ImportProvenanceError(`Cannot canonicalize a ${typeof value}.`);
  }
  return value;
}

export function sha256Hex(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function hmacSha256Hex(secret: string, value: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("hex");
}

function constantTimeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, "utf8");
  const right = Buffer.from(b, "utf8");
  return left.length === right.length && timingSafeEqual(left, right);
}

function assertSigner(signer: ProvenanceSigner): void {
  if (!signer.keyId || !signer.keyId.trim()) {
    throw new ImportProvenanceError("A signing keyId is required.");
  }
  if (!signer.secret || signer.secret.length < MIN_SIGNING_SECRET_LENGTH) {
    throw new ImportProvenanceError(
      `The signing secret must be at least ${MIN_SIGNING_SECRET_LENGTH} characters.`,
    );
  }
}

/** Digest of the imported record content only. */
export function computeRecordDigest(record: Record<string, unknown>): string {
  return sha256Hex(canonicalize(record));
}

function envelopeHeader(input: {
  keyId: string;
  rowRef: string;
  recordDigest: string;
  previousDigest: string | null;
  issuedAt: string;
}): string {
  return canonicalize({
    version: IMPORT_PROVENANCE_VERSION,
    algorithm: IMPORT_PROVENANCE_ALGORITHM,
    keyId: input.keyId,
    rowRef: input.rowRef,
    recordDigest: input.recordDigest,
    previousDigest: input.previousDigest,
    issuedAt: input.issuedAt,
  });
}

function computeManifestDigest(input: {
  keyId: string;
  subject: string;
  issuedAt: string;
  entryCount: number;
  head: string;
  entryDigests: string[];
}): string {
  return sha256Hex(
    canonicalize({
      version: IMPORT_PROVENANCE_VERSION,
      algorithm: IMPORT_PROVENANCE_ALGORITHM,
      keyId: input.keyId,
      subject: input.subject,
      issuedAt: input.issuedAt,
      entryCount: input.entryCount,
      head: input.head,
      entryDigests: input.entryDigests,
    }),
  );
}

/**
 * Build one envelope linked to `previousDigest`. Exported so a caller can
 * regenerate or extend a chain without rebuilding the whole attestation.
 */
export function createRecordEnvelope(input: {
  rowRef: string;
  record: Record<string, unknown>;
  previousDigest: string | null;
  signer: ProvenanceSigner;
  issuedAt: Date;
}): RecordEnvelope {
  assertSigner(input.signer);
  if (!input.rowRef) throw new ImportProvenanceError("rowRef is required.");
  const issuedAt = input.issuedAt.toISOString();
  const recordDigest = computeRecordDigest(input.record);
  const digest = sha256Hex(
    envelopeHeader({
      keyId: input.signer.keyId,
      rowRef: input.rowRef,
      recordDigest,
      previousDigest: input.previousDigest,
      issuedAt,
    }),
  );
  return {
    version: IMPORT_PROVENANCE_VERSION,
    algorithm: IMPORT_PROVENANCE_ALGORITHM,
    keyId: input.signer.keyId,
    rowRef: input.rowRef,
    recordDigest,
    previousDigest: input.previousDigest,
    issuedAt,
    digest,
    signature: hmacSha256Hex(input.signer.secret, digest),
  };
}

/**
 * Sign a batch of imported records into one chained attestation.
 * Entry order is significant: it is the order the records were imported.
 */
export function createImportAttestation(input: {
  subject: string;
  records: AttestedImportRecord[];
  signer: ProvenanceSigner;
  issuedAt?: Date;
}): ImportAttestation {
  assertSigner(input.signer);
  if (!input.subject) throw new ImportProvenanceError("A subject (import id) is required.");

  const seen = new Set<string>();
  for (const record of input.records) {
    if (!record.rowRef) throw new ImportProvenanceError("Every record needs a rowRef.");
    if (seen.has(record.rowRef)) {
      throw new ImportProvenanceError(`Duplicate rowRef in attestation input: ${record.rowRef}`);
    }
    seen.add(record.rowRef);
  }

  const issuedAt = (input.issuedAt ?? new Date()).toISOString();
  const entries: RecordEnvelope[] = [];
  let previousDigest: string | null = null;
  for (const record of input.records) {
    const envelope = createRecordEnvelope({
      rowRef: record.rowRef,
      record: record.record,
      previousDigest,
      signer: input.signer,
      issuedAt: new Date(issuedAt),
    });
    entries.push(envelope);
    previousDigest = envelope.recordDigest;
  }

  const head = entries.length > 0 ? entries[entries.length - 1].digest : previousDigest ?? "";
  const manifestDigest = computeManifestDigest({
    keyId: input.signer.keyId,
    subject: input.subject,
    issuedAt,
    entryCount: entries.length,
    head,
    entryDigests: entries.map((entry) => entry.digest),
  });

  return {
    version: IMPORT_PROVENANCE_VERSION,
    algorithm: IMPORT_PROVENANCE_ALGORITHM,
    keyId: input.signer.keyId,
    subject: input.subject,
    issuedAt,
    entryCount: entries.length,
    head,
    entries,
    manifestDigest,
    signature: hmacSha256Hex(input.signer.secret, manifestDigest),
  };
}

/**
 * Verify an attestation against the records it claims to cover.
 *
 * Verification is fail-closed: any missing record, extra record, reordering,
 * digest/signature mismatch, unknown key or subject mismatch makes the whole
 * attestation invalid. Individual entry reasons say exactly what failed.
 */
export function verifyImportAttestation(input: {
  attestation: ImportAttestation | null | undefined;
  records: AttestedImportRecord[];
  resolveKey: KeyResolver;
  expectedSubject?: string;
}): AttestationVerification {
  const globalReasons = new Set<VerificationReason>();
  const entryResults: VerifiedEntry[] = [];
  const attestation = input.attestation;

  if (!attestation) {
    return {
      valid: false,
      reasons: ["unsigned"],
      entries: input.records.map((record): VerifiedEntry => ({
        rowRef: record.rowRef,
        valid: false,
        reasons: ["unsigned"],
      })),
    };
  }

  if (attestation.version !== IMPORT_PROVENANCE_VERSION) globalReasons.add("unsupported_version");
  if (attestation.algorithm !== IMPORT_PROVENANCE_ALGORITHM)
    globalReasons.add("unsupported_algorithm");
  if (input.expectedSubject !== undefined && attestation.subject !== input.expectedSubject) {
    globalReasons.add("subject_mismatch");
  }

  const secret = input.resolveKey(attestation.keyId);
  if (!secret) {
    globalReasons.add("unknown_key");
    return {
      valid: false,
      subject: attestation.subject,
      keyId: attestation.keyId,
      head: attestation.head,
      reasons: [...globalReasons],
      entries: input.records.map((record): VerifiedEntry => ({
        rowRef: record.rowRef,
        valid: false,
        reasons: ["unknown_key"],
      })),
    };
  }

  const entries = Array.isArray(attestation.entries) ? attestation.entries : [];
  if (attestation.entryCount !== entries.length) globalReasons.add("entry_count_mismatch");

  const recomputedManifest = computeManifestDigest({
    keyId: attestation.keyId,
    subject: attestation.subject,
    issuedAt: attestation.issuedAt,
    entryCount: attestation.entryCount,
    head: attestation.head,
    entryDigests: entries.map((entry) => entry.digest),
  });
  if (!constantTimeEqual(recomputedManifest, attestation.manifestDigest)) {
    globalReasons.add("manifest_digest_mismatch");
  }
  if (!constantTimeEqual(hmacSha256Hex(secret, attestation.manifestDigest), attestation.signature)) {
    globalReasons.add("attestation_signature_invalid");
  }

  const head = entries.length > 0 ? entries[entries.length - 1].digest : "";
  if (head !== attestation.head) globalReasons.add("head_mismatch");

  const recordsByRef = new Map<string, AttestedImportRecord>();
  const duplicateRefs = new Set<string>();
  for (const record of input.records) {
    if (recordsByRef.has(record.rowRef)) duplicateRefs.add(record.rowRef);
    else recordsByRef.set(record.rowRef, record);
  }
  for (const ref of duplicateRefs) globalReasons.add("duplicate_record_ref");

  const entryByRef = new Map<string, VerifiedEntry>();
  let previousDigest: string | null = null;

  entries.forEach((entry) => {
    const reasons = new Set<VerificationReason>();

    if (entry.previousDigest !== previousDigest) reasons.add("chain_mismatch");
    previousDigest = entry.recordDigest;

    const expectedDigest = sha256Hex(
      envelopeHeader({
        keyId: entry.keyId,
        rowRef: entry.rowRef,
        recordDigest: entry.recordDigest,
        previousDigest: entry.previousDigest,
        issuedAt: entry.issuedAt,
      }),
    );
    if (expectedDigest !== entry.digest) reasons.add("entry_digest_mismatch");
    if (!constantTimeEqual(hmacSha256Hex(secret, entry.digest), entry.signature)) {
      reasons.add("entry_signature_invalid");
    }

    const record = recordsByRef.get(entry.rowRef);
    if (!record) {
      reasons.add("missing_record");
    } else if (computeRecordDigest(record.record) !== entry.recordDigest) {
      reasons.add("record_digest_mismatch");
    }

    // An attestation must not repeat a rowRef: a replay could otherwise hide
    // one record behind another at the same position.
    if (entryByRef.has(entry.rowRef)) reasons.add("duplicate_record_ref");

    const result: VerifiedEntry = {
      rowRef: entry.rowRef,
      valid: reasons.size === 0,
      reasons: [...reasons],
    };
    if (!entryByRef.has(entry.rowRef)) entryByRef.set(entry.rowRef, result);
    entryResults.push(result);
  });

  for (const record of input.records) {
    if (!entryByRef.has(record.rowRef)) {
      const existing = entryResults.find((entry) => entry.rowRef === record.rowRef);
      if (existing) {
        existing.valid = false;
        existing.reasons = [
          ...new Set<VerificationReason>([...existing.reasons, "unattested_record"]),
        ];
      } else {
        entryResults.push({
          rowRef: record.rowRef,
          valid: false,
          reasons: ["unattested_record"] as VerificationReason[],
        });
      }
    }
  }

  const valid =
    globalReasons.size === 0 && entryResults.every((entry) => entry.valid);

  return {
    valid,
    subject: attestation.subject,
    keyId: attestation.keyId,
    head: attestation.head,
    reasons: [...globalReasons],
    entries: entryResults,
  };
}

export interface ImportProvenanceKeyRing {
  /** Signer to use for new attestations, when configured. */
  signer?: ProvenanceSigner;
  /** Resolves current and previous keys by id for verification. */
  resolveKey: KeyResolver;
  configured: boolean;
}

/**
 * Load the signing key ring from the environment.
 *
 * `IMPORT_PROVENANCE_SIGNING_KEY` is required to sign; a previous key can be
 * supplied during rotation so attestations issued before the rotation keep
 * verifying. A missing or too-short secret leaves signing disabled rather
 * than falling back to a default key.
 */
export function loadImportProvenanceKeyRing(
  env: NodeJS.ProcessEnv = process.env,
): ImportProvenanceKeyRing {
  const keyId = env.IMPORT_PROVENANCE_KEY_ID?.trim() || "import-v1";
  const secret = env.IMPORT_PROVENANCE_SIGNING_KEY;
  const previousKeyId =
    env.IMPORT_PROVENANCE_KEY_ID_PREVIOUS?.trim() || `${keyId}-previous`;
  const previousSecret = env.IMPORT_PROVENANCE_SIGNING_KEY_PREVIOUS;

  const signer =
    secret && secret.length >= MIN_SIGNING_SECRET_LENGTH
      ? { keyId, secret }
      : undefined;

  const keys = new Map<string, string>();
  if (signer) keys.set(keyId, secret!);
  if (previousSecret && previousSecret.length >= MIN_SIGNING_SECRET_LENGTH) {
    keys.set(previousKeyId, previousSecret);
  }

  return {
    signer,
    resolveKey: (id) => keys.get(id),
    configured: signer !== undefined,
  };
}
