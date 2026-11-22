/**
 * Permission-diff reports for role and policy changes (#1036).
 *
 * Every role or policy change is previewed as a deterministic report before
 * it is applied. The report carries a `digest`: SHA-256 over the canonical
 * JSON of the change *and* the state it was computed from. Applying a change
 * requires the caller to echo the digest of the report they reviewed; the
 * server recomputes the report from current state at apply time, so:
 *
 *   - no digest            → `diff_required` (nothing was reviewed)
 *   - digest mismatch      → `stale_diff` (state or request changed since
 *                            review; the caller must re-review the fresh report)
 *
 * The digest is not a secret: it is never trusted, only compared against a
 * value the server derives itself, so it binds "what was reviewed" to "what
 * is applied" without key management.
 */

import { createHash } from "crypto";
import { ROLE_PERMISSIONS } from "../middleware/rbac";
import { canonicalJson } from "./canonicalSerialization";

/**
 * Permissions every self-service role already holds. Anything outside this
 * set — including unknown custom permissions — is privileged. Derived from
 * ROLE_PERMISSIONS so it cannot drift from the role table.
 */
const SELF_SERVICE_PERMISSIONS: ReadonlySet<string> = new Set([
  ...ROLE_PERMISSIONS.buyer,
  ...ROLE_PERMISSIONS.creator,
]);

export function isPrivilegedPermission(permission: string): boolean {
  return !SELF_SERVICE_PERMISSIONS.has(permission);
}

export interface SetDiff {
  added: string[];
  removed: string[];
}

/** O(|before| + |after|) membership diff; outputs are sorted for stable reports. */
export function diffSets(before: ReadonlySet<string>, after: ReadonlySet<string>): SetDiff {
  const added: string[] = [];
  const removed: string[] = [];
  after.forEach((p) => {
    if (!before.has(p)) added.push(p);
  });
  before.forEach((p) => {
    if (!after.has(p)) removed.push(p);
  });
  return { added: added.sort(), removed: removed.sort() };
}

export function diffDigest(subject: unknown): string {
  return createHash("sha256").update(canonicalJson(subject)).digest("hex");
}

export type PermissionDiffErrorCode = "diff_required" | "stale_diff";

export class PermissionDiffError extends Error {
  public readonly apiCode: "PERMISSION_DIFF_REQUIRED" | "STALE_PERMISSION_DIFF";

  constructor(
    public readonly code: PermissionDiffErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PermissionDiffError";
    this.apiCode = code === "diff_required" ? "PERMISSION_DIFF_REQUIRED" : "STALE_PERMISSION_DIFF";
  }
}

/** Throws unless `expected` is the digest of the report computed now. */
export function assertReviewedDiff(expected: unknown, actual: string): void {
  if (typeof expected !== "string" || expected.length === 0) {
    throw new PermissionDiffError(
      "diff_required",
      "Permission-diff report required: preview the change and pass its digest.",
    );
  }
  if (expected !== actual) {
    throw new PermissionDiffError(
      "stale_diff",
      "Stale permission diff: the change or current state differs from the reviewed report.",
    );
  }
}
