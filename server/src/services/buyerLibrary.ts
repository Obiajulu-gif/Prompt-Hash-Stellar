import mongoose from "mongoose";
import Purchase from "../models/Purchase";
import Prompt from "../models/Prompt";
import FulfillmentRecord from "../models/FulfillmentRecord";
import LibraryItem from "../models/LibraryItem";
import LibraryCollection, { MAX_COLLECTIONS_PER_BUYER } from "../models/LibraryCollection";
import {
  deriveEntitlementHealth,
  isEntitled,
  type EntitlementHealth,
} from "../../../src/lib/prompts/entitlementHealth";

/**
 * Buyer library (#784): collections, archive state, search, and entitlement
 * health for a buyer's purchased prompts.
 *
 * Every query is scoped to the authenticated buyer's wallet and to prompts
 * that wallet actually purchased, so a library can never surface — or
 * organise — prompts bought by someone else. Library metadata lives in
 * LibraryItem / LibraryCollection; Purchase records are only read.
 */

export class LibraryError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export type ArchivedFilter = "exclude" | "only" | "include";

export interface LibraryFilter {
  q?: string;
  collectionId?: string;
  archived?: ArchivedFilter;
  health?: EntitlementHealth;
}

export interface LibraryEntry {
  promptId: string;
  title: string;
  category: string;
  image: string;
  purchasedAt: Date;
  txHash: string;
  versionIndex: number;
  archived: boolean;
  archivedAt: Date | null;
  collectionIds: string[];
  entitlement: {
    health: EntitlementHealth;
    purchaseStatus: string;
    disputeStatus: string | null;
  };
}

function collectionView(collection: any) {
  return {
    id: String(collection._id),
    name: collection.name,
    description: collection.description ?? "",
    promptIds: collection.promptIds ?? [],
    promptCount: (collection.promptIds ?? []).length,
    updatedAt: collection.updatedAt,
  };
}

function findOwnCollection(buyerWallet: string, collectionId: string) {
  if (!mongoose.isValidObjectId(collectionId)) {
    throw new LibraryError(404, "Collection not found.");
  }
  return LibraryCollection.findOne({ _id: collectionId, buyerWallet });
}

/** Latest purchase per prompt for this buyer, newest first. */
async function latestPurchases(buyerWallet: string, promptIds?: string[]) {
  const rows: any[] = await Purchase.find({
    buyerWallet,
    ...(promptIds ? { promptId: { $in: promptIds } } : {}),
  })
    .sort({ createdAt: -1 })
    .select("promptId txHash versionIndex status disputeResolution createdAt")
    .lean();

  const byPrompt = new Map<string, any>();
  for (const row of rows) {
    const promptId = String(row.promptId);
    if (!byPrompt.has(promptId)) byPrompt.set(promptId, row);
  }
  return byPrompt;
}

/**
 * Prompts the buyer may put in a collection: purchased, and not refunded or
 * revoked. Throws 403 if any requested prompt fails that check.
 */
async function assertEntitledPrompts(buyerWallet: string, promptIds: string[]) {
  if (promptIds.length === 0) return;
  const unique = [...new Set(promptIds.map(String))];
  const [purchases, disputes] = await Promise.all([
    latestPurchases(buyerWallet, unique),
    FulfillmentRecord.find({ buyerWallet, promptId: { $in: unique } })
      .select("promptId status")
      .lean(),
  ]);
  const disputeByPrompt = new Map<string, string>(
    disputes.map((row: any) => [String(row.promptId), row.status]),
  );

  const notAllowed = unique.filter((promptId) => {
    const purchase = purchases.get(promptId);
    if (!purchase) return true;
    return !isEntitled(
      deriveEntitlementHealth({
        purchaseStatus: purchase.status,
        disputeResolution: purchase.disputeResolution,
        disputeStatus: disputeByPrompt.get(promptId) ?? null,
      }),
    );
  });
  if (notAllowed.length > 0) {
    throw new LibraryError(
      403,
      `Only prompts you currently own can be added to a collection: ${notAllowed.join(", ")}`,
    );
  }
}

export async function getBuyerLibrary(wallet: string, filter: LibraryFilter = {}) {
  const buyerWallet = wallet.toLowerCase();

  const [purchases, items, collections, disputes] = await Promise.all([
    latestPurchases(buyerWallet),
    LibraryItem.find({ buyerWallet }).lean(),
    LibraryCollection.find({ buyerWallet }).sort({ name: 1 }).lean(),
    FulfillmentRecord.find({ buyerWallet }).select("promptId status").lean(),
  ]);

  const promptIds = [...purchases.keys()];
  const prompts: any[] = promptIds.length
    ? await Prompt.find({ onChainId: { $in: promptIds } })
        // Listing metadata only — never the prompt content.
        .select("onChainId title category image")
        .lean()
    : [];

  const promptById = new Map(prompts.map((p) => [String(p.onChainId), p]));
  const itemByPrompt = new Map((items as any[]).map((item) => [String(item.promptId), item]));
  const disputeByPrompt = new Map(
    (disputes as any[]).map((row) => [String(row.promptId), String(row.status)]),
  );
  const collectionIdsByPrompt = new Map<string, string[]>();
  for (const collection of collections as any[]) {
    for (const promptId of collection.promptIds ?? []) {
      const ids = collectionIdsByPrompt.get(promptId) ?? [];
      ids.push(String(collection._id));
      collectionIdsByPrompt.set(promptId, ids);
    }
  }

  let entries: LibraryEntry[] = promptIds.map((promptId) => {
    const purchase = purchases.get(promptId);
    const prompt = promptById.get(promptId);
    const item = itemByPrompt.get(promptId);
    const disputeStatus = disputeByPrompt.get(promptId) ?? null;
    return {
      promptId,
      title: prompt?.title ?? `Prompt #${promptId}`,
      category: prompt?.category ?? "Other",
      image: prompt?.image ?? "",
      purchasedAt: purchase.createdAt,
      txHash: purchase.txHash ?? "",
      versionIndex: purchase.versionIndex ?? 0,
      archived: Boolean(item?.archived),
      archivedAt: item?.archivedAt ?? null,
      collectionIds: collectionIdsByPrompt.get(promptId) ?? [],
      entitlement: {
        health: deriveEntitlementHealth({
          purchaseStatus: purchase.status,
          disputeResolution: purchase.disputeResolution,
          disputeStatus,
        }),
        purchaseStatus: purchase.status ?? "purchased",
        disputeStatus,
      },
    };
  });

  const archivedCount = entries.filter((entry) => entry.archived).length;

  if (filter.collectionId) {
    const collection = (collections as any[]).find(
      (c) => String(c._id) === filter.collectionId,
    );
    if (!collection) throw new LibraryError(404, "Collection not found.");
    const members = new Set<string>(collection.promptIds ?? []);
    entries = entries.filter((entry) => members.has(entry.promptId));
  }

  const archived = filter.archived ?? "exclude";
  if (archived === "exclude") entries = entries.filter((entry) => !entry.archived);
  if (archived === "only") entries = entries.filter((entry) => entry.archived);

  if (filter.health) {
    entries = entries.filter((entry) => entry.entitlement.health === filter.health);
  }

  const q = filter.q?.trim().toLowerCase();
  if (q) {
    entries = entries.filter(
      (entry) =>
        entry.title.toLowerCase().includes(q) ||
        entry.category.toLowerCase().includes(q) ||
        entry.promptId === q,
    );
  }

  return {
    entries,
    collections: (collections as any[]).map(collectionView),
    counts: { total: promptIds.length, archived: archivedCount },
  };
}

export async function setPromptArchived(wallet: string, promptId: string, archived: boolean) {
  const buyerWallet = wallet.toLowerCase();
  const purchases = await latestPurchases(buyerWallet, [promptId]);
  if (!purchases.has(promptId)) {
    // Same answer whether the prompt exists or was bought by someone else.
    throw new LibraryError(404, "This prompt is not in your library.");
  }

  const item = await LibraryItem.findOneAndUpdate(
    { buyerWallet, promptId },
    { $set: { archived, archivedAt: archived ? new Date() : null } },
    { upsert: true, new: true },
  ).lean();
  return { promptId, archived: Boolean(item?.archived), archivedAt: item?.archivedAt ?? null };
}

export async function createCollection(
  wallet: string,
  input: { name?: unknown; description?: unknown; promptIds?: unknown },
) {
  const buyerWallet = wallet.toLowerCase();
  const name = String(input.name ?? "").trim();
  if (!name) throw new LibraryError(400, "name is required.");
  const promptIds = Array.isArray(input.promptIds) ? input.promptIds.map(String) : [];

  if ((await LibraryCollection.countDocuments({ buyerWallet })) >= MAX_COLLECTIONS_PER_BUYER) {
    throw new LibraryError(409, `You can have at most ${MAX_COLLECTIONS_PER_BUYER} collections.`);
  }
  await assertEntitledPrompts(buyerWallet, promptIds);

  try {
    const created = await LibraryCollection.create({
      buyerWallet,
      name,
      description: String(input.description ?? ""),
      promptIds: [...new Set(promptIds)],
    });
    return collectionView(created);
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new LibraryError(409, "You already have a collection with this name.");
    }
    if (err instanceof mongoose.Error.ValidationError) {
      throw new LibraryError(400, err.message);
    }
    throw err;
  }
}

export async function updateCollection(
  wallet: string,
  collectionId: string,
  input: { name?: unknown; description?: unknown; addPromptIds?: unknown; removePromptIds?: unknown },
) {
  const buyerWallet = wallet.toLowerCase();
  const collection = await findOwnCollection(buyerWallet, collectionId);
  if (!collection) throw new LibraryError(404, "Collection not found.");

  const add = Array.isArray(input.addPromptIds) ? input.addPromptIds.map(String) : [];
  const remove = new Set(Array.isArray(input.removePromptIds) ? input.removePromptIds.map(String) : []);
  await assertEntitledPrompts(buyerWallet, add);

  if (input.name !== undefined) collection.name = String(input.name).trim();
  if (input.description !== undefined) collection.description = String(input.description);
  collection.promptIds = [
    ...new Set([...(collection.promptIds as string[]), ...add].filter((id) => !remove.has(id))),
  ];

  try {
    await collection.save();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw new LibraryError(409, "You already have a collection with this name.");
    }
    if (err instanceof mongoose.Error.ValidationError) {
      throw new LibraryError(400, err.message);
    }
    throw err;
  }
  return collectionView(collection);
}

export async function deleteCollection(wallet: string, collectionId: string) {
  const buyerWallet = wallet.toLowerCase();
  if (!mongoose.isValidObjectId(collectionId)) {
    throw new LibraryError(404, "Collection not found.");
  }
  const result = await LibraryCollection.deleteOne({ _id: collectionId, buyerWallet });
  if (result.deletedCount !== 1) throw new LibraryError(404, "Collection not found.");
}
