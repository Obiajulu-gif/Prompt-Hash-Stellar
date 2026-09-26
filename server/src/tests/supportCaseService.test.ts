import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { supportCaseService } from "../services/supportCaseService.js";
import SupportCase from "../models/SupportCase.js";

describe("SupportCaseService", () => {
  beforeEach(async () => {
    await SupportCase.deleteMany({});
  });

  afterEach(async () => {
    await SupportCase.deleteMany({});
  });

  it("should create a support case", async () => {
    const caseDoc = await supportCaseService.createCase({
      type: "purchase_failure",
      promptId: "prompt-123",
      buyerWallet: "GBUQWP3BOUZX34ULNQG23RQ6F5LGNQJD",
      creatorWallet: "GCREATOR123",
      title: "Purchase Failed",
      description: "Transaction failed during payment",
    });

    expect(caseDoc.type).toBe("purchase_failure");
    expect(caseDoc.status).toBe("open");
    expect(caseDoc.buyerWallet).toBe("gbuqwp3bouzx34ulnqg23rq6f5lgnqjd");
  });

  it("should get cases by buyer wallet", async () => {
    const wallet = "GBUYER123";
    await supportCaseService.createCase({
      type: "access_denied",
      promptId: "prompt-1",
      buyerWallet: wallet,
      title: "Access Issue",
      description: "Cannot access purchased prompt",
    });

    await supportCaseService.createCase({
      type: "content_dispute",
      promptId: "prompt-2",
      buyerWallet: wallet,
      title: "Content Issue",
      description: "Prompt content not as described",
    });

    const cases = await supportCaseService.getCasesBuyerWallet(wallet);
    expect(cases.length).toBe(2);
  });

  it("should update case status", async () => {
    const caseDoc = await supportCaseService.createCase({
      type: "purchase_failure",
      promptId: "prompt-123",
      buyerWallet: "GBUYER123",
      title: "Issue",
      description: "Test issue",
    });

    const updated = await supportCaseService.updateCase(caseDoc._id, {
      status: "in_progress",
      assignedTo: "admin@example.com",
    });

    expect(updated.status).toBe("in_progress");
    expect(updated.assignedTo).toBe("admin@example.com");
  });

  it("should add notes to case", async () => {
    const caseDoc = await supportCaseService.createCase({
      type: "purchase_failure",
      promptId: "prompt-123",
      buyerWallet: "GBUYER123",
      title: "Issue",
      description: "Test issue",
    });

    const withNote = await supportCaseService.addNote(caseDoc._id, {
      author: "admin@example.com",
      text: "Investigating the issue",
      isPrivate: false,
    });

    expect(withNote.notes.length).toBe(1);
    expect(withNote.notes[0].text).toBe("Investigating the issue");
  });

  it("should get public notes only for non-admins", async () => {
    const caseDoc = await supportCaseService.createCase({
      type: "purchase_failure",
      promptId: "prompt-123",
      buyerWallet: "GBUYER123",
      title: "Issue",
      description: "Test issue",
    });

    await supportCaseService.addNote(caseDoc._id, {
      author: "admin@example.com",
      text: "Internal investigation underway",
      isPrivate: true,
    });

    await supportCaseService.addNote(caseDoc._id, {
      author: "admin@example.com",
      text: "Public status update",
      isPrivate: false,
    });

    const publicNotes = await supportCaseService.getPublicNotes(caseDoc._id);
    expect(publicNotes.length).toBe(1);
    expect(publicNotes[0].text).toBe("Public status update");
  });

  it("should resolve case", async () => {
    const caseDoc = await supportCaseService.createCase({
      type: "purchase_failure",
      promptId: "prompt-123",
      buyerWallet: "GBUYER123",
      title: "Issue",
      description: "Test issue",
    });

    const resolved = await supportCaseService.resolveCase(
      caseDoc._id,
      "refunded",
      "Transaction refunded to buyer"
    );

    expect(resolved.status).toBe("resolved");
    expect(resolved.resolution).toBe("refunded");
    expect(resolved.resolvedAt).toBeDefined();
  });

  it("should get cases by status", async () => {
    await supportCaseService.createCase({
      type: "purchase_failure",
      promptId: "prompt-1",
      buyerWallet: "GBUYER1",
      title: "Issue 1",
      description: "Test",
    });

    const caseDoc2 = await supportCaseService.createCase({
      type: "access_denied",
      promptId: "prompt-2",
      buyerWallet: "GBUYER2",
      title: "Issue 2",
      description: "Test",
    });

    await supportCaseService.updateCase(caseDoc2._id, {
      status: "in_progress",
    });

    const openCases = await supportCaseService.getCasesByStatus("open");
    const inProgressCases = await supportCaseService.getCasesByStatus(
      "in_progress"
    );

    expect(openCases.length).toBe(1);
    expect(inProgressCases.length).toBe(1);
  });
});
