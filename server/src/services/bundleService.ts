import { Bundle, IBundle, IPromptSnapshot } from "../models/Bundle";
import { BundlePurchase, IBundlePurchase, IBundleItemEntitlement } from "../models/BundlePurchase";
import { grantEntitlement } from "./entitlementService";
import { recordLedgerEntry } from "./payoutLedgerService";
import Prompt from "../models/Prompt";

export interface CreateBundleInput {
  title: string;
  description?: string;
  creatorAddress: string;
  promptIds: string[];
  bundlePrice?: number;
  discountPercent?: number;
}

export interface PurchaseBundleInput {
  buyerAddress: string;
  bundleId: string;
  txHash: string;
  pricePaid?: number;
  simulatePartialFailurePromptIds?: string[];
}

/**
 * Create a new prompt bundle with content snapshotting.
 * Prevents hidden or deleted prompts from being newly bundled.
 */
export async function createBundle(input: CreateBundleInput): Promise<IBundle> {
  const normalizedCreator = input.creatorAddress.toLowerCase();

  if (!input.promptIds || input.promptIds.length === 0) {
    throw new Error("A bundle must contain at least one prompt listing.");
  }

  // Deduplicate prompt IDs
  const uniquePromptIds = Array.from(new Set(input.promptIds));

  // Validate all prompts exist and are active
  const snapshots: IPromptSnapshot[] = [];
  let calculatedTotalPrice = 0;

  for (const pid of uniquePromptIds) {
    const promptDoc = await Prompt.findOne({
      $or: [{ _id: pid }, { onChainId: pid }, { id: pid }],
    });

    if (!promptDoc) {
      throw new Error(`Cannot bundle prompt '${pid}': Prompt not found.`);
    }

    if (promptDoc.status === "inactive" || promptDoc.status === "deleted" || promptDoc.status === "hidden" || promptDoc.active === false) {
      throw new Error(`Cannot bundle prompt '${pid}': Listing is hidden, deleted, or inactive.`);
    }

    const price = typeof promptDoc.price === "number" ? promptDoc.price : 0;
    calculatedTotalPrice += price;

    snapshots.push({
      promptId: String(promptDoc.onChainId || promptDoc._id || pid),
      title: promptDoc.title || `Prompt #${pid}`,
      price,
      contentHash: promptDoc.contentHash || "0x0",
      activeAtSnapshot: true,
    });
  }

  let finalBundlePrice = input.bundlePrice;
  if (finalBundlePrice === undefined) {
    if (input.discountPercent && input.discountPercent > 0) {
      finalBundlePrice = Number((calculatedTotalPrice * (1 - input.discountPercent / 100)).toFixed(4));
    } else {
      finalBundlePrice = calculatedTotalPrice;
    }
  }

  const bundle = new Bundle({
    title: input.title,
    description: input.description || "",
    creatorAddress: normalizedCreator,
    promptIds: snapshots.map((s) => s.promptId),
    bundlePrice: Number(finalBundlePrice.toFixed(4)),
    status: "active",
    snapshots,
  });

  return await bundle.save();
}

/**
 * Execute atomic bundle purchase with snapshot binding and failure recovery tracking.
 */
export async function purchaseBundle(input: PurchaseBundleInput): Promise<IBundlePurchase> {
  const normalizedBuyer = input.buyerAddress.toLowerCase();
  const bundle = await Bundle.findById(input.bundleId);

  if (!bundle) {
    throw new Error(`Bundle '${input.bundleId}' not found.`);
  }

  if (bundle.status !== "active") {
    throw new Error(`Bundle '${input.bundleId}' is no longer active.`);
  }

  // Check for duplicate transaction
  const existingPurchase = await BundlePurchase.findOne({ txHash: input.txHash });
  if (existingPurchase) {
    return existingPurchase;
  }

  const pricePaid = input.pricePaid !== undefined ? input.pricePaid : bundle.bundlePrice;
  const snapshotAtPurchase = bundle.snapshots.map((s) => ({
    promptId: s.promptId,
    title: s.title,
    price: s.price,
  }));

  const itemEntitlements: IBundleItemEntitlement[] = [];
  let hasFailure = false;
  const simulateFailures = new Set(input.simulatePartialFailurePromptIds || []);

  for (const item of snapshotAtPurchase) {
    if (simulateFailures.has(item.promptId)) {
      hasFailure = true;
      itemEntitlements.push({
        promptId: item.promptId,
        status: "failed",
        errorReason: "Simulated RPC indexer failure during unlock",
      });
      continue;
    }

    try {
      const ent = await grantEntitlement(normalizedBuyer, item.promptId, input.txHash);
      itemEntitlements.push({
        promptId: item.promptId,
        entitlementId: String(ent._id),
        status: "granted",
      });
    } catch (err: any) {
      hasFailure = true;
      itemEntitlements.push({
        promptId: item.promptId,
        status: "failed",
        errorReason: err.message || "Failed to grant entitlement",
      });
    }
  }

  const recoveryStatus = hasFailure ? "partial_failure" : "complete";

  const purchase = new BundlePurchase({
    buyerAddress: normalizedBuyer,
    bundleId: String(bundle._id),
    bundlePricePaid: pricePaid,
    txHash: input.txHash,
    promptSnapshot: snapshotAtPurchase,
    entitlements: itemEntitlements,
    recoveryStatus,
  });

  await purchase.save();

  // Record gross sale & platform fee in ledger
  try {
    await recordLedgerEntry({
      entryType: "sale",
      creatorAddress: bundle.creatorAddress,
      amount: pricePaid,
      referenceId: `bundle_sale_${purchase._id}`,
      description: `Bundle Purchase: ${bundle.title}`,
      stellarTxRef: input.txHash,
    });

    const feeAmount = Number((pricePaid * 0.05).toFixed(4));
    await recordLedgerEntry({
      entryType: "fee",
      creatorAddress: bundle.creatorAddress,
      amount: -feeAmount,
      referenceId: `bundle_fee_${purchase._id}`,
      description: `Platform fee (5%) for Bundle Purchase ${bundle.title}`,
      stellarTxRef: input.txHash,
    });
  } catch (ledgerErr) {
    console.error("Ledger entry recording warning:", ledgerErr);
  }

  return purchase;
}

/**
 * Idempotent recovery for partial bundle unlock failures without double charging.
 */
export async function recoverPartialBundleUnlock(
  buyerAddress: string,
  bundlePurchaseId: string,
): Promise<IBundlePurchase> {
  const normalizedBuyer = buyerAddress.toLowerCase();
  const purchase = await BundlePurchase.findById(bundlePurchaseId);

  if (!purchase) {
    throw new Error(`Bundle purchase '${bundlePurchaseId}' not found.`);
  }

  if (purchase.buyerAddress !== normalizedBuyer) {
    throw new Error("Unauthorized: Buyer address mismatch.");
  }

  if (purchase.recoveryStatus === "complete" || purchase.recoveryStatus === "recovered") {
    return purchase;
  }

  let remainingFailures = 0;

  for (const item of purchase.entitlements) {
    if (item.status === "failed") {
      try {
        const ent = await grantEntitlement(normalizedBuyer, item.promptId, purchase.txHash);
        item.status = "granted";
        item.entitlementId = String(ent._id);
        delete item.errorReason;
      } catch (err: any) {
        remainingFailures++;
        item.errorReason = err.message || "Retry grant entitlement failed";
      }
    }
  }

  if (remainingFailures === 0) {
    purchase.recoveryStatus = "recovered";
  }

  await purchase.save();
  return purchase;
}
