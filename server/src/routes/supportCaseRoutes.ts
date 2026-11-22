import express from "express";
import { supportCaseService } from "../services/supportCaseService.js";
import { AdminRequest, requireAdminScope } from "../middleware/adminAuth.js";
import { markPrivate } from "../middleware/etag.js";
import { AUDIT_EXPORT_MAX_LIMIT } from "../services/auditTrail.js";
import {
  EvidenceAnchorError,
  exportSupportEvidenceBundle,
  verifySupportEvidenceBundle,
} from "../services/supportEvidenceBundle.js";

export const supportCaseRouter = express.Router();

// Privacy-preserving evidence bundle for a case (#967). See
// docs/support-evidence-bundles.md for the format and verification.
supportCaseRouter.get(
  "/:caseId/evidence-bundle",
  requireAdminScope("support:read"),
  async (req: AdminRequest, res) => {
    markPrivate(res);
    try {
      const bundle = await exportSupportEvidenceBundle(String(String(req.params.caseId)), {
        actor: req.admin?.sub ?? null,
        requestId: req.correlationId ?? null,
      });
      if (!bundle) {
        return res.status(404).json({ error: "Case not found" });
      }
      res.json(bundle);
    } catch (err) {
      if (err instanceof EvidenceAnchorError) {
        return res.status(503).json({ error: err.message });
      }
      res.status(500).json({ error: "Failed to build evidence bundle" });
    }
  }
);

supportCaseRouter.post(
  "/evidence-bundle/verify",
  requireAdminScope("support:read"),
  async (req, res) => {
    const bundle = req.body ?? {};
    if (
      typeof bundle.manifestChecksum !== "string" ||
      typeof bundle.case?.caseId !== "string" ||
      !Array.isArray(bundle.audit?.records)
    ) {
      return res.status(400).json({ error: "An exported evidence bundle is required." });
    }
    if (bundle.audit.records.length > AUDIT_EXPORT_MAX_LIMIT) {
      return res
        .status(413)
        .json({ error: `A bundle may contain at most ${AUDIT_EXPORT_MAX_LIMIT} audit records.` });
    }
    try {
      res.json(await verifySupportEvidenceBundle(bundle));
    } catch {
      res.status(500).json({ error: "Failed to verify evidence bundle" });
    }
  }
);

// Create support case
supportCaseRouter.post(
  "/",
  async (req, res) => {
    try {
      const { type, promptId, buyerWallet, creatorWallet, title, description, evidenceUrls } = req.body;
      const caseDoc = await supportCaseService.createCase({
        type,
        promptId,
        buyerWallet,
        creatorWallet,
        title,
        description,
        evidenceUrls,
      });
      res.status(201).json(caseDoc);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Get case by ID
supportCaseRouter.get(
  "/:caseId/timeline",
  async (req, res) => {
    try {
      const timeline = await supportCaseService.getTimeline(String(req.params.caseId), false);
      res.json({ data: timeline });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  },
);

supportCaseRouter.get(
  "/:caseId",
  async (req, res) => {
    try {
      const caseDoc = await supportCaseService.getPublicCaseById(String(req.params.caseId));
      if (!caseDoc) {
        return res.status(404).json({ error: "Case not found" });
      }
      res.json(caseDoc);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Get cases for buyer wallet
supportCaseRouter.get(
  "/buyer/:wallet",
  async (req, res) => {
    try {
      const cases = await supportCaseService.getCasesBuyerWallet(req.params.wallet);
      res.json(cases);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Update case
supportCaseRouter.patch(
  "/:caseId",
  requireAdminScope("support:write"),
  async (req, res) => {
    try {
      const { status, assignedTo, resolution, resolutionNote } = req.body;
      const caseDoc = await supportCaseService.updateCase(String(req.params.caseId), {
        status,
        assignedTo,
        resolution,
        resolutionNote,
      });
      res.json(caseDoc);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Add note to case
supportCaseRouter.post(
  "/:caseId/notes",
  async (req, res) => {
    try {
      const { author, text, isPrivate } = req.body;
      const caseDoc = await supportCaseService.addNote(String(req.params.caseId), {
        author,
        text,
        isPrivate,
      });
      const safeCase = await supportCaseService.getPublicCaseById(String(req.params.caseId));
      res.json(safeCase);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Get public notes for case
supportCaseRouter.get(
  "/:caseId/notes/public",
  async (req, res) => {
    try {
      const notes = await supportCaseService.getPublicNotes(String(req.params.caseId));
      res.json(notes);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);

// Resolve case
supportCaseRouter.post(
  "/:caseId/resolve",
  requireAdminScope("support:write"),
  async (req, res) => {
    try {
      const { resolution, resolutionNote } = req.body;
      const caseDoc = await supportCaseService.resolveCase(
        String(req.params.caseId),
        resolution,
        resolutionNote
      );
      res.json(caseDoc);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  }
);

// Get cases by status (admin only)
supportCaseRouter.get(
  "/status/:status",
  requireAdminScope("support:read"),
  async (req, res) => {
    try {
      const cases = await supportCaseService.getCasesByStatus(req.params.status as any);
      res.json(cases);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }
);
