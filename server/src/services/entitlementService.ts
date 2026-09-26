import { Entitlement, IEntitlement, EntitlementStatus } from "../models/Entitlement";
import Purchase from "../models/Purchase";

export interface EntitlementCheckResult {
  hasAccess: boolean;
  status: EntitlementStatus | "none";
  cacheHit: boolean;
  entitlement?: IEntitlement | null;
  revocationReason?: string;
}

export interface RepairReport {
  checkedPurchases: number;
  grantedCount: number;
  revokedCount: number;
  unchangedCount: number;
  timestamp: string;
}

/**
 * Check prompt unlock entitlement using cached entitlement record.
 * Source of truth is Purchase record / on-chain contract.
 */
export async function getEntitlementState(
  userAddress: string,
  promptId: string,
): Promise<EntitlementCheckResult> {
  const normalizedAddress = userAddress.toLowerCase();

  // 1. Cache hit check
  const cached = await Entitlement.findOne({
    userAddress: normalizedAddress,
    promptId: String(promptId),
  });

  if (cached) {
    if (cached.status === "active") {
      return {
        hasAccess: true,
        status: "active",
        cacheHit: true,
        entitlement: cached,
      };
    }
    // Revoked or refunded in cache
    return {
      hasAccess: false,
      status: cached.status,
      cacheHit: true,
      entitlement: cached,
      revocationReason: cached.revocationReason || undefined,
    };
  }

  // 2. Cache miss -> check authoritative Purchase model / source of truth
  const purchase = await Purchase.findOne({
    buyerWallet: normalizedAddress,
    promptId: String(promptId),
  });

  if (!purchase) {
    return {
      hasAccess: false,
      status: "none",
      cacheHit: false,
    };
  }

  // Check if purchase is refunded or disputed
  const isRefunded = purchase.disputeResolution === "refunded" || purchase.status === "refunded";
  const initialStatus: EntitlementStatus = isRefunded ? "refunded" : "active";

  // Create cache entry
  const newEntitlement = await Entitlement.create({
    userAddress: normalizedAddress,
    promptId: String(promptId),
    status: initialStatus,
    grantedAt: purchase.createdAt || new Date(),
    sourceOfTruthRef: purchase.txHash || String(purchase._id),
  });

  return {
    hasAccess: initialStatus === "active",
    status: initialStatus,
    cacheHit: false,
    entitlement: newEntitlement,
  };
}

/**
 * Grant or activate entitlement for a buyer and prompt.
 */
export async function grantEntitlement(
  userAddress: string,
  promptId: string,
  sourceRef: string,
): Promise<IEntitlement> {
  const normalizedAddress = userAddress.toLowerCase();

  return await Entitlement.findOneAndUpdate(
    { userAddress: normalizedAddress, promptId: String(promptId) },
    {
      status: "active",
      grantedAt: new Date(),
      sourceOfTruthRef: sourceRef,
      $unset: { revokedAt: "", revocationReason: "" },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/**
 * Revoke entitlement after refund or moderator action.
 */
export async function revokeEntitlement(
  userAddress: string,
  promptId: string,
  reason: string,
  status: "refunded" | "revoked" = "refunded",
): Promise<IEntitlement | null> {
  const normalizedAddress = userAddress.toLowerCase();

  return await Entitlement.findOneAndUpdate(
    { userAddress: normalizedAddress, promptId: String(promptId) },
    {
      status,
      revokedAt: new Date(),
      revocationReason: reason,
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
}

/**
 * Idempotent consistency repair job comparing purchase records vs entitlement state.
 */
export async function repairEntitlementState(): Promise<RepairReport> {
  const purchases = await Purchase.find({}).lean();
  let grantedCount = 0;
  let revokedCount = 0;
  let unchangedCount = 0;

  for (const purchase of purchases) {
    if (!purchase.buyerWallet || !purchase.promptId) continue;

    const buyerWallet = purchase.buyerWallet.toLowerCase();
    const promptId = String(purchase.promptId);
    const isRefunded = purchase.disputeResolution === "refunded" || purchase.status === "refunded";

    const existing = await Entitlement.findOne({
      userAddress: buyerWallet,
      promptId,
    });

    if (isRefunded) {
      if (!existing || existing.status !== "refunded") {
        await revokeEntitlement(buyerWallet, promptId, "System repair: purchase refunded", "refunded");
        revokedCount++;
      } else {
        unchangedCount++;
      }
    } else {
      if (!existing || existing.status !== "active") {
        await grantEntitlement(buyerWallet, promptId, purchase.txHash || String(purchase._id));
        grantedCount++;
      } else {
        unchangedCount++;
      }
    }
  }

  return {
    checkedPurchases: purchases.length,
    grantedCount,
    revokedCount,
    unchangedCount,
    timestamp: new Date().toISOString(),
  };
}
