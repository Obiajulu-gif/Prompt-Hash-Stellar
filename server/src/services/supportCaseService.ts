import SupportCase, { SupportCaseType, SupportCaseStatus, CaseResolution } from "../models/SupportCase.js";
import Purchase from "../models/Purchase.js";
import { logger } from "./auditTrail.js";
import { supportCaseTimelineService } from "./supportCaseTimelineService.js";

export interface CreateCaseInput {
  type: SupportCaseType;
  promptId: string;
  buyerWallet: string;
  creatorWallet?: string;
  title: string;
  description: string;
  purchaseId?: string;
  evidenceUrls?: string[];
}

export interface UpdateCaseInput {
  status?: SupportCaseStatus;
  assignedTo?: string;
  resolution?: CaseResolution;
  resolutionNote?: string;
}

export interface AddNoteInput {
  author: string;
  text: string;
  isPrivate?: boolean;
}

class SupportCaseService {
  async createCase(input: CreateCaseInput): Promise<any> {
    const caseDoc = new SupportCase({
      type: input.type,
      promptId: input.promptId,
      buyerWallet: String(input.buyerWallet).toLowerCase(),
      creatorWallet: input.creatorWallet?.toLowerCase(),
      title: input.title,
      description: input.description,
      purchaseId: input.purchaseId,
      evidenceUrls: input.evidenceUrls || [],
      status: "open",
    });

    await caseDoc.save();
    await supportCaseTimelineService.append({
      caseId: String(caseDoc._id),
      type: "status",
      actor: input.buyerWallet,
      actorType: "user",
      payload: { from: null, to: "open", title: input.title },
    });
    if (input.evidenceUrls?.length) {
      await supportCaseTimelineService.append({
        caseId: String(caseDoc._id), type: "evidence", actor: input.buyerWallet,
        actorType: "user", payload: { count: input.evidenceUrls.length },
      });
    }
    logger.info(`Support case created: ${caseDoc._id} for prompt ${input.promptId}`);
    return caseDoc;
  }

  async createFromFailedPurchase(purchaseId: string, reason: string): Promise<any> {
    const purchase = await Purchase.findById(purchaseId);
    if (!purchase) {
      throw new Error(`Purchase not found: ${purchaseId}`);
    }

    return this.createCase({
      type: "purchase_failure",
      promptId: purchase.promptId,
      buyerWallet: purchase.buyerWallet,
      title: "Purchase Failed",
      description: reason || "Purchase transaction failed",
      purchaseId,
    });
  }

  async getCaseById(caseId: string): Promise<any> {
    return SupportCase.findById(caseId);
  }

  async getPublicCaseById(caseId: string): Promise<any> {
    const caseDoc = await SupportCase.findById(caseId).lean();
    if (!caseDoc) return null;
    const { notes: _privateNotes, ...safeCase } = caseDoc as any;
    return safeCase;
  }

  async getCasesBuyerWallet(wallet: string): Promise<any[]> {
    return SupportCase.find({
      buyerWallet: wallet.toLowerCase(),
    }).sort({ createdAt: -1 });
  }

  async getCasesByPromptId(promptId: string): Promise<any[]> {
    return SupportCase.find({ promptId }).sort({ createdAt: -1 });
  }

  async getCasesByStatus(status: SupportCaseStatus): Promise<any[]> {
    return SupportCase.find({ status }).sort({ createdAt: -1 });
  }

  async updateCase(caseId: string, input: UpdateCaseInput): Promise<any> {
    const before = await SupportCase.findById(caseId).select("status assignedTo resolution");
    if (!before) throw new Error(`Case not found: ${caseId}`);
    const updateData: any = { ...input };

    if (input.resolution) {
      updateData.resolvedAt = new Date();
      updateData.status = "resolved";
    }

    const caseDoc = await SupportCase.findByIdAndUpdate(caseId, updateData, {
      new: true,
    });

    if (!caseDoc) {
      throw new Error(`Case not found: ${caseId}`);
    }

    const actor = input.assignedTo || "maintainer";
    if (input.status && input.status !== before.status) {
      await supportCaseTimelineService.append({ caseId, type: "status", visibility: "user", actor, actorType: "maintainer", payload: { from: before.status, to: input.status } });
    }
    if (input.status === "in_progress" && before.status !== "in_progress") {
      await supportCaseTimelineService.append({ caseId, type: "escalation", visibility: "private", actor, actorType: "maintainer", payload: { assignedTo: input.assignedTo ?? null } });
    }
    if (input.resolution) {
      await supportCaseTimelineService.append({ caseId, type: "resolution", visibility: "user", actor, actorType: "maintainer", payload: { resolution: input.resolution, note: input.resolutionNote ?? null } });
    }

    logger.info(`Support case updated: ${caseId}`);
    return caseDoc;
  }

  async addNote(caseId: string, input: AddNoteInput): Promise<any> {
    const caseDoc = await SupportCase.findById(caseId);
    if (!caseDoc) {
      throw new Error(`Case not found: ${caseId}`);
    }

    caseDoc.notes.push({
      author: input.author.toLowerCase(),
      text: input.text,
      isPrivate: input.isPrivate || false,
      createdAt: new Date(),
    });

    await caseDoc.save();
    await supportCaseTimelineService.append({
      caseId, type: "note", visibility: input.isPrivate ? "private" : "user",
      actor: input.author, actorType: input.isPrivate ? "maintainer" : "user",
      payload: { text: input.text },
    });
    logger.info(`Note added to case ${caseId}`);
    return caseDoc;
  }

  async getPublicNotes(caseId: string): Promise<any[]> {
    const caseDoc = await SupportCase.findById(caseId);
    if (!caseDoc) {
      throw new Error(`Case not found: ${caseId}`);
    }

    return caseDoc.notes.filter((note: { isPrivate: boolean }) => !note.isPrivate);
  }

  async getTimeline(caseId: string, includePrivate = false) {
    return supportCaseTimelineService.list(caseId, includePrivate);
  }

  async verifyTimeline(caseId: string) {
    return supportCaseTimelineService.verify(caseId);
  }

  async getVisibleNotes(caseId: string, userWallet: string, isAdmin: boolean): Promise<any[]> {
    const caseDoc = await SupportCase.findById(caseId);
    if (!caseDoc) {
      throw new Error(`Case not found: ${caseId}`);
    }

    if (isAdmin) {
      return caseDoc.notes;
    }

    // Buyers see all public notes and their own private notes
    return caseDoc.notes.filter(
      (note: { isPrivate: boolean; author: string }) => !note.isPrivate || note.author === userWallet.toLowerCase()
    );
  }

  async resolveCase(
    caseId: string,
    resolution: CaseResolution,
    resolutionNote?: string
  ): Promise<any> {
    return this.updateCase(caseId, {
      resolution,
      resolutionNote,
      status: "resolved",
    });
  }

  async closeCase(caseId: string): Promise<any> {
    return this.updateCase(caseId, {
      status: "closed",
    });
  }
}

export const supportCaseService = new SupportCaseService();
