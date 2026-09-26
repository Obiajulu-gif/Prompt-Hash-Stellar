import express from "express";
import { supportCaseService } from "../services/supportCaseService.js";
import { requireAdminScope } from "../middleware/adminAuth.js";

export const supportCaseRouter = express.Router();

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
  "/:caseId",
  async (req, res) => {
    try {
      const caseDoc = await supportCaseService.getCaseById(req.params.caseId);
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
      const caseDoc = await supportCaseService.updateCase(req.params.caseId, {
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
      const caseDoc = await supportCaseService.addNote(req.params.caseId, {
        author,
        text,
        isPrivate,
      });
      res.json(caseDoc);
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
      const notes = await supportCaseService.getPublicNotes(req.params.caseId);
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
        req.params.caseId,
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
