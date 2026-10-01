/**
 * settlement_poll — polls Soroban/RPC for settlement confirmation of a pending purchase,
 * then creates/updates the Purchase record and entitlement state.
 *
 * This job is idempotent: if the purchase is already marked settled, it no-ops.
 * Keep payload small (versioned).
 */
import type { JobRecordDTO } from "../types";

export async function handleSettlementPoll(job: JobRecordDTO): Promise<void> {
  const { promptId, purchaseId, buyerWallet, txHash } = job.payload as any;
  if (!promptId || !purchaseId || !buyerWallet) {
    throw new Error(`settlement_poll missing required fields: promptId, purchaseId, buyerWallet`);
  }

  // In production, this would:
  // 1) Fetch transaction status from Horizon/RPC by txHash
  // 2) If SUCCESS, upsert Purchase and trigger entitlement indexing
  // 3) If PENDING, throw to trigger retry (backoff)
  // 4) If FAILED, mark purchase failed (no retry)
  //
  // For the skeleton, we simulate with Purchase lookup when available.
  try {
    const Purchase = (await import("../../models/Purchase")).default;
    const existing = await Purchase.findOne({ promptId: String(promptId), buyerWallet: String(buyerWallet).toLowerCase() });
    if (existing && existing.status === "purchased" && existing.txHash) {
      // Already settled — idempotent no-op
      return;
    }
    // If txHash is present we consider it settled for demo purposes; otherwise ask for retry
    if (!txHash) {
      throw new Error(`Settlement not yet confirmed for purchase ${purchaseId} — will retry`);
    }
    // Upsert a settled purchase record (idempotent)
    await Purchase.findOneAndUpdate(
      { promptId: String(promptId), buyerWallet: String(buyerWallet).toLowerCase() },
      { $setOnInsert: { promptId: String(promptId), buyerWallet: String(buyerWallet).toLowerCase(), versionIndex: 1, txHash: String(txHash), status: "purchased" } },
      { upsert: true, new: true }
    );
  } catch (err: any) {
    if (err.message?.includes("will retry")) throw err;
    // Mongoose not connected in some test envs — treat as retryable
    if (err.message?.includes("not connected") || err.name === "MongooseError") {
      throw new Error(`DB not ready for settlement_poll — will retry: ${err.message}`);
    }
    throw err;
  }
}
