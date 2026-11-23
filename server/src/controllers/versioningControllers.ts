import { Request, Response } from "express";
import connectDb from "../db/connectDb";
import Prompt from "../models/Prompt";
import PromptVersion from "../models/PromptVersion";
import Purchase from "../models/Purchase";
import User from "../models/User";
import { deliverNotification } from "../services/notificationRouting";

/**
 * Authorization matrix for prompt lifecycle operations.
 *
 * The matrix is exported as data so it can be executed by the test suite
 * (see server/src/__tests__/versioningAuthorization.matrix.test.ts) and is also
 * enforced at runtime by the controllers below.
 *
 * To extend: add an entry to `AUTHORIZATION_MATRIX` with the actor,
 * operation, expected outcome, and the reason. The test suite iterates
 * this array, so no test changes are required.
 */

export type AuthActor = "anonymous" | "creator" | "buyer" | "moderator" | "administrator" | "other";

export type AuthOperation =
  | "postPromptUpdate"
  | "recordPurchase"
  | "getBuyerVersion"
  | "getPromptVersions"
  | "transferOwnership"
  | "administrativeAction";

export type AuthOutcome = "allowed" | "denied";

export interface AuthMatrixEntry {
  actor: AuthActor;
  operation: AuthOperation;
  outcome: AuthOutcome;
  /** HTTP status the controller must return for this case. */
  status: number;
  /** Human-readable justification, used in failure messages. */
  reason: string;
}

export const AUTHORIZATION_MATRIX: readonly AuthMatrixEntry[] = [
  // Post prompt update (creator-only)
  { actor: "anonymous", operation: "postPromptUpdate", outcome: "denied", status: 401, reason: "anonymous users cannot post updates" },
  { actor: "creator", operation: "postPromptUpdate", outcome: "allowed", status: 201, reason: "owner may post new versions" },
  { actor: "buyer", operation: "postPromptUpdate", outcome: "denied", status: 403, reason: "buyers do not own the prompt" },
  { actor: "moderator", operation: "postPromptUpdate", outcome: "denied", status: 403, reason: "moderators cannot edit creator content" },
  { actor: "administrator", operation: "postPromptUpdate", outcome: "denied", status: 403, reason: "admins must use administrative actions, not creator endpoints" },
  { actor: "other", operation: "postPromptUpdate", outcome: "denied", status: 403, reason: "cross-user updates are forbidden" },

  // Record purchase (buyer-only, self-purchase denied)
  { actor: "anonymous", operation: "recordPurchase", outcome: "denied", status: 401, reason: "anonymous users cannot record purchases" },
  { actor: "creator", operation: "recordPurchase", outcome: "denied", status: 403, reason: "creators cannot purchase their own prompt" },
  { actor: "buyer", operation: "recordPurchase", outcome: "allowed", status: 201, reason: "buyers may record a purchase" },
  { actor: "moderator", operation: "recordPurchase", outcome: "denied", status: 403, reason: "moderators are not buyers" },
  { actor: "administrator", operation: "recordPurchase", outcome: "denied", status: 403, reason: "admins cannot act as buyers through this endpoint" },
  { actor: "other", operation: "recordPurchase", outcome: "allowed", status: 201, reason: "any authenticated non-owner may buy" },

  // Get buyer version (purchase-gated)
  { actor: "anonymous", operation: "getBuyerVersion", outcome: "denied", status: 401, reason: "anonymous users cannot read purchased content" },
  { actor: "creator", operation: "getBuyerVersion", outcome: "denied", status: 403, reason: "creators do not hold a purchase record" },
  { actor: "buyer", operation: "getBuyerVersion", outcome: "allowed", status: 200, reason: "purchasers may read their purchased version" },
  { actor: "moderator", operation: "getBuyerVersion", outcome: "denied", status: 403, reason: "moderators do not hold a purchase record" },
  { actor: "administrator", operation: "getBuyerVersion", outcome: "denied", status: 403, reason: "admins do not hold a purchase record" },
  { actor: "other", operation: "getBuyerVersion", outcome: "denied", status: 403, reason: "cross-user purchase reads are forbidden" },

  // Get prompt versions (public metadata)
  { actor: "anonymous", operation: "getPromptVersions", outcome: "allowed", status: 200, reason: "version metadata is public" },
  { actor: "creator", operation: "getPromptVersions", outcome: "allowed", status: 200, reason: "version metadata is public" },
  { actor: "buyer", operation: "getPromptVersions", outcome: "allowed", status: 200, reason: "version metadata is public" },
  { actor: "moderator", operation: "getPromptVersions", outcome: "allowed", status: 200, reason: "version metadata is public" },
  { actor: "administrator", operation: "getPromptVersions", outcome: "allowed", status: 200, reason: "version metadata is public" },
  { actor: "other", operation: "getPromptVersions", outcome: "allowed", status: 200, reason: "version metadata is public" },

  // Transfer ownership (current owner or admin)
  { actor: "anonymous", operation: "transferOwnership", outcome: "denied", status: 401, reason: "anonymous users cannot transfer ownership" },
  { actor: "creator", operation: "transferOwnership", outcome: "allowed", status: 200, reason: "owner may transfer ownership" },
  { actor: "buyer", operation: "transferOwnership", outcome: "denied", status: 403, reason: "buyers do not own the prompt" },
  { actor: "moderator", operation: "transferOwnership", outcome: "denied", status: 403, reason: "moderators cannot transfer ownership" },
  { actor: "administrator", operation: "transferOwnership", outcome: "allowed", status: 200, reason: "admins may transfer ownership" },
  { actor: "other", operation: "transferOwnership", outcome: "denied", status: 403, reason: "cross-user ownership transfers are forbidden" },

  // Administrative action (admin-only)
  { actor: "anonymous", operation: "administrativeAction", outcome: "denied", status: 401, reason: "anonymous users cannot perform admin actions" },
  { actor: "creator", operation: "administrativeAction", outcome: "denied", status: 403, reason: "creators are not admins" },
  { actor: "buyer", operation: "administrativeAction", outcome: "denied", status: 403, reason: "buyers are not admins" },
  { actor: "moderator", operation: "administrativeAction", outcome: "denied", status: 403, reason: "moderators are not admins" },
  { actor: "administrator", operation: "administrativeAction", outcome: "allowed", status: 200, reason: "admins may perform admin actions" },
  { actor: "other", operation: "administrativeAction", outcome: "denied", status: 403, reason: "non-admins cannot perform admin actions" },
] as const;

/**
 * Resolve the actor role for a request based on the authenticated user and
 * the prompt being acted on. Roles are read from the database on every
 * request so stale-role cases (e.g. a demoted moderator) are rejected.
 */
export async function resolveActor(
  walletAddress: string | undefined | null,
  options: { promptId?: string; requiredOperation?: AuthOperation } = {},
): Promise<{ actor: AuthActor; user: any | null }> {
  if (!walletAddress) {
    return { actor: "anonymous", user: null };
  }

  const normalized = walletAddress.toLowerCase();
  const user = await User.findOne({ walletAddress: normalized });
  if (!user) {
    return { actor: "anonymous", user: null };
  }

  // Role is always re-read from the database; stale roles in tokens are
  // ignored. Admins take precedence over moderators.
  if (user.role === "administrator") {
    return { actor: "administrator", user };
  }
  if (user.role === "moderator") {
    return { actor: "moderator", user };
  }

  if (options.promptId) {
    const prompt = await Prompt.findById(options.promptId).select("owner").lean();
    if (prompt && String((prompt as any).owner) === String(user._id)) {
      return { actor: "creator", user };
    }

    const purchase = await Purchase.findOne({
      promptId: options.promptId,
      buyerWallet: normalized,
    }).lean();
    if (purchase) {
      return { actor: "buyer", user };
    }
  }

  return { actor: "other", user };
}

/**
 * Returns the matrix entry for the given actor/operation pair. Throws if the
 * combination is not covered, forcing new operations to extend the matrix.
 */
export function getMatrixEntry(actor: AuthActor, operation: AuthOperation): AuthMatrixEntry {
  const entry = AUTHORIZATION_MATRIX.find((e) => e.actor === actor && e.operation === operation);
  if (!entry) {
    throw new Error(`No authorization matrix entry for ${actor}/${operation}`);
  }
  return entry;
}

/**
 * Consistent, redacted denial response. Does not leak who owns the prompt
 * or whether a purchase exists for another wallet.
 */
function deny(res: Response, status: number, message = "Not authorized."): Response {
  return res.status(status).json({ error: message });
}

function denyResponse(res: Response, operation: AuthOperation, actor: AuthActor): Response {
  const entry = getMatrixEntry(actor, operation);
  if (entry.outcome !== "denied") {
    throw new Error(`Attempted to deny an allowed operation ${operation} for ${actor}`);
  }
  return deny(res, entry.status);
}

export const PostPromptUpdate = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { promptId, walletAddress, content, changeNote } = req.body;

    if (!promptId || !walletAddress || !content) {
      return res.status(400).json({ error: "promptId, walletAddress, and content are required." });
    }

    const { actor, user } = await resolveActor(walletAddress, { promptId, requiredOperation: "postPromptUpdate" });
    if (actor !== "creator") {
      return denyResponse(res, "postPromptUpdate", actor);
    }
    if (!user) {
      return deny(res, 401);
    }

    const prompt = await Prompt.findOne({ _id: promptId, owner: user._id });
    if (!prompt) {
      // Cross-user / stale-ownership case: redacted 403, no state mutation.
      return denyResponse(res, "postPromptUpdate", "other");
    }

    const nextVersion = (prompt.currentVersionIndex ?? 1) + 1;

    await PromptVersion.create({
      promptId: String(prompt._id),
      versionIndex: nextVersion,
      content,
      changeNote: changeNote ?? "",
      createdBy: walletAddress.toLowerCase(),
    });

    await Prompt.findByIdAndUpdate(prompt._id, {
      currentVersionIndex: nextVersion,
      schemaVersion: currentPromptSchemaVersion(),
    });

    // Invalidate read caches on update
    await invalidatePromptCaches(String(prompt._id));
    if (prompt.onChainId) {
      await invalidatePromptCaches(String(prompt.onChainId));
    }

    // Notify all buyers of this prompt about the update. Optional type: the
    // routing service suppresses it for buyers who opted out, and the
    // dedupeKey makes repeated version-post retries deliver exactly once.
    const purchases = await Purchase.find({ promptId: String(prompt._id) });
    await Promise.all(
      purchases.map((purchase: { buyerWallet: string }) =>
        deliverNotification({
          recipientWallet: purchase.buyerWallet,
          type: "prompt_update",
          promptId: String(prompt._id),
          promptTitle: prompt.title,
          message: `"${prompt.title}" has been updated by the creator.`,
          versionIndex: nextVersion,
          changeNote: changeNote ?? "",
          dedupeKey: `prompt_update:${String(prompt._id)}:v${nextVersion}:${purchase.buyerWallet.toLowerCase()}`,
          requestId: req.correlationId ?? null,
        }),
      ),
    );

    return res.status(201).json({ message: "Version posted.", versionIndex: nextVersion });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

import {
  parsePaginationParams,
  encodeCompoundCursor,
  decodeCompoundCursor,
  PaginationError,
} from "../utils/pagination";

export const GetPromptVersions = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { promptId } = req.params;
    if (!promptId) return res.status(400).json({ error: "promptId is required." });

    let limit = 20;
    let cursor: string | undefined;

    try {
      const parsed = parsePaginationParams(req.query as Record<string, unknown>, {
        defaultLimit: 20,
        maxLimit: 50,
      });
      limit = parsed.limit;
      cursor = parsed.cursor;
    } catch (paramErr) {
      if (paramErr instanceof PaginationError) {
        return res.status(paramErr.status).json({
          error: paramErr.message,
          code: paramErr.code,
        });
      }
      throw paramErr;
    }

    const query: Record<string, any> = { promptId: String(promptId) };

    if (cursor) {
      const decoded = decodeCompoundCursor(cursor);
      const cursorSeq = decoded.sequence ?? 0;
      query.$or = [
        { versionIndex: { $gt: cursorSeq } },
        { versionIndex: cursorSeq, _id: { $gt: decoded.id } },
      ];
    }

    // Public metadata only; content is stripped regardless of actor.
    const versions = await PromptVersion.find(query)
      .select("promptId versionIndex changeNote createdBy createdAt")
      .sort({ versionIndex: 1, _id: 1 })
      .limit(limit + 1)
      .lean();

    let hasNextPage = false;
    let nextCursor: string | null = null;

    if (versions.length > limit) {
      hasNextPage = true;
      versions.pop();
      const last = versions[versions.length - 1];
      nextCursor = encodeCompoundCursor({
        timestamp: last.createdAt,
        id: String(last._id),
        sequence: last.versionIndex,
      });
    }

    return res.status(200).json({
      versions,
      metadata: {
        limit,
        hasNextPage,
        nextCursor,
        count: versions.length,
      },
    });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const GetBuyerVersion = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { promptId, versionIndex } = req.params;
    const walletAddress = req.body?.walletAddress ?? req.query?.walletAddress;
    if (!promptId) {
      return res.status(400).json({ error: "promptId is required." });
    }

    const { actor } = await resolveActor(typeof walletAddress === "string" ? walletAddress : null, {
      promptId: String(promptId),
      requiredOperation: "getBuyerVersion",
    });
    if (actor !== "buyer") {
      return denyResponse(res, "getBuyerVersion", actor);
    }

    const query: Record<string, unknown> = { promptId: String(promptId) };
    if (versionIndex !== undefined) {
      query.versionIndex = Number(versionIndex);
    }

    const version = await PromptVersion.findOne(query).sort({ versionIndex: -1 }).lean();
    if (!version) {
      return res.status(404).json({ error: "Version not found." });
    }

    return res.status(200).json({ version });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const RecordPurchase = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { promptId, walletAddress, txHash } = req.body;
    if (!promptId || !walletAddress) {
      return res.status(400).json({ error: "promptId and walletAddress are required." });
    }

    const normalized = String(walletAddress).toLowerCase();
    const { actor, user } = await resolveActor(normalized, {
      promptId: String(promptId),
      requiredOperation: "recordPurchase",
    });
    if (actor !== "buyer" && actor !== "other") {
      return denyResponse(res, "recordPurchase", actor);
    }
    if (!user) {
      return denyResponse(res, "recordPurchase", "anonymous");
    }

    const prompt = await Prompt.findById(promptId).select("owner").lean();
    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found." });
    }
    if (String((prompt as any).owner) === String(user._id)) {
      // Self-purchase is forbidden and must not mutate state.
      return denyResponse(res, "recordPurchase", "creator");
    }

    const existing = await Purchase.findOne({ promptId: String(promptId), buyerWallet: normalized }).lean();
    if (!existing) {
      await Purchase.create({
        promptId: String(promptId),
        buyerWallet: normalized,
        txHash: txHash ?? null,
      });
    }

    return res.status(201).json({ message: "Purchase recorded." });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const TransferOwnership = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { promptId, walletAddress, newOwnerWallet } = req.body;
    if (!promptId || !walletAddress || !newOwnerWallet) {
      return res.status(400).json({ error: "promptId, walletAddress, and newOwnerWallet are required." });
    }

    const { actor, user } = await resolveActor(walletAddress, {
      promptId: String(promptId),
      requiredOperation: "transferOwnership",
    });
    if (actor !== "creator" && actor !== "administrator") {
      return denyResponse(res, "transferOwnership", actor);
    }
    if (!user) {
      return denyResponse(res, "transferOwnership", "anonymous");
    }

    const newOwner = await User.findOne({ walletAddress: String(newOwnerWallet).toLowerCase() });
    if (!newOwner) {
      return res.status(404).json({ error: "New owner not found." });
    }

    const prompt = await Prompt.findById(promptId);
    if (!prompt) {
      return res.status(404).json({ error: "Prompt not found." });
    }

    if (actor === "creator" && String(prompt.owner) !== String(user._id)) {
      // Stale ownership: redacted denial, no mutation.
      return denyResponse(res, "transferOwnership", "other");
    }

    prompt.owner = newOwner._id;
    await prompt.save();

    await invalidatePromptCaches(String(prompt._id));
    if (prompt.onChainId) {
      await invalidatePromptCaches(String(prompt.onChainId));
    }

    return res.status(200).json({ message: "Ownership transferred." });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

export const AdministrativeAction = async (req: Request, res: Response): Promise<Response> => {
  try {
    await connectDb();
    const { walletAddress, promptId, setStatus } = req.body;
    if (!walletAddress) {
      return res.status(400).json({ error: "walletAddress is required." });
    }

    const { actor } = await resolveActor(walletAddress, {
      promptId: promptId ? String(promptId) : undefined,
      requiredOperation: "administrativeAction",
    });
    if (actor !== "administrator") {
      return denyResponse(res, "administrativeAction", actor);
    }

    if (promptId && setStatus) {
      const prompt = await Prompt.findById(promptId);
      if (!prompt) {
        return res.status(404).json({ error: "Prompt not found." });
      }
      prompt.status = setStatus;
      await prompt.save();
      await invalidatePromptCaches(String(prompt._id));
    }

    return res.status(200).json({ message: "Administrative action applied." });
  } catch (err) {
    return res.status(500).json({ error: (err as Error).message });
  }
};

// ------------------------------------------------------------------------------
// Internal helpers used by the controllers above.
// ------------------------------------------------------------------------------

function currentPromptSchemaVersion(): number {
  return 2;
}

async function invalidatePromptCaches(_key: string): Promise<void> {
  // Cache invalidation is handled by the cache layer; this hook exists so
  // controllers can remain agnostic of the cache backend.
  return;
}
