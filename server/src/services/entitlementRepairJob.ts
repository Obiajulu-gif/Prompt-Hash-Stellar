/**
 * Batch entitlement repair as a backfill job (#1129).
 *
 * Reconciles each purchase with its buyer's entitlement row: a paid purchase
 * should grant `active`, and a refunded purchase should end `refunded`. The job
 * runs through the operator backfill engine (`backfillEngine.ts`), so it inherits
 * the dry-run default, per-batch checkpoints, and per-record failure isolation.
 *
 * Rules the job keeps:
 *   - `plan` is pure. Current entitlement statuses are resolved in `fetchPage`,
 *     one query per page, so the engine never performs I/O while planning.
 *   - `plan` returns skip once the entitlement already matches the purchase, so a
 *     replayed batch (a crash between `apply` and the checkpoint save) is safe.
 *   - A refund with no entitlement row is skipped. There is nothing to revoke.
 *   - A purchase missing its wallet or prompt is a per-record failure, not a
 *     silent skip.
 *
 * Writes are refused unless the named operator is on the allowlist (see
 * `authorizeRepairWrite`). The CLI enforces this before it connects to the DB.
 */

import type { BackfillJob, BackfillRecord } from "./backfillEngine";
import type { EntitlementStatus } from "../models/Entitlement";

/** Purchase fields the repair needs. */
export interface RepairPurchase {
  _id: string;
  buyerWallet?: string | null;
  promptId?: string | null;
  txHash?: string | null;
  status?: string | null;
  disputeResolution?: string | null;
}

export interface EntitlementKey {
  userAddress: string;
  promptId: string;
}

/**
 * Storage the job needs. The Mongo adapter implements it in production; tests
 * fake it. Keeping the job behind this port lets the policy be tested without a DB.
 */
export interface EntitlementRepairPort {
  /** Purchases with `_id` strictly after `after` (null = start), in `_id` order. */
  listPurchases(after: string | null, limit: number): Promise<RepairPurchase[]>;
  /** Current entitlement status per key. Missing rows map to null. */
  currentStatuses(keys: EntitlementKey[]): Promise<Map<string, EntitlementStatus | null>>;
  /** Writes the desired status and records the audit entry for `actor`. */
  writeEntitlement(input: EntitlementKey & {
    purchaseId: string;
    sourceRef: string;
    before: EntitlementStatus | null;
    status: EntitlementStatus;
    actor: string;
  }): Promise<void>;
}

export const ENTITLEMENT_REPAIR_JOB = "entitlement-repair";

export function entitlementKey(key: EntitlementKey): string {
  return `${key.userAddress}|${key.promptId}`;
}

/** A refunded purchase ends `refunded`; every other purchase should be `active`. */
export function desiredEntitlementStatus(purchase: RepairPurchase): EntitlementStatus {
  return purchase.disputeResolution === "refunded" || purchase.status === "refunded"
    ? "refunded"
    : "active";
}

/** Returns a refusal reason, or null when the operator may write. Pure, so it is unit-tested directly. */
export function authorizeRepairWrite(
  actor: string | undefined,
  allowlist: readonly string[],
): string | null {
  if (!actor || actor.trim() === "") {
    return "Writes require --actor <operator id>.";
  }
  if (allowlist.length === 0) {
    return "Writes are refused: REPAIR_OPERATORS is empty or unset.";
  }
  if (!allowlist.includes(actor.trim())) {
    return `Operator "${actor.trim()}" is not on the REPAIR_OPERATORS allowlist.`;
  }
  return null;
}

interface RepairRecordData extends Record<string, unknown> {
  purchaseId: string;
  userAddress: string | null;
  promptId: string | null;
  sourceRef: string;
  desiredStatus: EntitlementStatus;
  currentStatus: EntitlementStatus | null;
  invalidReason: string | null;
}

export function entitlementRepairJob(port: EntitlementRepairPort, actor: string): BackfillJob {
  return {
    name: ENTITLEMENT_REPAIR_JOB,

    async fetchPage(after, limit) {
      const purchases = await port.listPurchases(after, limit);
      const keys: EntitlementKey[] = [];
      for (const p of purchases) {
        if (p.buyerWallet && p.promptId) {
          keys.push({ userAddress: String(p.buyerWallet).toLowerCase(), promptId: String(p.promptId) });
        }
      }
      const current = keys.length > 0 ? await port.currentStatuses(keys) : new Map();

      return purchases.map((p): BackfillRecord => {
        const hasParties = Boolean(p.buyerWallet && p.promptId);
        const userAddress = hasParties ? String(p.buyerWallet).toLowerCase() : null;
        const promptId = hasParties ? String(p.promptId) : null;
        const data: RepairRecordData = {
          purchaseId: String(p._id),
          userAddress,
          promptId,
          sourceRef: p.txHash || String(p._id),
          desiredStatus: desiredEntitlementStatus(p),
          currentStatus:
            userAddress && promptId
              ? (current.get(entitlementKey({ userAddress, promptId })) ?? null)
              : null,
          invalidReason: hasParties
            ? null
            : `Purchase ${String(p._id)} is missing its buyer wallet or prompt ID`,
        };
        return { id: String(p._id), data };
      });
    },

    plan(record) {
      const data = record.data as RepairRecordData;
      if (data.invalidReason) throw new Error(data.invalidReason);

      if (data.currentStatus === data.desiredStatus) {
        return { kind: "skip", reason: "entitlement already matches the purchase" };
      }
      if (data.desiredStatus === "refunded" && data.currentStatus === null) {
        return { kind: "skip", reason: "refunded purchase has no entitlement to revoke" };
      }
      return { kind: "update", changes: { entitlementStatus: data.desiredStatus } };
    },

    async apply(record, changes) {
      const data = record.data as RepairRecordData;
      await port.writeEntitlement({
        userAddress: data.userAddress as string,
        promptId: data.promptId as string,
        purchaseId: data.purchaseId,
        sourceRef: data.sourceRef,
        before: data.currentStatus,
        status: changes.entitlementStatus as EntitlementStatus,
        actor,
      });
    },
  };
}
