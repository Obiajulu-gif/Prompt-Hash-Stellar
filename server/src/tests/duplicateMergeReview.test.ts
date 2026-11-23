import { describe, expect, it } from "vitest";
import {
  DuplicateMergeReviewService,
  DuplicatePromptRecord,
  MergeReviewError,
} from "../services/duplicateMergeReviewService";

describe("DuplicateMergeReviewService (#1130)", () => {
  const promptA: DuplicatePromptRecord = {
    id: "p-001",
    title: "Master SEO Prompt",
    content: "Generate 10 high-ranking keywords for a B2B SaaS startup website.",
    version: 1,
    visible: true,
    createdAt: new Date("2026-01-01T00:00:00Z"),
  };

  const promptB: DuplicatePromptRecord = {
    id: "p-002",
    title: "Master SEO Prompt v2",
    content: "Generate 10 high-ranking keywords for a B2B SaaS startup website.",
    version: 1,
    visible: true,
    createdAt: new Date("2026-01-02T00:00:00Z"),
  };

  const promptC: DuplicatePromptRecord = {
    id: "p-003",
    title: "Crypto Trading Agent Prompt",
    content: "Analyze order book depth and spot funding rates on Stellar DEX.",
    version: 1,
    visible: true,
    createdAt: new Date("2026-01-03T00:00:00Z"),
  };

  describe("Deterministic Duplicate Detection", () => {
    it("detects exact content hash matches deterministically", () => {
      const matches = DuplicateMergeReviewService.detectDuplicates([promptA, promptB, promptC]);

      expect(matches).toHaveLength(1);
      expect(matches[0].matchType).toBe("EXACT_HASH");
      expect(matches[0].primaryId).toBe("p-001");
      expect(matches[0].duplicateId).toBe("p-002");
      expect(matches[0].score).toBe(1.0);
    });

    it("yields identical candidateId regardless of input array order", () => {
      const matches1 = DuplicateMergeReviewService.detectDuplicates([promptA, promptB]);
      const matches2 = DuplicateMergeReviewService.detectDuplicates([promptB, promptA]);

      expect(matches1[0].candidateId).toBe(matches2[0].candidateId);
      expect(matches1[0].primaryId).toBe("p-001");
      expect(matches1[0].duplicateId).toBe("p-002");
    });

    it("detects near-text similarity above threshold", () => {
      const variantPrompt: DuplicatePromptRecord = {
        id: "p-004",
        title: "SEO Keyword Prompt",
        content: "Generate 10 high-ranking keywords for a B2B SaaS web site.",
        version: 1,
        visible: true,
        createdAt: new Date("2026-01-04T00:00:00Z"),
      };

      const matches = DuplicateMergeReviewService.detectDuplicates([promptA, variantPrompt], 0.7);
      expect(matches.length).toBeGreaterThan(0);
      expect(matches[0].matchType).toBe("SIMILAR_CONTENT");
      expect(matches[0].score).toBeGreaterThanOrEqual(0.7);
    });
  });

  describe("Merge Review Workflow (Normal Path)", () => {
    it("runs complete propose -> approve -> apply -> revert lifecycle with valid audit chain", () => {
      const matches = DuplicateMergeReviewService.detectDuplicates([promptA, promptB]);
      const match = matches[0];

      // 1. Propose
      const proposal = DuplicateMergeReviewService.proposeMerge(
        match,
        promptA,
        promptB,
        "operator-alice"
      );
      expect(proposal.status).toBe("PROPOSED");
      expect(proposal.history).toHaveLength(1);
      expect(DuplicateMergeReviewService.verifyHistory(proposal)).toBe(true);

      // 2. Review (Approve by distinct reviewer)
      const approved = DuplicateMergeReviewService.reviewProposal(
        proposal,
        "reviewer-bob",
        "APPROVE",
        "Confirmed identical prompt duplicates."
      );
      expect(approved.status).toBe("APPROVED");
      expect(approved.history).toHaveLength(2);
      expect(DuplicateMergeReviewService.verifyHistory(approved)).toBe(true);

      // 3. Apply
      const { proposal: applied, updatedDuplicate } = DuplicateMergeReviewService.applyMerge(
        approved,
        promptB,
        "operator-alice"
      );
      expect(applied.status).toBe("APPLIED");
      expect(updatedDuplicate.visible).toBe(false);
      expect(updatedDuplicate.mergedInto).toBe("p-001");
      expect(updatedDuplicate.version).toBe(2);
      expect(DuplicateMergeReviewService.verifyHistory(applied)).toBe(true);

      // 4. Revert
      const { proposal: reverted, restoredDuplicate } = DuplicateMergeReviewService.revertMerge(
        applied,
        updatedDuplicate,
        "lead-reviewer",
        "Reverting merge due to author feedback."
      );
      expect(reverted.status).toBe("REVERTED");
      expect(restoredDuplicate.visible).toBe(true);
      expect(restoredDuplicate.mergedInto).toBeNull();
      expect(restoredDuplicate.version).toBe(3);
      expect(DuplicateMergeReviewService.verifyHistory(reverted)).toBe(true);
    });
  });

  describe("Failure and Authorization Paths", () => {
    it("enforces four-eyes principle: proposer cannot approve own proposal", () => {
      const matches = DuplicateMergeReviewService.detectDuplicates([promptA, promptB]);
      const proposal = DuplicateMergeReviewService.proposeMerge(
        matches[0],
        promptA,
        promptB,
        "operator-alice"
      );

      expect(() => {
        DuplicateMergeReviewService.reviewProposal(
          proposal,
          "operator-alice",
          "APPROVE",
          "Self-approving"
        );
      }).toThrowError(/Four-eyes policy violation/);
    });

    it("rejects review without a reason", () => {
      const matches = DuplicateMergeReviewService.detectDuplicates([promptA, promptB]);
      const proposal = DuplicateMergeReviewService.proposeMerge(
        matches[0],
        promptA,
        promptB,
        "operator-alice"
      );

      expect(() => {
        DuplicateMergeReviewService.reviewProposal(proposal, "reviewer-bob", "APPROVE", "   ");
      }).toThrowError(/Review decision reason is required/);
    });

    it("blocks applying a proposal that was rejected", () => {
      const matches = DuplicateMergeReviewService.detectDuplicates([promptA, promptB]);
      const proposal = DuplicateMergeReviewService.proposeMerge(
        matches[0],
        promptA,
        promptB,
        "operator-alice"
      );

      const rejected = DuplicateMergeReviewService.reviewProposal(
        proposal,
        "reviewer-bob",
        "REJECT",
        "Distinct stylistic intent."
      );

      expect(() => {
        DuplicateMergeReviewService.applyMerge(rejected, promptB, "operator-alice");
      }).toThrowError(MergeReviewError);
    });

    it("prevents apply if duplicate version is stale", () => {
      const matches = DuplicateMergeReviewService.detectDuplicates([promptA, promptB]);
      const proposal = DuplicateMergeReviewService.proposeMerge(
        matches[0],
        promptA,
        promptB,
        "operator-alice"
      );
      const approved = DuplicateMergeReviewService.reviewProposal(
        proposal,
        "reviewer-bob",
        "APPROVE",
        "Approved"
      );

      const mutatedPromptB = { ...promptB, version: 9 };
      expect(() => {
        DuplicateMergeReviewService.applyMerge(approved, mutatedPromptB, "operator-alice");
      }).toThrowError(/Duplicate has been updated since proposal/);
    });

    it("detects tampered audit chain", () => {
      const matches = DuplicateMergeReviewService.detectDuplicates([promptA, promptB]);
      const proposal = DuplicateMergeReviewService.proposeMerge(
        matches[0],
        promptA,
        promptB,
        "operator-alice"
      );

      const tamperedProposal = {
        ...proposal,
        history: [
          {
            ...proposal.history[0],
            actor: "mallory",
          },
        ],
      };

      expect(DuplicateMergeReviewService.verifyHistory(tamperedProposal)).toBe(false);
    });
  });
});

