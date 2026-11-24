/**
 * Mongo-backed implementation of the entitlement repair port (#1129).
 *
 * Writes go through the same functions as the single-purchase repair
 * (`repairEntitlementForPurchase`): grant for active, revoke for refunded, and a
 * throw-on-error audit record naming the operator.
 */

import mongoose from "mongoose";
import Purchase from "../models/Purchase";
import { Entitlement, type EntitlementStatus } from "../models/Entitlement";
import { recordAuditEvent } from "./auditTrail";
import { grantEntitlement, revokeEntitlement } from "./entitlementService";
import {
  entitlementKey,
  type EntitlementKey,
  type EntitlementRepairPort,
  type RepairPurchase,
} from "./entitlementRepairJob";

export function mongoEntitlementRepairPort(): EntitlementRepairPort {
  return {
    async listPurchases(after, limit) {
      // _id is an ObjectId; comparing it with a raw string would match nothing.
      const filter: Record<string, unknown> = {};
      if (after) filter._id = { $gt: new mongoose.Types.ObjectId(after) };
      const docs = await Purchase.find(filter).sort({ _id: 1 }).limit(limit).lean();
      return docs.map(
        (d: any): RepairPurchase => ({
          _id: String(d._id),
          buyerWallet: d.buyerWallet ?? null,
          promptId: d.promptId ?? null,
          txHash: d.txHash ?? null,
          status: d.status ?? null,
          disputeResolution: d.disputeResolution ?? null,
        }),
      );
    },

    async currentStatuses(keys: EntitlementKey[]) {
      const rows = await Entitlement.find({
        $or: keys.map((k) => ({ userAddress: k.userAddress, promptId: k.promptId })),
      }).lean();
      const out = new Map<string, EntitlementStatus | null>();
      for (const row of rows as Array<{ userAddress: string; promptId: string; status: EntitlementStatus }>) {
        out.set(entitlementKey({ userAddress: row.userAddress, promptId: row.promptId }), row.status);
      }
      return out;
    },

    async writeEntitlement(input) {
      if (input.status === "refunded") {
        await revokeEntitlement(input.userAddress, input.promptId, "Repair: purchase refunded", "refunded");
      } else {
        await grantEntitlement(input.userAddress, input.promptId, input.sourceRef);
      }

      await recordAuditEvent(
        {
          action: "entitlement_repair",
          result: "success",
          promptId: input.promptId,
          walletAddress: input.userAddress,
          actor: input.actor,
          target: input.purchaseId,
          targetType: "purchase",
          beforeState: { entitlementStatus: input.before },
          afterState: { entitlementStatus: input.status },
          metadata: { mode: "apply", job: "entitlement-repair" },
          reason: "batch_entitlement_repair",
        },
        { throwOnError: true },
      );
    },
  };
}
