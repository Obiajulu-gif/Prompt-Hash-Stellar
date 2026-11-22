/**
 * Expiring capability grants for sensitive actions (#1171).
 *
 * A capability grant is a short-lived, single-use token that authorizes one
 * named sensitive action against one named resource. It is deliberately
 * narrower than a role or a session:
 *
 *   - it names exactly one action (`prompt.delete`, `payout.release`, ...),
 *   - it names the subject and the resource it may act on,
 *   - it expires after a bounded TTL (default 2 minutes, hard ceiling 15),
 *   - it can be used once, and
 *   - it is revocable before use.
 *
 * The caller receives the raw token exactly once at issuance. Only a SHA-256
 * digest of the token is retained, so a memory dump or an inspection endpoint
 * cannot be replayed. Issuance is authorized by an approver identity that must
 * differ from the subject; the HTTP layer takes that identity from the
 * verified admin token, never from the request body.
 *
 * Relationship to existing controls:
 *   - `stepUpVerification` proves *who* is acting (fresh wallet signature).
 *   - A capability grant proves *what* may be done next, once, and until when.
 *   - `maintainerAccessGrants` / `supportAccess` are time-boxed standing
 *     access; this module is per-action and single-use.
 *
 * Failure direction is always deny: an unknown, expired, revoked, mismatched
 * or already-used grant is refused, and a refusal never consumes the grant.
 * A process restart clears the in-memory store, which invalidates every
 * outstanding grant — the safe direction for this control. See
 * docs/operations/capability-grants.md for edge cases and rollback.
 */

import { createHash, randomBytes, randomUUID } from "crypto";
import { logger } from "./structuredLogger";

/** Actions a capability grant may authorize. Keep this list explicit. */
export const CAPABILITY_ACTIONS = [
  "prompt.delete",
  "payout.release",
  "admin.impersonate",
  "webhook.secret.rotate",
] as const;

export type CapabilityAction = (typeof CAPABILITY_ACTIONS)[number];

export const CAPABILITY_GRANT_DEFAULT_TTL_MS = 2 * 60 * 1000; // 2 minutes
export const CAPABILITY_GRANT_MIN_TTL_MS = 5 * 1000; // 5 seconds
export const CAPABILITY_GRANT_MAX_TTL_MS = 15 * 60 * 1000; // hard ceiling: 15 minutes
export const MIN_CAPABILITY_REASON_LENGTH = 8;
export const CAPABILITY_GRANT_MAX_RESOURCE_LENGTH = 256;
export const CAPABILITY_GRANT_TOKEN_PREFIX = "cap_";

export type CapabilityGrantErrorCode =
  | "invalid_subject"
  | "invalid_approver"
  | "self_approval_forbidden"
  | "invalid_action"
  | "invalid_resource"
  | "invalid_reason"
  | "invalid_ttl";

export class CapabilityGrantError extends Error {
  constructor(
    readonly code: CapabilityGrantErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CapabilityGrantError";
  }
}

export type CapabilityDenialCode =
  | "not_found"
  | "revoked"
  | "expired"
  | "subject_mismatch"
  | "action_mismatch"
  | "resource_mismatch"
  | "already_used";

export interface CapabilityGrantRecord {
  grantId: string;
  /** SHA-256 of the raw token. The token itself is never stored. */
  tokenHash: string;
  subject: string;
  action: string;
  resource: string;
  approver: string;
  reason: string;
  issuedAt: number;
  expiresAt: number;
  usedAt: number | null;
  revokedAt: number | null;
  revokedBy: string | null;
}

export type CapabilityGrantDecision =
  | { ok: true; grant: CapabilityGrantRecord }
  | { ok: false; code: CapabilityDenialCode; message: string };

export interface CapabilityGrantRequest {
  subject: string;
  action: string;
  resource: string;
  approver: string;
  reason: string;
  ttlMs?: number;
}

export interface ValidatedCapabilityGrantRequest {
  subject: string;
  action: CapabilityAction;
  resource: string;
  approver: string;
  reason: string;
  ttlMs: number;
}

export interface IssuedCapabilityGrant {
  grantId: string;
  /** Returned once. Only its digest is retained by the store. */
  token: string;
  subject: string;
  action: CapabilityAction;
  resource: string;
  approver: string;
  reason: string;
  issuedAt: number;
  expiresAt: number;
}

export interface CapabilityGrantSummary {
  grantId: string;
  subject: string;
  action: string;
  resource: string;
  approver: string;
  reason: string;
  issuedAt: string;
  expiresAt: string;
  usedAt: string | null;
  revokedAt: string | null;
  revokedBy: string | null;
  status: "active" | "used" | "revoked" | "expired";
}

function normalizeIdentity(value: unknown): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** SHA-256 digest used as the store key for a raw capability token. */
export function hashCapabilityToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

function generateCapabilityToken(): string {
  return `${CAPABILITY_GRANT_TOKEN_PREFIX}${randomBytes(32).toString("hex")}`;
}

/**
 * Validate an issuance request before any grant exists. The approver must not
 * be the subject (self-approval), the action must be allow-listed, the
 * resource must be a concrete, bounded string, and the TTL is clamped to the
 * supported range — there is no way to mint a long-lived grant.
 */
export function validateCapabilityGrantRequest(
  request: CapabilityGrantRequest,
): ValidatedCapabilityGrantRequest {
  const subject = normalizeIdentity(request.subject);
  if (!subject) {
    throw new CapabilityGrantError("invalid_subject", "subject is required.");
  }

  const approver = normalizeIdentity(request.approver);
  if (!approver) {
    throw new CapabilityGrantError("invalid_approver", "approver is required.");
  }
  if (approver === subject) {
    throw new CapabilityGrantError(
      "self_approval_forbidden",
      "A subject cannot approve their own capability grant.",
    );
  }

  if (!(CAPABILITY_ACTIONS as readonly string[]).includes(request.action)) {
    throw new CapabilityGrantError(
      "invalid_action",
      `action must be one of: ${CAPABILITY_ACTIONS.join(", ")}`,
    );
  }

  const resource = typeof request.resource === "string" ? request.resource.trim() : "";
  if (
    !resource ||
    resource.length > CAPABILITY_GRANT_MAX_RESOURCE_LENGTH ||
    resource.includes("\n")
  ) {
    throw new CapabilityGrantError(
      "invalid_resource",
      `resource must be a single-line identifier of at most ${CAPABILITY_GRANT_MAX_RESOURCE_LENGTH} characters.`,
    );
  }

  const reason = typeof request.reason === "string" ? request.reason.trim() : "";
  if (!reason || reason.length < MIN_CAPABILITY_REASON_LENGTH) {
    throw new CapabilityGrantError(
      "invalid_reason",
      `reason must be at least ${MIN_CAPABILITY_REASON_LENGTH} characters (ticket reference recommended).`,
    );
  }

  const ttlMs = request.ttlMs ?? CAPABILITY_GRANT_DEFAULT_TTL_MS;
  if (
    !Number.isFinite(ttlMs) ||
    !Number.isInteger(ttlMs) ||
    ttlMs < CAPABILITY_GRANT_MIN_TTL_MS ||
    ttlMs > CAPABILITY_GRANT_MAX_TTL_MS
  ) {
    throw new CapabilityGrantError(
      "invalid_ttl",
      `ttlMs must be an integer between ${CAPABILITY_GRANT_MIN_TTL_MS} and ${CAPABILITY_GRANT_MAX_TTL_MS}.`,
    );
  }

  return {
    subject,
    action: request.action as CapabilityAction,
    resource,
    approver,
    reason,
    ttlMs,
  };
}

/**
 * Pure authorization decision for one use of a grant.
 *
 * Order matters: revocation, expiry and use are checked before identity and
 * scope, so an unusable grant cannot be kept alive by a caller that happens to
 * match. A refusal never mutates the record.
 */
export function evaluateCapabilityGrant(
  record: CapabilityGrantRecord | null | undefined,
  context: { subject: string; action: string; resource: string; now: number },
): CapabilityGrantDecision {
  if (!record || !record.grantId) {
    return { ok: false, code: "not_found", message: "Capability grant not found." };
  }
  if (record.revokedAt !== null) {
    return { ok: false, code: "revoked", message: "Capability grant has been revoked." };
  }
  if (!Number.isFinite(record.expiresAt) || context.now >= record.expiresAt) {
    return { ok: false, code: "expired", message: "Capability grant has expired." };
  }
  if (record.usedAt !== null) {
    return { ok: false, code: "already_used", message: "Capability grant has already been used." };
  }
  if (normalizeIdentity(context.subject) !== record.subject) {
    return {
      ok: false,
      code: "subject_mismatch",
      message: "Capability grant belongs to a different subject.",
    };
  }
  if (context.action !== record.action) {
    return {
      ok: false,
      code: "action_mismatch",
      message: "Capability grant authorizes a different action.",
    };
  }
  if (record.resource !== "*" && context.resource !== record.resource) {
    return {
      ok: false,
      code: "resource_mismatch",
      message: "Capability grant authorizes a different resource.",
    };
  }
  return { ok: true, grant: record };
}

export function capabilityGrantStatus(
  record: CapabilityGrantRecord,
  now: number,
): CapabilityGrantSummary["status"] {
  if (record.revokedAt !== null) return "revoked";
  if (record.usedAt !== null) return "used";
  return now < record.expiresAt ? "active" : "expired";
}

/** Public, token-free view of a grant for inspection and audit output. */
export function summarizeCapabilityGrant(
  record: CapabilityGrantRecord,
  now: number,
): CapabilityGrantSummary {
  return {
    grantId: record.grantId,
    subject: record.subject,
    action: record.action,
    resource: record.resource,
    approver: record.approver,
    reason: record.reason,
    issuedAt: new Date(record.issuedAt).toISOString(),
    expiresAt: new Date(record.expiresAt).toISOString(),
    usedAt: record.usedAt === null ? null : new Date(record.usedAt).toISOString(),
    revokedAt: record.revokedAt === null ? null : new Date(record.revokedAt).toISOString(),
    revokedBy: record.revokedBy,
    status: capabilityGrantStatus(record, now),
  };
}

export interface CapabilityGrantStoreOptions {
  maxRecords?: number;
}

/**
 * Bounded in-memory grant store. It holds token digests and metadata only.
 * The store is intentionally process-local: a restart drops every outstanding
 * grant, which fails closed. Multi-replica deployments must issue and consume
 * a grant on the same instance (see the runbook).
 */
export class CapabilityGrantStore {
  private readonly byTokenHash = new Map<string, CapabilityGrantRecord>();
  private readonly byGrantId = new Map<string, CapabilityGrantRecord>();
  private readonly maxRecords: number;

  constructor(options: CapabilityGrantStoreOptions = {}) {
    this.maxRecords = Math.max(1, options.maxRecords ?? 5_000);
  }

  /** Insert a record, evicting the oldest grant when the store is full. */
  add(record: CapabilityGrantRecord): void {
    if (!this.byGrantId.has(record.grantId) && this.byGrantId.size >= this.maxRecords) {
      const oldest = this.byGrantId.keys().next().value;
      if (oldest !== undefined) {
        const evicted = this.byGrantId.get(oldest);
        this.byGrantId.delete(oldest);
        if (evicted) this.byTokenHash.delete(evicted.tokenHash);
      }
    }
    this.byGrantId.set(record.grantId, record);
    this.byTokenHash.set(record.tokenHash, record);
  }

  findByTokenHash(tokenHash: string): CapabilityGrantRecord | undefined {
    return this.byTokenHash.get(tokenHash);
  }

  findByGrantId(grantId: string): CapabilityGrantRecord | undefined {
    return this.byGrantId.get(grantId);
  }

  /** Remove expired, unused grants. Used grants are kept for diagnostics. */
  pruneExpired(now: number): number {
    let removed = 0;
    for (const [grantId, record] of this.byGrantId) {
      if (record.usedAt === null && now >= record.expiresAt) {
        this.byGrantId.delete(grantId);
        this.byTokenHash.delete(record.tokenHash);
        removed += 1;
      }
    }
    return removed;
  }

  reset(): void {
    this.byTokenHash.clear();
    this.byGrantId.clear();
  }

  get size(): number {
    return this.byGrantId.size;
  }
}

export const capabilityGrantStore = new CapabilityGrantStore();

export interface IssueCapabilityGrantOptions {
  store?: CapabilityGrantStore;
  now?: number;
  requestId?: string | null;
}

/**
 * Mint a grant for one action against one resource. The raw token is returned
 * to the caller exactly once; only its digest enters the store.
 */
export function issueCapabilityGrant(
  request: CapabilityGrantRequest,
  options: IssueCapabilityGrantOptions = {},
): IssuedCapabilityGrant {
  const validated = validateCapabilityGrantRequest(request);
  const store = options.store ?? capabilityGrantStore;
  const now = options.now ?? Date.now();
  const grantId = `capg_${randomUUID()}`;
  const token = generateCapabilityToken();
  const expiresAt = now + validated.ttlMs;

  store.add({
    grantId,
    tokenHash: hashCapabilityToken(token),
    subject: validated.subject,
    action: validated.action,
    resource: validated.resource,
    approver: validated.approver,
    reason: validated.reason,
    issuedAt: now,
    expiresAt,
    usedAt: null,
    revokedAt: null,
    revokedBy: null,
  });

  logger.info("Capability grant issued", {
    action: "capabilityGrantIssued",
    grantId,
    capabilityAction: validated.action,
    subject: validated.subject,
    resource: validated.resource,
    expiresAt: new Date(expiresAt).toISOString(),
    requestId: options.requestId ?? undefined,
  });

  return {
    grantId,
    token,
    subject: validated.subject,
    action: validated.action,
    resource: validated.resource,
    approver: validated.approver,
    reason: validated.reason,
    issuedAt: now,
    expiresAt,
  };
}

export interface ConsumeCapabilityGrantContext {
  subject: string;
  action: string;
  resource: string;
  now?: number;
  requestId?: string | null;
}

/**
 * Consume a grant for one action. The lookup, evaluation and mark-used steps
 * run synchronously, so two callers in the same process cannot both win.
 * Every denial leaves `usedAt` untouched; a valid retry after a mismatched
 * call therefore still succeeds.
 */
export function consumeCapabilityGrant(
  token: string,
  context: ConsumeCapabilityGrantContext,
  store: CapabilityGrantStore = capabilityGrantStore,
): CapabilityGrantDecision {
  const now = context.now ?? Date.now();
  const tokenHash = typeof token === "string" && token ? hashCapabilityToken(token) : "";
  const record = tokenHash ? store.findByTokenHash(tokenHash) : undefined;
  const decision = evaluateCapabilityGrant(record, {
    subject: context.subject,
    action: context.action,
    resource: context.resource,
    now,
  });

  if (!decision.ok) {
    logger.warn("Capability grant denied", {
      action: "capabilityGrantDenied",
      code: decision.code,
      capabilityAction: context.action,
      subject: context.subject,
      resource: context.resource,
      requestId: context.requestId ?? undefined,
    });
    return decision;
  }

  record!.usedAt = now;
  logger.info("Capability grant consumed", {
    action: "capabilityGrantConsumed",
    grantId: record!.grantId,
    capabilityAction: record!.action,
    subject: record!.subject,
    resource: record!.resource,
    requestId: context.requestId ?? undefined,
  });
  return { ok: true, grant: record! };
}

export interface RevokeCapabilityGrantResult {
  revoked: boolean;
  grantId: string;
}

/**
 * Revoke a grant before use. Idempotent: an unknown or already-revoked grant
 * returns `revoked: false` and never rewrites the original revocation.
 */
export function revokeCapabilityGrant(
  grantId: string,
  context: { actor: string; now?: number; requestId?: string | null },
  store: CapabilityGrantStore = capabilityGrantStore,
): RevokeCapabilityGrantResult {
  const record = store.findByGrantId(grantId);
  if (!record || record.revokedAt !== null) {
    return { revoked: false, grantId };
  }
  const now = context.now ?? Date.now();
  record.revokedAt = now;
  record.revokedBy = normalizeIdentity(context.actor) || "unknown";
  logger.info("Capability grant revoked", {
    action: "capabilityGrantRevoked",
    grantId,
    revokedBy: record.revokedBy,
    requestId: context.requestId ?? undefined,
  });
  return { revoked: true, grantId };
}

/** Inspection helper. Never returns a token or its digest. */
export function inspectCapabilityGrant(
  grantId: string,
  now: number = Date.now(),
  store: CapabilityGrantStore = capabilityGrantStore,
): CapabilityGrantSummary | null {
  const record = store.findByGrantId(grantId);
  return record ? summarizeCapabilityGrant(record, now) : null;
}

/** Plain-language remedy returned with each denial code. */
export function capabilityGrantRemedy(code: CapabilityDenialCode): string {
  switch (code) {
    case "not_found":
      return "The capability token is unknown. Request a new capability grant.";
    case "revoked":
      return "The capability grant was revoked. Request a new capability grant.";
    case "expired":
      return "The capability grant has expired. Request a new capability grant.";
    case "already_used":
      return "The capability grant was already used. Request a new capability grant.";
    case "subject_mismatch":
      return "The capability grant was issued to a different subject.";
    case "action_mismatch":
      return "The capability grant authorizes a different action.";
    case "resource_mismatch":
      return "The capability grant authorizes a different resource.";
  }
}
