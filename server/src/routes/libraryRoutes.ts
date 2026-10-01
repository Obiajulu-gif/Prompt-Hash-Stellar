import { Router, Request, Response } from "express";
import connectDb from "../db/connectDb";
import { markPrivate } from "../middleware/etag";
import { requireWalletSession, WalletSessionRequest } from "../middleware/walletSession";
import {
  ArchivedFilter,
  createCollection,
  deleteCollection,
  getBuyerLibrary,
  LibraryError,
  setPromptArchived,
  updateCollection,
} from "../services/buyerLibrary";
import type { EntitlementHealth } from "../../../src/lib/prompts/entitlementHealth";

/**
 * Buyer library (#784). Every route requires a wallet session for the
 * `:walletAddress` in the path (see middleware/walletSession.ts), so a buyer
 * can only read or organise their own library.
 *
 * GET    /api/library/:walletAddress?q=&collection=&archived=&health=
 * POST   /api/library/:walletAddress/collections
 * PATCH  /api/library/:walletAddress/collections/:collectionId
 * DELETE /api/library/:walletAddress/collections/:collectionId
 * PUT    /api/library/:walletAddress/items/:promptId   { archived: boolean }
 */
export const libraryRouter = Router();

const HEALTH_FILTERS: EntitlementHealth[] = ["active", "refunded", "revoked", "recovery_needed"];
const ARCHIVED_FILTERS: ArchivedFilter[] = ["exclude", "only", "include"];

const withSession = requireWalletSession((req: Request) => req.params.walletAddress);

function handleLibraryError(res: Response, err: unknown): void {
  if (err instanceof LibraryError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

libraryRouter.get("/:walletAddress", withSession, async (req: WalletSessionRequest, res: Response) => {
  markPrivate(res);
  const archived = req.query.archived ? (String(req.query.archived) as ArchivedFilter) : undefined;
  const health = req.query.health ? (String(req.query.health) as EntitlementHealth) : undefined;
  if (archived && !ARCHIVED_FILTERS.includes(archived)) {
    res.status(400).json({ error: `archived must be one of: ${ARCHIVED_FILTERS.join(", ")}` });
    return;
  }
  if (health && !HEALTH_FILTERS.includes(health)) {
    res.status(400).json({ error: `health must be one of: ${HEALTH_FILTERS.join(", ")}` });
    return;
  }

  try {
    await connectDb();
    res.json(
      await getBuyerLibrary(req.sessionWallet!, {
        q: req.query.q ? String(req.query.q) : undefined,
        collectionId: req.query.collection ? String(req.query.collection) : undefined,
        archived,
        health,
      }),
    );
  } catch (err) {
    handleLibraryError(res, err);
  }
});

libraryRouter.post(
  "/:walletAddress/collections",
  withSession,
  async (req: WalletSessionRequest, res: Response) => {
    try {
      await connectDb();
      res.status(201).json(await createCollection(req.sessionWallet!, req.body ?? {}));
    } catch (err) {
      handleLibraryError(res, err);
    }
  },
);

libraryRouter.patch(
  "/:walletAddress/collections/:collectionId",
  withSession,
  async (req: WalletSessionRequest, res: Response) => {
    try {
      await connectDb();
      res.json(
        await updateCollection(req.sessionWallet!, String(req.params.collectionId), req.body ?? {}),
      );
    } catch (err) {
      handleLibraryError(res, err);
    }
  },
);

libraryRouter.delete(
  "/:walletAddress/collections/:collectionId",
  withSession,
  async (req: WalletSessionRequest, res: Response) => {
    try {
      await connectDb();
      await deleteCollection(req.sessionWallet!, String(req.params.collectionId));
      res.status(204).end();
    } catch (err) {
      handleLibraryError(res, err);
    }
  },
);

libraryRouter.put(
  "/:walletAddress/items/:promptId",
  withSession,
  async (req: WalletSessionRequest, res: Response) => {
    const { archived } = req.body ?? {};
    if (typeof archived !== "boolean") {
      res.status(400).json({ error: "archived must be a boolean." });
      return;
    }
    try {
      await connectDb();
      res.json(await setPromptArchived(req.sessionWallet!, String(req.params.promptId), archived));
    } catch (err) {
      handleLibraryError(res, err);
    }
  },
);
