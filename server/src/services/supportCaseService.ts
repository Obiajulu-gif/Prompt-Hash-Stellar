import SupportCase, { SupportCaseType, SupportCaseStatus, CaseResolution } from "../models/SupportCase.js";
import Purchase from "../models/Purchase.js";
import { logger } from "./auditTrail.js";

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
      buyerWallet: input.buyerWallet.toLowerCase(),
      creatorWallet: input.creatorWallet?.toLowerCase(),
      title: input.title,
      description: input.description,
      purchaseId: input.purchaseId,
      evidenceUrls: input.evidenceUrls || [],
      status: "open",
    });

    await caseDoc.save();
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
    logger.info(`Note added to case ${caseId}`);
    return caseDoc;
  }

  async getPublicNotes(caseId: string): Promise<any[]> {
    const caseDoc = await SupportCase.findById(caseId);
    if (!caseDoc) {
      throw new Error(`Case not found: ${caseId}`);
    }

    return caseDoc.notes.filter((note) => !note.isPrivate);
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
      (note) => !note.isPrivate || note.author === userWallet.toLowerCase()
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
