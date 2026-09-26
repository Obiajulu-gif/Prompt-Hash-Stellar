import type { ScannerInput } from "../moderation/types.js";

/** Scanner outcome categories: allow publishes normally, queue defers to a
 * maintainer, block refuses publication outright (reserved for high-confidence
 * matches such as child-safety material). */
export type ScannerVerdict = "allow" | "queue" | "block";

/** Full result of a scanner run. */
export interface ScannerResult {
  verdict: ScannerVerdict;
  reasons: string[];
  ruleIds: string[];
  /** False when the scanner could not run (fail-safe path). */
  scanned: boolean;
}

/**
 * Built-in heuristic safety scanner for prompt publication (#758).
 *
 * Fully offline and deterministic so tests and CI are stable. Deliberately
 * conservative: heuristics can only *queue* a prompt for human review — the
 * allow verdict is the default and a hard block requires a high-confidence
 * match (child-safety terms).
 *
 * The provider stays behind the {@link SafetyScanner} interface so a managed
 * classifier can be swapped in without touching call sites. `scanUnavailable`
 * is the fail-safe answer: when scanning cannot run, publication proceeds but
 * the prompt is marked unscanned rather than trusted or blocked.
 */

/** Rules that only queue a prompt for human review. */
const QUEUE_RULES: Array<{ id: string; patterns: RegExp[]; reason: string }> = [
  {
    id: "violence",
    patterns: [/\bhow\s+to\s+(make|build)\s+(a\s+)?(bomb|explosive|weapon)\b/i],
    reason: "Possible weapons/violence instruction content",
  },
  {
    id: "self-harm",
    patterns: [/\b(suicide|self[- ]harm)\b/i],
    reason: "Possible self-harm related content",
  },
  {
    id: "malware",
    patterns: [/\b(keylogger|ransomware|credit\s+card\s+dump)\b/i],
    reason: "Possible malware or fraud instruction content",
  },
  {
    id: "hate-speech",
    patterns: [/\b(dehumanize|ethnic\s+cleansing)\b/i],
    reason: "Possible hate speech content",
  },
  {
    id: "sexual",
    patterns: [/\b(explicit\s+sexual\s+content)\b/i],
    reason: "Possible explicit sexual content",
  },
];

/** High-confidence rules that block publication outright. */
const BLOCK_RULES: Array<{ id: string; patterns: RegExp[]; reason: string }> = [
  {
    id: "child-safety",
    patterns: [/\bchild\s+(porn|sexual\s+abuse)\b/i, /\bcsam\b/i],
    reason: "Child safety material is strictly prohibited",
  },
];

export type SafetyScanner = {
  scan(input: ScannerInput): Promise<ScannerResult>;
};

export type ScannerOutcome = {
  verdict: ScannerVerdict;
  reasons: string[];
  ruleIds: string[];
  scanned: boolean;
};

function scanFields(input: ScannerInput): ScannerOutcome {
  const haystack = [
    input.title,
    input.description,
    input.category,
    ...(input.tags ?? []),
    input.preview,
    input.payload,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join("\n");

  const reasons: string[] = [];
  const ruleIds: string[] = [];

  for (const rule of QUEUE_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      ruleIds.push(rule.id);
      reasons.push(rule.reason);
    }
  }

  for (const rule of BLOCK_RULES) {
    if (rule.patterns.some((pattern) => pattern.test(haystack))) {
      ruleIds.push(rule.id);
      reasons.push(rule.reason);
    }
  }

  const verdict: ScannerVerdict =
    ruleIds.some((id) => BLOCK_RULES.some((rule) => rule.id === id))
      ? "block"
      : ruleIds.length > 0
        ? "queue"
        : "allow";

  return { verdict, reasons, ruleIds, scanned: true };
}

/**
 * Heuristic scanner provider. Returns a blocked/queued verdict with a reason
 * per matched rule; `allow` when nothing matches.
 */
export async function scanPromptContent(input: ScannerInput): Promise<ScannerResult> {
  const outcome = scanFields(input);
  return {
    verdict: outcome.verdict,
    reasons: outcome.reasons,
    ruleIds: outcome.ruleIds,
    scanned: outcome.scanned,
  };
}

/** Failsafe result used when no scanner is configured or scanning throws. */
export function scanUnavailable(reason: string): ScannerResult {
  return {
    verdict: "allow",
    reasons: [`Scanner unavailable: ${reason}`],
    ruleIds: [],
    scanned: false,
  };
}

/** Wraps a scanner so a throwing provider degrades to the failsafe result. */
export function withFailSafe(scanner: SafetyScanner | null): SafetyScanner {
  return {
    async scan(input) {
      if (!scanner) return scanUnavailable("no scanner configured");
      try {
        return await scanner.scan(input);
      } catch (err) {
        return scanUnavailable(err instanceof Error ? err.message : String(err));
      }
    },
  };
}
