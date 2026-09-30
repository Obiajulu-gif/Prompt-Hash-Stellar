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
import * as provenanceService from "../services/provenanceService";
import {
  bulkImportPrompts,
  getBulkImportStatus,
  listBulkImports,
} from "../controllers/bulkImportController";

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
      
      // Declare the relation using the existing service
      const relation = await declareRelation({
        promptId: String(req.params.promptId),
        relatedPromptId: req.body?.relatedPromptId,
        kind: req.body?.kind,
        wallet: req.sessionWallet!,
      });

      // Track provenance for derived prompts (fork, remix, parent)
      if (["fork", "remix", "parent"].includes(req.body?.kind)) {
        try {
          await provenanceService.trackDerivedPrompt({
            promptId: String(req.params.promptId),
            onChainId: String(req.params.promptId),
            parentPromptId: req.body?.relatedPromptId,
            parentOnChainId: req.body?.relatedPromptId,
            relationKind: req.body?.kind,
            actor: {
              walletAddress: req.sessionWallet,
              timestamp: new Date(),
            },
            transformationType: req.body?.transformationType,
            transformDetails: req.body?.transformDetails,
          });
        } catch (provErr) {
          // Log but don't fail the relation creation if provenance tracking fails
          console.error("Failed to track provenance for derived prompt:", provErr);
        }
      }

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

// ── Bulk Import Routes (Issue #929) ──────────────────────────────────────────
// POST   /api/provenance/bulk-import       — bulk import prompts with provenance
// GET    /api/provenance/bulk-import/:id   — get import status
// GET    /api/provenance/bulk-imports      — list all imports
provenanceRouter.post(
  "/bulk-import",
  requireAdminScope("provenance:write"),
  bulkImportPrompts,
);

provenanceRouter.get(
  "/bulk-import/:batchId",
  requireAdminScope("provenance:read"),
  getBulkImportStatus,
);

provenanceRouter.get(
  "/bulk-imports",
  requireAdminScope("provenance:read"),
  listBulkImports,
);

// ── Provenance Query Routes (Issue #929) ────────────────────────────────────
// GET    /api/provenance/record/:promptId    — get provenance record by prompt ID
// GET    /api/provenance/batch/:batchId      — get all prompts in a batch
// GET    /api/provenance/lineage/:promptId   — get full lineage tree
// GET    /api/provenance/derivatives/:promptId — get all derivatives
// POST   /api/provenance/query               — advanced provenance queries
// GET    /api/provenance/statistics          — import statistics
provenanceRouter.get(
  "/record/:promptId",
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const record = await provenanceService.provenanceService.getProvenanceByPromptId(req.params.promptId);
      if (!record) {
        return res.status(404).json({ error: "Provenance record not found" });
      }
      res.json(record);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch provenance record" });
    }
  },
);

provenanceRouter.get(
  "/batch/:batchId",
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const prompts = await provenanceService.provenanceService.getBatchPrompts(req.params.batchId);
      res.json({ batchId: req.params.batchId, count: prompts.length, prompts });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch batch prompts" });
    }
  },
);

provenanceRouter.get(
  "/lineage/:promptId",
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const lineage = await provenanceService.provenanceService.getLineage(req.params.promptId);
      res.json(lineage);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch lineage" });
    }
  },
);

provenanceRouter.get(
  "/derivatives/:promptId",
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const derivatives = await provenanceService.provenanceService.getDerivatives(req.params.promptId);
      res.json({ promptId: req.params.promptId, count: derivatives.length, derivatives });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch derivatives" });
    }
  },
);

provenanceRouter.post(
  "/query",
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const results = await provenanceService.provenanceService.queryProvenance(req.body);
      res.json(results);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Invalid query parameters" });
    }
  },
);

provenanceRouter.get(
  "/statistics",
  requireAdminScope("provenance:read"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const stats = await provenanceService.provenanceService.getImportStatistics({});
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch statistics" });
    }
  },
);


// ── Enhanced Derivatives Endpoint (combines #753 and #929) ──────────────────
// GET /api/provenance/derivatives-enhanced/:promptId — get derivatives with full provenance
provenanceRouter.get(
  "/derivatives-enhanced/:promptId",
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const derivatives = await provenanceService.getDerivativesWithProvenance(req.params.promptId);
      res.json({ 
        promptId: req.params.promptId, 
        count: derivatives.length, 
        derivatives 
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch derivatives" });
    }
  },
);

// POST /api/provenance/track-derived — manually track a derived prompt
provenanceRouter.post(
  "/track-derived",
  requireWalletSession((req: Request) => req.body?.actor?.walletAddress),
  async (req: WalletSessionRequest, res: Response) => {
    try {
      await connectDb();
      const result = await provenanceService.trackDerivedPrompt({
        ...req.body,
        actor: {
          ...req.body.actor,
          walletAddress: req.sessionWallet,
        },
      });
      res.status(201).json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to track derived prompt" });
    }
  },
);

// POST /api/provenance/track-derived-batch — batch track derived prompts
provenanceRouter.post(
  "/track-derived-batch",
  requireAdminScope("provenance:write"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const result = await provenanceService.trackDerivedPrompts(req.body.derivations);
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to batch track derived prompts" });
    }
  },
);


// ── Provenance Preservation Through Updates (Issue #929) ────────────────────
// POST /api/provenance/track-update       — track a prompt update
// POST /api/provenance/archive            — archive provenance (soft delete)
// POST /api/provenance/restore            — restore archived provenance
// GET  /api/provenance/update-history/:promptId — get update history
provenanceRouter.post(
  "/track-update",
  requireWalletSession((req: Request) => req.body?.actor?.walletAddress),
  async (req: WalletSessionRequest, res: Response) => {
    try {
      await connectDb();
      const result = await provenanceService.trackPromptUpdate({
        ...req.body,
        actor: {
          ...req.body.actor,
          walletAddress: req.sessionWallet,
          timestamp: new Date(),
        },
      });
      res.json(result);
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to track update" });
    }
  },
);

provenanceRouter.post(
  "/archive",
  requireAdminScope("provenance:write"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      await provenanceService.archiveProvenance(req.body);
      res.json({ success: true, message: "Provenance archived successfully" });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to archive provenance" });
    }
  },
);

provenanceRouter.post(
  "/restore",
  requireAdminScope("provenance:write"),
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      await provenanceService.restoreProvenance(req.body);
      res.json({ success: true, message: "Provenance restored successfully" });
    } catch (err: any) {
      res.status(400).json({ error: err.message || "Failed to restore provenance" });
    }
  },
);

provenanceRouter.get(
  "/update-history/:promptId",
  async (req: Request, res: Response) => {
    try {
      await connectDb();
      const history = await provenanceService.getUpdateHistory(req.params.promptId);
      res.json(history);
    } catch (err: any) {
      res.status(500).json({ error: err.message || "Failed to fetch update history" });
    }
  },
);
