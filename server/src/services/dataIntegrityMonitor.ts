import connectDb from "../db/connectDb";
import Prompt from "../models/Prompt";
import User from "../models/User";
import { InvariantResult, DOMAIN_INVARIANTS } from "./domainInvariants";

export interface IntegrityFailure {
  invariantId: string;
  name: string;
  promptId: string;
  details: Record<string, unknown>;
  severity: "critical" | "warning" | "info";
}

export interface DataIntegrityReport {
  generatedAt: string;
  totalRecordsChecked: number;
  orphanedCount: number;
  duplicateCount: number;
  staleCount: number;
  inconsistentCount: number;
  totalFailures: number;
  failures: IntegrityFailure[];
}

interface OrphanedRecordCheck {
  promptId: string;
  reason: string;
  field: string;
  value: unknown;
}

interface DuplicateRecordCheck {
  promptId: string;
  onChainId: string;
  collisionCount: number;
}

interface StaleRecordCheck {
  promptId: string;
  lastUpdated: Date;
  ageDays: number;
  reason: string;
}

interface InconsistentRecordCheck {
  promptId: string;
  field: string;
  expected: unknown;
  actual: unknown;
  reason: string;
}

/**
 * Checks for orphaned records - references to non-existent entities
 * Orphaned prompts: onChainId exists but no corresponding on-chain record,
 * or references to users/categories that don't exist.
 */
async function checkOrphanedRecords(): Promise<IntegrityFailure[]> {
  await connectDb();
  const failures: IntegrityFailure[] = [];

  // Check for prompts with onChainId that reference non-existent on-chain entities
  // (We treat onChainId as "orphaned" if the prompt exists but the on-chain
  // reference is stale/missing - this is checked via the indexer state)
  const promptsWithOnChainId = await Prompt.find({
    onChainId: { $exists: true, $ne: "" },
  })
    .select("onChainId owner title")
    .lean();

  for (const prompt of promptsWithOnChainId) {
    // Check if owner exists
    const ownerExists = await User.exists({ _id: prompt.owner });
    if (!ownerExists) {
      failures.push({
        invariantId: "INV-ORPHAN-01",
        name: DOMAIN_INVARIANTS.INV_03_VALID_OWNERSHIP_ON_SALE,
        promptId: prompt.onChainId || prompt._id.toString(),
        details: {
          field: "owner",
          value: prompt.owner,
          reason: "Owner reference does not exist in User collection",
        },
        severity: "critical",
      });
    }

    // Check for prompts with invalid category values not in the enum
    const validCategories = ["Other", "Art", "Writing", "Code", "Music", "Video", "Design"];
    if (!validCategories.includes(prompt.category)) {
      failures.push({
        invariantId: "INV-ORPHAN-02",
        name: "INV-ORPHAN-02: Prompt category must be a valid enum value",
        promptId: prompt._id.toString(),
        details: {
          field: "category",
          value: prompt.category,
          reason: "Category value is not in the allowed enum",
        },
        severity: "warning",
      });
    }
  }

  return failures;
}

/**
 * Checks for duplicate records - prompts with duplicate onChainId or
 * duplicate content that should be unique.
 */
async function checkDuplicateRecords(): Promise<IntegrityFailure[]> {
  await connectDb();
  const failures: IntegrityFailure[] = [];

  // Check for duplicate onChainId values (should be unique)
  const onChainIdCounts = await Prompt.aggregate([
    { $match: { onChainId: { $exists: true, $ne: "" } } },
    { $group: { _id: "$onChainId", count: { $sum: 1 }, promptIds: { $push: "$_id" } } },
    { $match: { count: { $gt: 1 } } },
  ]);

  for (const collision of onChainIdCounts) {
    failures.push({
      invariantId: "INV-DUP-01",
      name: DOMAIN_INVARIANTS.INV_06_UNIQUE_TOKEN_ID,
      promptId: collision._id,
      details: {
        field: "onChainId",
        collisionCount: collision.count,
        collidingPromptIds: collision.promptIds.slice(0, 5),
        reason: `Duplicate onChainId found: ${collision._id} appears ${collision.count} times`,
      },
      severity: "critical",
    });
  }

  // Check for prompts with identical encryptedPrompt + contentHash combinations
  // that should be unique but aren't (potential duplicate content)
  const contentHashCounts = await Prompt.aggregate([
    { $match: { contentHash: { $exists: true, $ne: null } } },
    {
      $group: {
        _id: { contentHash: "$contentHash", title: "$title" },
        count: { $sum: 1 },
        promptIds: { $push: "$_id" },
      },
    },
    { $match: { count: { $gt: 1 } } },
  ]);

  for (const dup of contentHashCounts) {
    failures.push({
      invariantId: "INV-DUP-02",
      name: "INV-DUP-02: Duplicate content hash and title combination",
      promptId: dup._id.contentHash,
      details: {
        field: "contentHash + title",
        collisionCount: dup.count,
        collidingPromptIds: dup.promptIds.slice(0, 5),
        reason: `Duplicate content hash and title combination found: ${dup._id.contentHash}`,
      },
      severity: "warning",
    });
  }

  return failures;
}

/**
 * Checks for stale records - prompts that haven't been updated in a long time
 * or have lifecycle states that are inconsistent with their age.
 */
async function checkStaleRecords(
  staleThresholdDays: number = 365
): Promise<IntegrityFailure[]> {
  await connectDb();
  const failures: IntegrityFailure[] = [];

  const staleCutoff = new Date();
  staleCutoff.setDate(staleCutoff.getDate() - staleThresholdDays);

  const stalePrompts = await Prompt.find({
    $or: [
      { updatedAt: { $exists: true, $lt: staleCutoff } },
      { lifecycleUpdatedAt: { $exists: true, $lt: staleCutoff } },
    ],
  })
    .select("_id onChainId title isActive lifecycleState updatedAt lifecycleUpdatedAt")
    .lean();

  for (const prompt of stalePrompts) {
    const lastUpdated =
      prompt.updatedAt > (prompt.lifecycleUpdatedAt || prompt.updatedAt)
        ? prompt.updatedAt
        : prompt.lifecycleUpdatedAt;

    const ageDays = Math.floor(
      (new Date().getTime() - lastUpdated.getTime()) / (1000 * 60 * 60 * 24)
    );

    if (ageDays > staleThresholdDays) {
      // Check if stale prompt is still marked as active - this is inconsistent
      if (prompt.isActive && ageDays > 365 * 2) {
        failures.push({
          invariantId: "INV-STALE-01",
          name: "INV-STALE-01: Active prompt stale for over 2 years",
          promptId: prompt._id.toString(),
          details: {
            field: "isActive",
            ageDays,
            lifecycleState: prompt.lifecycleState,
            reason: `Prompt has been active for ${ageDays} days without updates`,
          },
          severity: "warning",
        });
      } else if (!prompt.isActive && ageDays > 365) {
        failures.push({
          invariantId: "INV-STALE-02",
          name: "INV-STALE-02: Inactive prompt stale for over 1 year",
          promptId: prompt._id.toString(),
          details: {
            field: "isActive",
            ageDays,
            lifecycleState: prompt.lifecycleState,
            reason: `Prompt has been inactive for ${ageDays} days`,
          },
          severity: "info",
        });
      }
    }

    // Check for lifecycle state inconsistency
    if (prompt.lifecycleState === "published" && !prompt.isActive) {
      failures.push({
        invariantId: "INV-STALE-03",
        name: "INV-STALE-03: Published prompt marked inactive",
        promptId: prompt._id.toString(),
        details: {
          field: "lifecycleState vs isActive",
          lifecycleState: prompt.lifecycleState,
          isActive: prompt.isActive,
          reason: "Published state but prompt is marked inactive",
        },
        severity: "warning",
      });
    }
  }

  return failures;
}

/**
 * Checks for inconsistent records - fields that don't match expected patterns
 * or business rules that are violated.
 */
async function checkInconsistentRecords(): Promise<IntegrityFailure[]> {
  await connectDb();
  const failures: IntegrityFailure[] = [];

  const prompts = await Prompt.find({
    $or: [
      { title: { $exists: true } },
      { content: { $exists: true } },
      { price: { $exists: true } },
    ],
  })
    .select(
      "_id onChainId title description category price isActive lifecycleState " +
        "similarityScore moderationStatus"
    )
    .lean();

  for (const prompt of prompts) {
    // Check: price must be positive for active listings
    if (prompt.isActive && (prompt.price == null || prompt.price <= 0)) {
      failures.push({
        invariantId: "INV-INCONS-01",
        name: "INV-INCONS-01: Active prompt has non-positive price",
        promptId: prompt._id.toString(),
        details: {
          field: "price",
          expected: "> 0",
          actual: prompt.price,
          reason: "Active listings must have a positive price",
        },
        severity: "critical",
      });
    }

    // Check: title length reasonableness
    if (prompt.title && prompt.title.length < 3) {
      failures.push({
        invariantId: "INV-INCONS-02",
        name: "INV-INCONS-02: Title too short (less than 3 chars)",
        promptId: prompt._id.toString(),
        details: {
          field: "title",
          expected: ">= 3 chars",
          actual: prompt.title.length,
          reason: "Prompt title is unusually short",
        },
        severity: "info",
      });
    }

    // Check: category consistency with title/content hints
    if (prompt.category && prompt.title) {
      const lowerTitle = prompt.title.toLowerCase();
      const categoryKeywords: Record<string, string[]> = {
        Art: ["art", "painting", "draw", "canvas"],
        Writing: ["write", "story", "poem", "text"],
        Code: ["code", "program", "function", "api"],
        Music: ["music", "song", "melody", "lyrics"],
        Video: ["video", "clip", "footage", "recording"],
        Design: ["design", "ui", "ux", "layout"],
      };

      const matchedKeywords = categoryKeywords[prompt.category] || [];
      const hasMatch = matchedKeywords.some((kw) => lowerTitle.includes(kw));

      if (!hasMatch && prompt.category !== "Other") {
        // Not a hard failure, just a warning about possible mismatch
        failures.push({
          invariantId: "INV-INCONS-03",
          name: "INV-INCONS-03: Category may not match title content",
          promptId: prompt._id.toString(),
          details: {
            field: "category vs title",
            category: prompt.category,
            title: prompt.title.substring(0, 50),
            reason: "Category does not appear to match title keywords",
          },
          severity: "info",
        });
      }
    }

    // Check: similarityScore bounds if present
    if (prompt.similarityScore != null) {
      if (prompt.similarityScore < 0 || prompt.similarityScore > 1) {
        failures.push({
          invariantId: "INV-INCONS-04",
          name: "INV-INCONS-04: Similarity score out of valid range [0,1]",
          promptId: prompt._id.toString(),
          details: {
            field: "similarityScore",
            expected: "0-1",
            actual: prompt.similarityScore,
            reason: "Similarity score is outside valid bounds",
          },
          severity: "critical",
        });
      }
    }

    // Check: moderationStatus consistency with lifecycleState
    if (prompt.moderationStatus && prompt.lifecycleState) {
      const incompatiblePairs: [string, string][] = [
        ["retired", "published"],
        ["restricted", "draft"],
      ];
      for (const [modStatus, lifecycle] of incompatiblePairs) {
        if (prompt.moderationStatus === modStatus && prompt.lifecycleState === lifecycle) {
          failures.push({
            invariantId: "INV-INCONS-05",
            name: "INV-INCONS-05: Moderation/lifecycle state inconsistency",
            promptId: prompt._id.toString(),
            details: {
              field: "moderationStatus vs lifecycleState",
              moderationStatus: prompt.moderationStatus,
              lifecycleState: prompt.lifecycleState,
              reason: `Moderation status ${prompt.moderationStatus} incompatible with lifecycle ${prompt.lifecycleState}`,
            },
            severity: "warning",
          });
          break;
        }
      }
    }
  }

  return failures;
}

/**
 * Runs a comprehensive data integrity audit sweep across all stored prompt listings.
 * Detects orphaned, duplicate, stale, and inconsistent records.
 * This is a read-only operation by default - it does not modify any record states.
 */
export async function runDataIntegrityCheck(): Promise<DataIntegrityReport> {
  await connectDb();
  const now = new Date().toISOString();

  const [orphanedFailures, duplicateFailures, staleFailures, inconsistentFailures] =
    await Promise.all([
      checkOrphanedRecords(),
      checkDuplicateRecords(),
      checkStaleRecords(),
      checkInconsistentRecords(),
    ]);

  const allFailures = [
    ...orphanedFailures,
    ...duplicateFailures,
    ...staleFailures,
    ...inconsistentFailures,
  ];

  // Count records checked (total unique prompts examined)
  const totalRecordsChecked = await Prompt.countDocuments();

  const report: DataIntegrityReport = {
    generatedAt: now,
    totalRecordsChecked,
    orphanedCount: orphanedFailures.length,
    duplicateCount: duplicateFailures.length,
    staleCount: staleFailures.length,
    inconsistentCount: inconsistentFailures.length,
    totalFailures: allFailures.length,
    failures: allFailures,
  };

  console.log(
    `[data-integrity] Audit complete: total=${totalRecordsChecked} orphaned=${orphanedFailures.length} duplicate=${duplicateFailures.length} stale=${staleFailures.length} inconsistent=${inconsistentFailures.length}`
  );

  return report;
}

/**
 * Generates a human-readable remediation guidance report for each failure category.
 * This is pure information - does not modify any records.
 */
export function generateRemediationGuidance(report: DataIntegrityReport): string {
  const lines: string[] = [];

  lines.push("# Data Integrity Remediation Guidance");
  lines.push(`*Generated: ${new Date().toISOString()}*`);
  lines.push("");

  const categoryCounts = [
    { count: report.orphanedCount, label: "Orphaned Records" },
    { count: report.duplicateCount, label: "Duplicate Records" },
    { count: report.staleCount, label: "Stale Records" },
    { count: report.inconsistentCount, label: "Inconsistent Records" },
  ];

  for (const { count, label } of categoryCounts) {
    lines.push(`## ${label} (${count})`);
    lines.push("");

    // Filter failures for this category
    const categoryFailures = report.failures.filter((f) => {
      return (
        label === "Orphaned Records"
          ? f.invariantId.startsWith("INV-ORPHAN")
          : label === "Duplicate Records"
          ? f.invariantId.startsWith("INV-DUP")
          : label === "Stale Records"
          ? f.invariantId.startsWith("INV-STALE")
          : f.invariantId.startsWith("INV-INCONS")
      );
    });

    if (categoryFailures.length === 0) {
      lines.push("No failures found in this category.");
      lines.push("");
      continue;
    }

    for (const failure of categoryFailures) {
      lines.push(`### ${failure.name}`);
      lines.push(`- **Prompt ID**: \`${failure.promptId}\``);
      lines.push(`- **Severity**: \`${failure.severity}\``);
      lines.push(`- **Details**: \`${JSON.stringify(failure.details, null, 2)}\``);
      lines.push("");

      // Provide specific remediation advice based on invariant ID
      const remediation = getRemediationAdvice(failure.invariantId, failure.details);
      if (remediation) {
        lines.push(`**Remediation**: ${remediation}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function getRemediationAdvice(
  invariantId: string,
  details: Record<string, unknown>
): string | undefined {
  switch (invariantId) {
    case "INV-ORPHAN-01":
      return "Reassign or remove the prompt. If the owner account is valid, update the owner reference. If the owner is deleted, consider transferring ownership or archiving the prompt.";

    case "INV-ORPHAN-02":
      return "Update the prompt's category to a valid enum value from the allowed categories.";

    case "INV-DUP-01":
      return "Investigate which prompt is the original vs duplicate. Keep the most recent/relevant one and remove or merge the duplicate. Update any references to the onChainId accordingly.";

    case "INV-DUP-02":
      return "Review the duplicate content hashes. If the prompts are genuinely duplicate content, keep the original and archive/merge the duplicates. If they are different prompts with coincidental hash matches, investigate further.";

    case "INV-STALE-01":
      return "Either update the prompt content/metadata to refresh the timestamp, or mark the prompt as archived/suspended if it's no longer active.";

    case "INV-STALE-02":
      return "Consider archiving or purging the inactive prompt if it's older than 1 year with no activity.";

    case "INV-STALE-03":
      return "Either set the prompt back to active (if it should be published) or change the lifecycleState to match the moderation status.";

    case "INV-INCONS-01":
      return "Set a positive price for the active listing. Use the pricing service to determine appropriate pricing.";

    case "INV-INCONS-02":
      return "Update the title to be at least 3 characters long, or merge/archive the prompt if the short title is unintended.";

    case "INV-INCONS-03":
      return "Either update the category to better reflect the title content, or update the title to match the intended category.";

    case "INV-INCONS-04":
      return "Fix the similarity score to be within the valid range [0, 1]. Investigate how the score was computed if it's unexpectedly outside this range.";

    case "INV-INCONS-05":
      return "Resolve the moderation/lifecycle inconsistency. Typically: set moderationStatus to 'none' or 'approved' for published lifecycles, or adjust the lifecycleState to match the moderation decision.";

    default:
      return undefined;
  }
}

export default runDataIntegrityCheck;