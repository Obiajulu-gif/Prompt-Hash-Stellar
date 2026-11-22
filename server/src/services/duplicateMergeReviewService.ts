/**
 * Deterministic Duplicate Detection and Merge Review Service (#1130)
 *
 * Implements:
 * 1. Deterministic duplicate detection across prompt listings using canonical
 *    content hashing, token-set Jaccard similarity, and stable tie-breaking.
 * 2. Complete four-eyes merge review workflow:
 *    PROPOSE -> REVIEW (APPROVE / REJECT) -> APPLY -> REVERT
 * 3. Non-destructive aliasing: merges set `mergedInto = primaryId` and `visible = false`
 *    without moving or deleting on-chain records, purchases, or entitlements.
 * 4. Cryptographic audit history chaining (SHA-256) for non-repudiation.
 */

import { createHash } from "crypto";

export function canonicalJson(value: unknown): string {
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (value === null || value === undefined || typeof value !== "object") {
    return JSON.stringify(value ?? null);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const record = value as Record<string, unknown>;
  const members = Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`);
  return `{${members.join(",")}}`;
}

export type ReviewStatus = "PROPOSED" | "APPROVED" | "REJECTED" | "APPLIED" | "REVERTED";

export interface DuplicatePromptRecord {
  id: string;
  title: string;
  content: string;
  category?: string;
  version: number;
  visible: boolean;
  mergedInto?: string | null;
  createdAt: Date;
}

export interface DuplicateMatch {
  candidateId: string;
  primaryId: string;
  duplicateId: string;
  matchType: "EXACT_HASH" | "SIMILAR_CONTENT";
  score: number;
  reason: string;
}

export interface ReviewAuditEntry {
  action: "PROPOSE" | "APPROVE" | "REJECT" | "APPLY" | "REVERT";
  actor: string;
  at: string;
  from: ReviewStatus | null;
  to: ReviewStatus;
  reason: string;
  previousHash: string;
  hash: string;
}

export interface MergeReviewProposal {
  proposalId: string;
  candidateId: string;
  primaryId: string;
  duplicateId: string;
  initialDuplicateVersion: number;
  status: ReviewStatus;
  proposedBy: string;
  snapshot: {
    primary: { id: string; title: string };
    duplicate: { id: string; title: string; version: number; visible: boolean };
  };
  history: ReviewAuditEntry[];
  createdAt: Date;
  updatedAt: Date;
}

export class MergeReviewError extends Error {
  public readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
    this.name = "MergeReviewError";
  }
}

const GENESIS_HASH = "0".repeat(64);

export class DuplicateMergeReviewService {
  /**
   * Generates a deterministic normalized representation of text.
   * Time Complexity: O(L) where L is text length.
   * Space Complexity: O(L) for tokens.
   */
  public static normalizeText(text: string): string {
    return (text || "")
      .normalize("NFKC")
      .toLowerCase()
      .replace(/[^\w\s]/g, " ")
      .replace(/\s+/g, " ")
      .trim();
  }

  /**
   * Computes SHA-256 digest of normalized text.
   */
  public static computeContentHash(content: string): string {
    const normalized = this.normalizeText(content);
    return createHash("sha256").update(normalized).digest("hex");
  }

  /**
   * Computes Jaccard similarity coefficient between two texts.
   * Time Complexity: O(T1 + T2) where T is token count.
   * Space Complexity: O(T1 + T2) set storage.
   */
  public static computeSimilarity(textA: string, textB: string): number {
    const tokensA = new Set(this.normalizeText(textA).split(" ").filter(Boolean));
    const tokensB = new Set(this.normalizeText(textB).split(" ").filter(Boolean));

    if (tokensA.size === 0 && tokensB.size === 0) return 1.0;
    if (tokensA.size === 0 || tokensB.size === 0) return 0.0;

    let intersectionCount = 0;
    for (const token of tokensA) {
      if (tokensB.has(token)) {
        intersectionCount++;
      }
    }

    const unionCount = tokensA.size + tokensB.size - intersectionCount;
    return unionCount === 0 ? 0 : Math.round((intersectionCount / unionCount) * 10000) / 10000;
  }

  /**
   * Scans a list of prompt records and detects duplicate candidates deterministically.
   * Primary is chosen by earliest createdAt, break ties with lexicographical ID.
   * Time Complexity: O(N^2 * L) for N prompts.
   * Space Complexity: O(N * L) for storing candidates.
   */
  public static detectDuplicates(
    prompts: DuplicatePromptRecord[],
    threshold = 0.85,
  ): DuplicateMatch[] {
    // Exclude records already merged
    const live = prompts.filter((p) => !p.mergedInto);

    // Sort deterministically
    live.sort((a, b) => {
      const timeDiff = a.createdAt.getTime() - b.createdAt.getTime();
      if (timeDiff !== 0) return timeDiff;
      return a.id.localeCompare(b.id);
    });

    const candidates: DuplicateMatch[] = [];

    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const primary = live[i];
        const duplicate = live[j];

        const hashA = this.computeContentHash(primary.content);
        const hashB = this.computeContentHash(duplicate.content);

        let matchType: "EXACT_HASH" | "SIMILAR_CONTENT" | null = null;
        let score = 0;
        let reason = "";

        if (hashA === hashB) {
          matchType = "EXACT_HASH";
          score = 1.0;
          reason = "Exact normalized content hash match";
        } else {
          score = this.computeSimilarity(primary.content, duplicate.content);
          if (score >= threshold) {
            matchType = "SIMILAR_CONTENT";
            reason = `High content similarity score: ${score}`;
          }
        }

        if (matchType) {
          const candidateId = createHash("sha256")
            .update(`${primary.id}|${duplicate.id}|${matchType}`)
            .digest("hex")
            .slice(0, 24);

          candidates.push({
            candidateId,
            primaryId: primary.id,
            duplicateId: duplicate.id,
            matchType,
            score,
            reason,
          });
        }
      }
    }

    return candidates;
  }

  /**
   * Hashes an audit log entry chained to the previous entry hash.
   */
  private static hashAuditEntry(
    proposalId: string,
    action: string,
    to: ReviewStatus,
    actor: string,
    at: string,
    reason: string,
    previousHash: string,
  ): string {
    const envelope = canonicalJson({
      proposalId,
      action,
      to,
      actor: actor.toLowerCase(),
      at,
      reason,
      previousHash,
    });
    return createHash("sha256").update(envelope).digest("hex");
  }

  /**
   * Creates a new merge review proposal in PROPOSED state.
   */
  public static proposeMerge(
    match: DuplicateMatch,
    primary: DuplicatePromptRecord,
    duplicate: DuplicatePromptRecord,
    actor: string,
    now: Date = new Date(),
  ): MergeReviewProposal {
    const trimmedActor = (actor || "").trim().toLowerCase();
    if (!trimmedActor) {
      throw new MergeReviewError("MISSING_ACTOR", "Proposer actor is required.");
    }
    if (duplicate.mergedInto) {
      throw new MergeReviewError("ALREADY_MERGED", `Duplicate ${duplicate.id} is already merged into ${duplicate.mergedInto}`);
    }
    if (primary.id === duplicate.id) {
      throw new MergeReviewError("SELF_MERGE_FORBIDDEN", "Primary and duplicate cannot be the same record.");
    }

    const proposalId = `prop_${match.candidateId}`;
    const at = now.toISOString();
    const reason = `Proposed merge from detection match ${match.candidateId} (score: ${match.score})`;
    const hash = this.hashAuditEntry(proposalId, "PROPOSE", "PROPOSED", trimmedActor, at, reason, GENESIS_HASH);

    const initialEntry: ReviewAuditEntry = {
      action: "PROPOSE",
      actor: trimmedActor,
      at,
      from: null,
      to: "PROPOSED",
      reason,
      previousHash: GENESIS_HASH,
      hash,
    };

    return {
      proposalId,
      candidateId: match.candidateId,
      primaryId: primary.id,
      duplicateId: duplicate.id,
      initialDuplicateVersion: duplicate.version,
      status: "PROPOSED",
      proposedBy: trimmedActor,
      snapshot: {
        primary: { id: primary.id, title: primary.title },
        duplicate: {
          id: duplicate.id,
          title: duplicate.title,
          version: duplicate.version,
          visible: duplicate.visible,
        },
      },
      history: [initialEntry],
      createdAt: now,
      updatedAt: now,
    };
  }

  /**
   * Reviews a proposal with Four-Eyes Principle enforcement.
   * Proposer cannot review their own proposal.
   */
  public static reviewProposal(
    proposal: MergeReviewProposal,
    reviewer: string,
    decision: "APPROVE" | "REJECT",
    reason: string,
    now: Date = new Date(),
  ): MergeReviewProposal {
    const trimmedReviewer = (reviewer || "").trim().toLowerCase();
    if (!trimmedReviewer) {
      throw new MergeReviewError("MISSING_REVIEWER", "Reviewer identity is required.");
    }
    if (proposal.status !== "PROPOSED") {
      throw new MergeReviewError(
        "INVALID_TRANSITION",
        `Cannot review proposal in status ${proposal.status}. Expected PROPOSED.`
      );
    }
    if (trimmedReviewer === proposal.proposedBy.toLowerCase()) {
      throw new MergeReviewError(
        "SELF_REVIEW_FORBIDDEN",
        "Four-eyes policy violation: Proposer cannot approve or reject their own proposal."
      );
    }
    if (!reason || !reason.trim()) {
      throw new MergeReviewError("REASON_REQUIRED", "Review decision reason is required.");
    }

    const nextStatus: ReviewStatus = decision === "APPROVE" ? "APPROVED" : "REJECTED";
    const at = now.toISOString();
    const prevHash = proposal.history[proposal.history.length - 1].hash;
    const hash = this.hashAuditEntry(
      proposal.proposalId,
      decision,
      nextStatus,
      trimmedReviewer,
      at,
      reason,
      prevHash
    );

    const entry: ReviewAuditEntry = {
      action: decision,
      actor: trimmedReviewer,
      at,
      from: proposal.status,
      to: nextStatus,
      reason,
      previousHash: prevHash,
      hash,
    };

    return {
      ...proposal,
      status: nextStatus,
      history: [...proposal.history, entry],
      updatedAt: now,
    };
  }

  /**
   * Applies an APPROVED merge, setting the duplicate as an alias.
   * Guarantees buyer rights and contract integrity by preserving on-chain identity.
   */
  public static applyMerge(
    proposal: MergeReviewProposal,
    duplicate: DuplicatePromptRecord,
    actor: string,
    now: Date = new Date(),
  ): { proposal: MergeReviewProposal; updatedDuplicate: DuplicatePromptRecord } {
    if (proposal.status !== "APPROVED") {
      throw new MergeReviewError(
        "INVALID_TRANSITION",
        `Cannot apply proposal in status ${proposal.status}. Expected APPROVED.`
      );
    }
    if (duplicate.id !== proposal.duplicateId) {
      throw new MergeReviewError("ID_MISMATCH", "Target duplicate record does not match proposal.");
    }
    if (duplicate.version !== proposal.initialDuplicateVersion) {
      throw new MergeReviewError(
        "STALE_VERSION",
        `Duplicate has been updated since proposal (initial: ${proposal.initialDuplicateVersion}, current: ${duplicate.version}). Re-proposal required.`
      );
    }
    if (duplicate.mergedInto) {
      throw new MergeReviewError("ALREADY_MERGED", `Duplicate is already merged into ${duplicate.mergedInto}`);
    }

    const trimmedActor = (actor || "").trim().toLowerCase();
    const at = now.toISOString();
    const prevHash = proposal.history[proposal.history.length - 1].hash;
    const reason = `Merge applied into primary ${proposal.primaryId}`;
    const hash = this.hashAuditEntry(proposal.proposalId, "APPLY", "APPLIED", trimmedActor, at, reason, prevHash);

    const entry: ReviewAuditEntry = {
      action: "APPLY",
      actor: trimmedActor,
      at,
      from: proposal.status,
      to: "APPLIED",
      reason,
      previousHash: prevHash,
      hash,
    };

    const updatedDuplicate: DuplicatePromptRecord = {
      ...duplicate,
      visible: false,
      mergedInto: proposal.primaryId,
      version: duplicate.version + 1,
    };

    const updatedProposal: MergeReviewProposal = {
      ...proposal,
      status: "APPLIED",
      history: [...proposal.history, entry],
      updatedAt: now,
    };

    return { proposal: updatedProposal, updatedDuplicate };
  }

  /**
   * Reverts an APPLIED merge, restoring visibility and removing the alias.
   */
  public static revertMerge(
    proposal: MergeReviewProposal,
    duplicate: DuplicatePromptRecord,
    actor: string,
    reason: string,
    now: Date = new Date(),
  ): { proposal: MergeReviewProposal; restoredDuplicate: DuplicatePromptRecord } {
    if (proposal.status !== "APPLIED") {
      throw new MergeReviewError(
        "INVALID_TRANSITION",
        `Cannot revert proposal in status ${proposal.status}. Expected APPLIED.`
      );
    }
    if (!reason || !reason.trim()) {
      throw new MergeReviewError("REASON_REQUIRED", "Revert reason is required.");
    }
    if (duplicate.mergedInto !== proposal.primaryId) {
      throw new MergeReviewError(
        "CANNOT_REVERT",
        `Duplicate does not point to expected primary ${proposal.primaryId}`
      );
    }

    const trimmedActor = (actor || "").trim().toLowerCase();
    const at = now.toISOString();
    const prevHash = proposal.history[proposal.history.length - 1].hash;
    const hash = this.hashAuditEntry(proposal.proposalId, "REVERT", "REVERTED", trimmedActor, at, reason, prevHash);

    const entry: ReviewAuditEntry = {
      action: "REVERT",
      actor: trimmedActor,
      at,
      from: proposal.status,
      to: "REVERTED",
      reason,
      previousHash: prevHash,
      hash,
    };

    const restoredDuplicate: DuplicatePromptRecord = {
      ...duplicate,
      visible: proposal.snapshot.duplicate.visible,
      mergedInto: null,
      version: duplicate.version + 1,
    };

    const updatedProposal: MergeReviewProposal = {
      ...proposal,
      status: "REVERTED",
      history: [...proposal.history, entry],
      updatedAt: now,
    };

    return { proposal: updatedProposal, restoredDuplicate };
  }

  /**
   * Verifies the cryptographic audit history of a proposal.
   * Returns true if all hashes chain correctly from GENESIS_HASH.
   */
  public static verifyHistory(proposal: MergeReviewProposal): boolean {
    if (!proposal.history || proposal.history.length === 0) return false;

    let expectedPrev = GENESIS_HASH;
    for (const entry of proposal.history) {
      if (entry.previousHash !== expectedPrev) return false;
      const expectedHash = this.hashAuditEntry(
        proposal.proposalId,
        entry.action,
        entry.to,
        entry.actor,
        entry.at,
        entry.reason,
        entry.previousHash
      );
      if (entry.hash !== expectedHash) return false;
      expectedPrev = entry.hash;
    }
    return true;
  }
}

