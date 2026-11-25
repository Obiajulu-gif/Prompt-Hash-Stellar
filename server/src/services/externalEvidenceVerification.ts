/**
 * Cryptographic verification for imported external evidence (#1011).
 *
 * External systems submit an *evidence envelope*: the payload, its SHA-256
 * digest, metadata, and an Ed25519 signature made with a key this deployment
 * explicitly trusts. Import is fail-closed:
 *
 *   - the key id must be in the trusted registry and not revoked;
 *   - the issuer and scope carried by the envelope must match the key grant;
 *   - `payloadHash` must equal SHA-256(canonicalJson(payload));
 *   - the signature must verify over canonical JSON of the metadata;
 *   - `issuedAt`/`expiresAt` must be inside the accepted window;
 *   - `(issuer, nonce)` and `evidenceId` are single-use.
 *
 * Retries are safe: replaying the exact same envelope returns the stored
 * record with `duplicate: true`. Reusing an `evidenceId` with different bytes,
 * or a nonce under a different evidence id, is a 409 conflict. Verification
 * never trusts a caller-supplied "verified" flag.
 *
 * See docs/operations/external-evidence-verification.md.
 */

import {
  createHash,
  createPublicKey,
  sign,
  verify,
  type KeyObject,
} from "crypto";
import mongoose from "mongoose";
import { canonicalJson } from "./canonicalSerialization";
import ExternalEvidenceRecord from "../models/ExternalEvidenceRecord";

// ---------------------------------------------------------------------------
// Envelope and result shapes
// ---------------------------------------------------------------------------

export interface ExternalEvidenceEnvelope {
  /** Globally unique evidence id; also the idempotency key. */
  evidenceId: string;
  /** Identity of the external system that produced the evidence. */
  issuer: string;
  /** Authorisation scope the evidence is valid for, e.g. `prompt:123`. */
  scope: string;
  /** The imported document itself. Must be JSON-serialisable. */
  payload: unknown;
  /** Lowercase hex SHA-256 of canonicalJson(payload). */
  payloadHash: string;
  /** ISO-8601 timestamp at which the issuer signed the evidence. */
  issuedAt: string;
  /** Optional ISO-8601 expiry; absent means no issuer-side expiry. */
  expiresAt?: string;
  /** Single-use nonce; `(issuer, nonce)` is unique. */
  nonce: string;
  /** Id of the trusted Ed25519 public key. */
  keyId: string;
  /** Base64 Ed25519 signature over the canonical signing input. */
  signature: string;
}

export interface StoredExternalEvidence {
  evidenceId: string;
  issuer: string;
  scope: string;
  keyId: string;
  nonce: string;
  payloadHash: string;
  /** SHA-256 of the whole envelope; distinguishes retries from conflicts. */
  fingerprint: string;
  payload: unknown;
  issuedAt: Date;
  expiresAt: Date | null;
  receivedAt: Date;
  status: "verified";
}

export interface VerifiedExternalEvidence {
  evidenceId: string;
  issuer: string;
  scope: string;
  keyId: string;
  nonce: string;
  payloadHash: string;
  fingerprint: string;
  payload: unknown;
  issuedAt: string;
  expiresAt: string | null;
  receivedAt: string;
  status: "verified";
  /** True when this call returned an already-verified record. */
  duplicate: boolean;
}

export interface TrustedExternalEvidenceKey {
  keyId: string;
  issuer: string;
  /** PEM/SPKI DER/raw 32-byte Ed25519 public key, or a KeyObject. */
  publicKey: string | KeyObject;
  /** Granted scopes. `*` grants everything, `prefix*` grants a prefix. */
  scopes: string[];
  notBefore?: string;
  expiresAt?: string;
  revokedAt?: string;
  label?: string;
}

export interface ExternalEvidenceReplayStore {
  findByEvidenceId(evidenceId: string): Promise<StoredExternalEvidence | null>;
  findByNonce(issuer: string, nonce: string): Promise<StoredExternalEvidence | null>;
  /** Insert once. Returns false when a uniqueness constraint was violated. */
  insert(record: StoredExternalEvidence): Promise<boolean>;
}

export type ExternalEvidenceErrorCode =
  | "invalid_envelope"
  | "payload_hash_mismatch"
  | "trusted_keys_unconfigured"
  | "trusted_keys_invalid"
  | "unknown_key"
  | "revoked_key"
  | "key_not_yet_valid"
  | "key_expired"
  | "invalid_signature"
  | "issuer_mismatch"
  | "scope_not_allowed"
  | "evidence_expired"
  | "evidence_from_future"
  | "evidence_too_old"
  | "nonce_reuse"
  | "evidence_conflict"
  | "replay_store_unavailable";

const HTTP_STATUS: Record<ExternalEvidenceErrorCode, number> = {
  invalid_envelope: 400,
  payload_hash_mismatch: 400,
  trusted_keys_unconfigured: 503,
  trusted_keys_invalid: 503,
  unknown_key: 401,
  revoked_key: 401,
  key_not_yet_valid: 401,
  key_expired: 401,
  invalid_signature: 401,
  issuer_mismatch: 403,
  scope_not_allowed: 403,
  evidence_expired: 410,
  evidence_from_future: 422,
  evidence_too_old: 410,
  nonce_reuse: 409,
  evidence_conflict: 409,
  replay_store_unavailable: 503,
};

export class ExternalEvidenceError extends Error {
  readonly httpStatus: number;
  readonly details?: Record<string, unknown>;

  constructor(
    readonly code: ExternalEvidenceErrorCode,
    message: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ExternalEvidenceError";
    this.httpStatus = HTTP_STATUS[code];
    this.details = details;
  }
}

// ---------------------------------------------------------------------------
// Canonicalisation and signing helpers
// ---------------------------------------------------------------------------

/** SHA-256 of the canonical JSON representation of `payload`. */
export function computeEvidencePayloadHash(payload: unknown): string {
  let canonical: string;
  try {
    canonical = canonicalJson(payload);
  } catch (err) {
    throw new ExternalEvidenceError(
      "invalid_envelope",
      `Payload is not JSON-serialisable: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
  return createHash("sha256").update(canonical).digest("hex");
}

/**
 * Bytes an issuer signs. Deliberately excludes the payload body: the body is
 * bound through `payloadHash`, keeping signatures small and verification
 * streaming-friendly. `expiresAt` is always present (null when unused) so a
 * missing field cannot be confused with an omitted one.
 */
export function externalEvidenceSigningInput(
  envelope: Pick<
    ExternalEvidenceEnvelope,
    | "evidenceId"
    | "issuer"
    | "scope"
    | "payloadHash"
    | "issuedAt"
    | "expiresAt"
    | "nonce"
    | "keyId"
  >,
): string {
  return canonicalJson({
    evidenceId: envelope.evidenceId,
    issuer: envelope.issuer,
    scope: envelope.scope,
    payloadHash: String(envelope.payloadHash ?? "").toLowerCase(),
    issuedAt: envelope.issuedAt,
    expiresAt: envelope.expiresAt ?? null,
    nonce: envelope.nonce,
    keyId: envelope.keyId,
  });
}

export interface SignExternalEvidenceInput {
  evidenceId: string;
  issuer: string;
  scope: string;
  payload: unknown;
  issuedAt: string;
  expiresAt?: string;
  nonce: string;
  keyId: string;
}

/**
 * Build a complete signed envelope. Used by trusted importers and tests; the
 * server itself only ever verifies. The payload hash is computed here so
 * callers cannot accidentally sign a stale digest.
 */
export function signExternalEvidence(
  input: SignExternalEvidenceInput,
  privateKey: KeyObject | string | Buffer,
): ExternalEvidenceEnvelope {
  const payloadHash = computeEvidencePayloadHash(input.payload);
  const unsigned = {
    evidenceId: input.evidenceId,
    issuer: input.issuer,
    scope: input.scope,
    payloadHash,
    issuedAt: input.issuedAt,
    ...(input.expiresAt !== undefined ? { expiresAt: input.expiresAt } : {}),
    nonce: input.nonce,
    keyId: input.keyId,
  };
  const signature = sign(
    null,
    Buffer.from(externalEvidenceSigningInput(unsigned), "utf8"),
    privateKey,
  ).toString("base64");
  return { ...unsigned, payload: input.payload, signature };
}

// ---------------------------------------------------------------------------
// Trusted key registry
// ---------------------------------------------------------------------------

const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

function decodeKeyMaterial(material: string): KeyObject {
  const trimmed = material.trim();
  if (trimmed.includes("BEGIN")) return createPublicKey(trimmed);

  const encoding = /[-_]/.test(trimmed) ? "base64url" : "base64";
  const bytes = Buffer.from(trimmed, encoding);
  if (bytes.length === 32) {
    return createPublicKey({
      key: Buffer.concat([ED25519_SPKI_PREFIX, bytes]),
      format: "der",
      type: "spki",
    });
  }
  return createPublicKey({ key: bytes, format: "der", type: "spki" });
}

function optionalTimestamp(value: unknown, field: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) {
    throw new ExternalEvidenceError(
      "trusted_keys_invalid",
      `Trusted key field "${field}" must be an ISO-8601 timestamp.`,
    );
  }
  return value;
}

function parseTrustedKey(raw: unknown, index: number): TrustedExternalEvidenceKey {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    throw new ExternalEvidenceError(
      "trusted_keys_invalid",
      `Trusted key entry ${index + 1} must be an object.`,
    );
  }
  const entry = raw as Record<string, unknown>;
  const keyId = entry.keyId;
  const issuer = entry.issuer;
  const publicKey = entry.publicKey;
  const scopes = entry.scopes;

  if (typeof keyId !== "string" || keyId.length === 0) {
    throw new ExternalEvidenceError(
      "trusted_keys_invalid",
      `Trusted key entry ${index + 1} is missing a non-empty keyId.`,
    );
  }
  if (typeof issuer !== "string" || issuer.length === 0) {
    throw new ExternalEvidenceError(
      "trusted_keys_invalid",
      `Trusted key "${keyId}" is missing a non-empty issuer.`,
    );
  }
  if (
    publicKey === null ||
    (typeof publicKey !== "string" && typeof publicKey !== "object") ||
    Array.isArray(publicKey)
  ) {
    throw new ExternalEvidenceError(
      "trusted_keys_invalid",
      `Trusted key "${keyId}" is missing publicKey material.`,
    );
  }
  if (
    !Array.isArray(scopes) ||
    scopes.length === 0 ||
    scopes.some((scope) => typeof scope !== "string" || scope.length === 0)
  ) {
    throw new ExternalEvidenceError(
      "trusted_keys_invalid",
      `Trusted key "${keyId}" must grant at least one non-empty scope.`,
    );
  }

  try {
    if (typeof publicKey === "string") decodeKeyMaterial(publicKey);
  } catch (err) {
    throw new ExternalEvidenceError(
      "trusted_keys_invalid",
      `Trusted key "${keyId}" has invalid Ed25519 public key material: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  return {
    keyId,
    issuer,
    publicKey: publicKey as string | KeyObject,
    scopes: scopes as string[],
    notBefore: optionalTimestamp(entry.notBefore, "notBefore"),
    expiresAt: optionalTimestamp(entry.expiresAt, "expiresAt"),
    revokedAt: optionalTimestamp(entry.revokedAt, "revokedAt"),
    label: typeof entry.label === "string" ? entry.label : undefined,
  };
}

/**
 * Parse `EXTERNAL_EVIDENCE_TRUSTED_KEYS`. Accepts a JSON array or
 * `{"keys": [...]}`. Invalid configuration fails closed with a 503.
 */
export function parseTrustedExternalEvidenceKeys(
  raw: string | unknown,
): TrustedExternalEvidenceKey[] {
  let parsed: unknown;
  if (typeof raw === "string") {
    try {
      parsed = JSON.parse(raw);
    } catch (err) {
      throw new ExternalEvidenceError(
        "trusted_keys_invalid",
        `EXTERNAL_EVIDENCE_TRUSTED_KEYS is not valid JSON: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  } else {
    parsed = raw;
  }

  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    parsed = (parsed as Record<string, unknown>).keys;
  }
  if (!Array.isArray(parsed)) {
    throw new ExternalEvidenceError(
      "trusted_keys_invalid",
      "EXTERNAL_EVIDENCE_TRUSTED_KEYS must be a JSON array or an object with a keys array.",
    );
  }
  if (parsed.length === 0) {
    throw new ExternalEvidenceError(
      "trusted_keys_unconfigured",
      "No external evidence keys are trusted; refusing every import.",
    );
  }
  return parsed.map(parseTrustedKey);
}

/** Load and validate the registry from the environment. */
export function loadTrustedExternalEvidenceKeys(
  env: NodeJS.ProcessEnv = process.env,
): TrustedExternalEvidenceKey[] {
  const raw = env.EXTERNAL_EVIDENCE_TRUSTED_KEYS;
  if (!raw) {
    throw new ExternalEvidenceError(
      "trusted_keys_unconfigured",
      "EXTERNAL_EVIDENCE_TRUSTED_KEYS is not configured; refusing every import.",
    );
  }
  return parseTrustedExternalEvidenceKeys(raw);
}

// ---------------------------------------------------------------------------
// Replay stores
// ---------------------------------------------------------------------------

/** Single-instance store for tests and local verification only. */
export function createMemoryExternalEvidenceStore(): ExternalEvidenceReplayStore {
  const byEvidenceId = new Map<string, StoredExternalEvidence>();
  const byNonce = new Map<string, StoredExternalEvidence>();
  const nonceKey = (issuer: string, nonce: string) => `${issuer}\u0000${nonce}`;

  return {
    async findByEvidenceId(evidenceId) {
      return byEvidenceId.get(evidenceId) ?? null;
    },
    async findByNonce(issuer, nonce) {
      return byNonce.get(nonceKey(issuer, nonce)) ?? null;
    },
    async insert(record) {
      if (byEvidenceId.has(record.evidenceId)) return false;
      if (byNonce.has(nonceKey(record.issuer, record.nonce))) return false;
      byEvidenceId.set(record.evidenceId, record);
      byNonce.set(nonceKey(record.issuer, record.nonce), record);
      return true;
    },
  };
}

/**
 * MongoDB-backed store. The unique indexes on `evidenceId` and
 * `(issuer, nonce)` make concurrent duplicate imports safe across instances;
 * `insert` reports a constraint violation instead of throwing.
 */
export function createMongoExternalEvidenceStore(
  model: mongoose.Model<any> = ExternalEvidenceRecord,
): ExternalEvidenceReplayStore {
  return {
    async findByEvidenceId(evidenceId) {
      const record = await model.findOne({ evidenceId }).lean();
      return (record as StoredExternalEvidence | null) ?? null;
    },
    async findByNonce(issuer, nonce) {
      const record = await model.findOne({ issuer, nonce }).lean();
      return (record as StoredExternalEvidence | null) ?? null;
    },
    async insert(record) {
      try {
        await model.create(record);
        return true;
      } catch (err) {
        if ((err as { code?: number }).code === 11000) return false;
        throw err;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Verification
// ---------------------------------------------------------------------------

export interface VerifyExternalEvidenceOptions {
  trustedKeys: TrustedExternalEvidenceKey[] | string;
  store: ExternalEvidenceReplayStore;
  /** Injectable clock, milliseconds or Date. */
  now?: number | Date;
  /** Tolerated clock skew for issuedAt/expiry checks (default 5 minutes). */
  clockSkewMs?: number;
  /** Maximum accepted age of an unexpired envelope (default 30 days; null disables). */
  maxAgeMs?: number | null;
}

function requireString(
  value: unknown,
  field: string,
  maxLength = 2048,
): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ExternalEvidenceError(
      "invalid_envelope",
      `Envelope field "${field}" must be a non-empty string.`,
      { field },
    );
  }
  if (value.length > maxLength) {
    throw new ExternalEvidenceError(
      "invalid_envelope",
      `Envelope field "${field}" exceeds ${maxLength} characters.`,
      { field },
    );
  }
  return value.trim();
}

function normalizeEnvelope(input: unknown): ExternalEvidenceEnvelope {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ExternalEvidenceError("invalid_envelope", "Evidence envelope must be a JSON object.");
  }
  const raw = input as Record<string, unknown>;
  if (!("payload" in raw) || raw.payload === undefined) {
    throw new ExternalEvidenceError("invalid_envelope", 'Envelope field "payload" is required.');
  }

  const payloadHash = requireString(raw.payloadHash, "payloadHash", 64).toLowerCase();
  if (!/^[a-f0-9]{64}$/.test(payloadHash)) {
    throw new ExternalEvidenceError(
      "invalid_envelope",
      'Envelope field "payloadHash" must be a 64-character SHA-256 hex digest.',
      { field: "payloadHash" },
    );
  }

  const signature = requireString(raw.signature, "signature", 512);
  let signatureBytes: Buffer;
  try {
    signatureBytes = Buffer.from(signature, "base64");
  } catch {
    throw new ExternalEvidenceError("invalid_envelope", 'Envelope field "signature" is not valid base64.');
  }
  if (signatureBytes.length !== 64) {
    throw new ExternalEvidenceError(
      "invalid_envelope",
      'Envelope field "signature" must decode to a 64-byte Ed25519 signature.',
      { field: "signature" },
    );
  }

  const issuedAt = requireString(raw.issuedAt, "issuedAt");
  const expiresAt =
    raw.expiresAt === undefined || raw.expiresAt === null
      ? undefined
      : requireString(raw.expiresAt, "expiresAt");

  return {
    evidenceId: requireString(raw.evidenceId, "evidenceId", 200),
    issuer: requireString(raw.issuer, "issuer", 200),
    scope: requireString(raw.scope, "scope", 200),
    payload: raw.payload,
    payloadHash,
    issuedAt,
    ...(expiresAt !== undefined ? { expiresAt } : {}),
    nonce: requireString(raw.nonce, "nonce", 200),
    keyId: requireString(raw.keyId, "keyId", 200),
    signature,
  };
}

function timestampMs(
  value: string,
  field: string,
  code: ExternalEvidenceErrorCode = "invalid_envelope",
): number {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) {
    throw new ExternalEvidenceError(
      code,
      `${code === "trusted_keys_invalid" ? "Trusted key field" : "Envelope field"} "${field}" must be an ISO-8601 timestamp.`,
      { field },
    );
  }
  return ms;
}

function publicKeyOf(key: TrustedExternalEvidenceKey): KeyObject {
  try {
    return typeof key.publicKey === "string"
      ? decodeKeyMaterial(key.publicKey)
      : key.publicKey;
  } catch (err) {
    throw new ExternalEvidenceError(
      "trusted_keys_invalid",
      `Trusted key "${key.keyId}" has unusable public key material: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

function scopeAllowed(granted: string[], required: string): boolean {
  return granted.some((scope) => {
    if (scope === "*" || scope === required) return true;
    return scope.endsWith("*") && required.startsWith(scope.slice(0, -1));
  });
}

function normalizeTrustedKeys(
  input: TrustedExternalEvidenceKey[] | string,
): TrustedExternalEvidenceKey[] {
  if (typeof input === "string") return parseTrustedExternalEvidenceKeys(input);
  if (!Array.isArray(input) || input.length === 0) {
    throw new ExternalEvidenceError(
      "trusted_keys_unconfigured",
      "No external evidence keys are trusted; refusing every import.",
    );
  }
  return input;
}

function toVerified(
  record: StoredExternalEvidence,
  duplicate: boolean,
): VerifiedExternalEvidence {
  return {
    evidenceId: record.evidenceId,
    issuer: record.issuer,
    scope: record.scope,
    keyId: record.keyId,
    nonce: record.nonce,
    payloadHash: record.payloadHash,
    fingerprint: record.fingerprint,
    payload: record.payload,
    issuedAt: new Date(record.issuedAt).toISOString(),
    expiresAt: record.expiresAt ? new Date(record.expiresAt).toISOString() : null,
    receivedAt: new Date(record.receivedAt).toISOString(),
    status: "verified",
    duplicate,
  };
}

async function storeCall<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    if (err instanceof ExternalEvidenceError) throw err;
    throw new ExternalEvidenceError(
      "replay_store_unavailable",
      `External evidence replay store is unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }
}

/**
 * Verify an envelope and persist it exactly once. Throws
 * {@link ExternalEvidenceError} with a stable code and HTTP status; callers
 * must not persist failed evidence.
 */
export async function verifyExternalEvidence(
  input: unknown,
  options: VerifyExternalEvidenceOptions,
): Promise<VerifiedExternalEvidence> {
  const envelope = normalizeEnvelope(input);
  const keys = normalizeTrustedKeys(options.trustedKeys);
  const key = keys.find((entry) => entry.keyId === envelope.keyId);
  if (!key) {
    throw new ExternalEvidenceError(
      "unknown_key",
      `Key "${envelope.keyId}" is not trusted for external evidence.`,
      { keyId: envelope.keyId },
    );
  }

  const now = options.now instanceof Date ? options.now.getTime() : options.now ?? Date.now();
  const skew = options.clockSkewMs ?? 5 * 60_000;
  const maxAgeMs = options.maxAgeMs === undefined ? 30 * 24 * 60 * 60_000 : options.maxAgeMs;

  if (key.revokedAt) {
    const revokedAt = timestampMs(key.revokedAt, "revokedAt", "trusted_keys_invalid");
    if (revokedAt <= now + skew) {
      throw new ExternalEvidenceError(
        "revoked_key",
        `Key "${key.keyId}" was revoked at ${key.revokedAt}.`,
        { keyId: key.keyId },
      );
    }
  }
  if (key.notBefore) {
    const notBefore = timestampMs(key.notBefore, "notBefore", "trusted_keys_invalid");
    if (notBefore > now + skew) {
      throw new ExternalEvidenceError(
        "key_not_yet_valid",
        `Key "${key.keyId}" is not valid before ${key.notBefore}.`,
        { keyId: key.keyId },
      );
    }
  }
  if (key.expiresAt) {
    const keyExpiry = timestampMs(key.expiresAt, "expiresAt", "trusted_keys_invalid");
    if (keyExpiry < now - skew) {
      throw new ExternalEvidenceError(
        "key_expired",
        `Key "${key.keyId}" expired at ${key.expiresAt}.`,
        { keyId: key.keyId },
      );
    }
  }

  if (key.issuer !== envelope.issuer) {
    throw new ExternalEvidenceError(
      "issuer_mismatch",
      `Key "${key.keyId}" belongs to issuer "${key.issuer}", not "${envelope.issuer}".`,
      { keyId: key.keyId, expectedIssuer: key.issuer, receivedIssuer: envelope.issuer },
    );
  }
  if (!scopeAllowed(key.scopes, envelope.scope)) {
    throw new ExternalEvidenceError(
      "scope_not_allowed",
      `Key "${key.keyId}" is not granted scope "${envelope.scope}".`,
      { keyId: key.keyId, scope: envelope.scope, grantedScopes: key.scopes },
    );
  }

  const issuedAtMs = timestampMs(envelope.issuedAt, "issuedAt");
  if (issuedAtMs > now + skew) {
    throw new ExternalEvidenceError(
      "evidence_from_future",
      `Evidence was issued at ${envelope.issuedAt}, which is in the future.`,
      { issuedAt: envelope.issuedAt },
    );
  }
  if (maxAgeMs !== null && issuedAtMs < now - maxAgeMs - skew) {
    throw new ExternalEvidenceError(
      "evidence_too_old",
      `Evidence was issued at ${envelope.issuedAt}, older than the ${maxAgeMs}ms acceptance window.`,
      { issuedAt: envelope.issuedAt, maxAgeMs },
    );
  }

  let expiresAtMs: number | null = null;
  if (envelope.expiresAt !== undefined) {
    expiresAtMs = timestampMs(envelope.expiresAt, "expiresAt");
    if (expiresAtMs <= issuedAtMs) {
      throw new ExternalEvidenceError(
        "invalid_envelope",
        '"expiresAt" must be later than "issuedAt".',
        { issuedAt: envelope.issuedAt, expiresAt: envelope.expiresAt },
      );
    }
    if (expiresAtMs < now - skew) {
      throw new ExternalEvidenceError(
        "evidence_expired",
        `Evidence expired at ${envelope.expiresAt}.`,
        { expiresAt: envelope.expiresAt },
      );
    }
  }

  const expectedHash = computeEvidencePayloadHash(envelope.payload);
  if (expectedHash !== envelope.payloadHash) {
    throw new ExternalEvidenceError(
      "payload_hash_mismatch",
      "payloadHash does not match SHA-256 of canonicalJson(payload).",
      { expectedHash, receivedHash: envelope.payloadHash },
    );
  }

  let signatureValid: boolean;
  try {
    signatureValid = verify(
      null,
      Buffer.from(externalEvidenceSigningInput(envelope), "utf8"),
      publicKeyOf(key),
      Buffer.from(envelope.signature, "base64"),
    );
  } catch (err) {
    if (err instanceof ExternalEvidenceError) throw err;
    throw new ExternalEvidenceError(
      "invalid_signature",
      `Ed25519 signature verification failed: ${
        err instanceof Error ? err.message : String(err)
      }`,
      { keyId: envelope.keyId, issuer: envelope.issuer },
    );
  }
  if (!signatureValid) {
    throw new ExternalEvidenceError(
      "invalid_signature",
      "Ed25519 signature verification failed.",
      { keyId: envelope.keyId, issuer: envelope.issuer },
    );
  }

  const fingerprint = createHash("sha256")
    .update(canonicalJson(envelope))
    .digest("hex");

  const existing = await storeCall(() => options.store.findByEvidenceId(envelope.evidenceId));
  if (existing) {
    if (existing.fingerprint === fingerprint) return toVerified(existing, true);
    throw new ExternalEvidenceError(
      "evidence_conflict",
      `Evidence "${envelope.evidenceId}" was already verified with different content.`,
      {
        evidenceId: envelope.evidenceId,
        existingFingerprint: existing.fingerprint,
        receivedFingerprint: fingerprint,
      },
    );
  }

  const nonceOwner = await storeCall(() =>
    options.store.findByNonce(envelope.issuer, envelope.nonce),
  );
  if (nonceOwner) {
    // A concurrent identical import can lose the insert race: the other
    // verifier stored this same envelope, so collapse into that record instead
    // of reporting its nonce as reused.
    if (nonceOwner.fingerprint === fingerprint) {
      return toVerified(nonceOwner, true);
    }
    throw new ExternalEvidenceError(
      "nonce_reuse",
      `Nonce "${envelope.nonce}" was already used by evidence "${nonceOwner.evidenceId}".`,
      { issuer: envelope.issuer, nonce: envelope.nonce, existingEvidenceId: nonceOwner.evidenceId },
    );
  }

  const stored: StoredExternalEvidence = {
    evidenceId: envelope.evidenceId,
    issuer: envelope.issuer,
    scope: envelope.scope,
    keyId: envelope.keyId,
    nonce: envelope.nonce,
    payloadHash: envelope.payloadHash,
    fingerprint,
    payload: envelope.payload,
    issuedAt: new Date(issuedAtMs),
    expiresAt: expiresAtMs === null ? null : new Date(expiresAtMs),
    receivedAt: new Date(now),
    status: "verified",
  };

  const inserted = await storeCall(() => options.store.insert(stored));
  if (inserted) return toVerified(stored, false);

  // A concurrent writer won the unique-index race. It is a safe retry only
  // when the bytes match; otherwise report the conflict the loser represents.
  const raced = await storeCall(() => options.store.findByEvidenceId(envelope.evidenceId));
  if (raced && raced.fingerprint === fingerprint) return toVerified(raced, true);
  if (raced) {
    throw new ExternalEvidenceError(
      "evidence_conflict",
      `Evidence "${envelope.evidenceId}" was verified concurrently with different content.`,
      {
        evidenceId: envelope.evidenceId,
        existingFingerprint: raced.fingerprint,
        receivedFingerprint: fingerprint,
      },
    );
  }
  const racedNonce = await storeCall(() =>
    options.store.findByNonce(envelope.issuer, envelope.nonce),
  );
  if (racedNonce) {
    throw new ExternalEvidenceError(
      "nonce_reuse",
      `Nonce "${envelope.nonce}" was already used by evidence "${racedNonce.evidenceId}".`,
      { issuer: envelope.issuer, nonce: envelope.nonce },
    );
  }
  throw new ExternalEvidenceError(
    "replay_store_unavailable",
    "Replay store rejected the evidence without a detectable duplicate.",
  );
}
