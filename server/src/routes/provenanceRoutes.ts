import { Router, Request, Response } from "express";
import connectDb from "../db/connectDb";
import { requireAdminScope } from "../middleware/adminAuth";
import { requireWalletSession, WalletSessionRequest } from "../middleware/walletSession";
import {
  declareRelation,
  getLineage,
  getProvenanceFlags,
  ProvenanceError,
  removeRelation,
} from "../services/provenance";

/**
 * Prompt provenance graph (#753).
 *
 * GET    /api/provenance/admin/flags                          — moderation flags (admin)
 * GET    /api/provenance/:promptId                            — public lineage
 * POST   /api/provenance/:promptId/relations                  — creator declares a relation
 *        { creatorWallet, relatedPromptId, kind }
 * DELETE /api/provenance/:promptId/relations/:relatedPromptId?creatorWallet=
 *
 * Declaring or removing a relation requires a wallet session for the
 * listing's creator (see middleware/walletSession.ts).
 */
export const provenanceRouter = Router();

function handleProvenanceError(res: Response, err: unknown): void {
  if (err instanceof ProvenanceError) {
    res.status(err.status).json({ error: err.message });
    return;
  }
  throw err;
}

provenanceRouter.get(
  "/admin/flags",
  requireAdminScope("provenance:read"),
  async (req: Request, res: Response) => {
    await connectDb();
    const limit = Math.min(Math.max(Number(req.query.limit) || 100, 1), 500);
    res.json({ flags: await getProvenanceFlags(limit) });
  },
);

provenanceRouter.get("/:promptId", async (req: Request, res: Response) => {
  try {
    await connectDb();
    res.json(await getLineage(String(req.params.promptId)));
  } catch (err) {
    handleProvenanceError(res, err);
  }
});

provenanceRouter.post(
  "/:promptId/relations",
  requireWalletSession((req: Request) => req.body?.creatorWallet),
  async (req: WalletSessionRequest, res: Response) => {
    try {
      await connectDb();
      const relation = await declareRelation({
        promptId: String(req.params.promptId),
        relatedPromptId: req.body?.relatedPromptId,
        kind: req.body?.kind,
        wallet: req.sessionWallet!,
      });
      res.status(201).json(relation);
    } catch (err) {
      handleProvenanceError(res, err);
    }
  },
);

provenanceRouter.delete(
  "/:promptId/relations/:relatedPromptId",
  requireWalletSession((req: Request) => req.query.creatorWallet),
  async (req: WalletSessionRequest, res: Response) => {
    try {
      await connectDb();
      await removeRelation({
        promptId: String(req.params.promptId),
        relatedPromptId: String(req.params.relatedPromptId),
        wallet: req.sessionWallet!,
      });
      res.status(204).end();
    } catch (err) {
      handleProvenanceError(res, err);
    }
  },
);
