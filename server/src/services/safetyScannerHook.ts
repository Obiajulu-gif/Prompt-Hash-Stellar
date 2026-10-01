import Prompt from "../models/Prompt";
import { scanPromptContent, scanUnavailable, type ScannerOutcome } from "./safetyScanner";
import { statusFromVerdict } from "../moderation/types";
import type { ScannerInput } from "../moderation/types";
import { logger } from "./structuredLogger";

/**
 * Runs the safety scanner for an indexed prompt and persists the verdict
 * (#758). Kept separate from {@link safetyScanner} so the provider stays
 * storage-agnostic and the indexer hook stays thin.
 *
 * Fail-safe: any persistence error is logged and swallowed — the indexer
 * loop must never stall on moderation bookkeeping, and a failed scan leaves
 * the prompt unscanned (visible) rather than blocked.
 */
export async function applySafetyScan(promptId: string, input: ScannerInput): Promise<void> {
  let outcome: ScannerOutcome;
  try {
    const result = await scanPromptContent(input);
    outcome = {
      verdict: result.verdict,
      reasons: result.reasons,
      ruleIds: result.ruleIds,
      scanned: result.scanned,
    };
  } catch (err) {
    // The scanner interface is synchronous-safe, but a provider swap could
    // throw before the failsafe wrapper does — degrade identically.
    logger.error("Safety scanner threw", {
      action: "safetyScan",
      promptId,
      error: err instanceof Error ? err.message : String(err),
    });
    outcome = { ...scanUnavailable("scanner threw"), verdict: "allow" };
  }

  const status = statusFromVerdict(outcome.verdict, outcome.scanned);

  try {
    await Prompt.findOneAndUpdate(
      { onChainId: promptId },
      {
        $set: {
          scannerVerdict: outcome.scanned ? outcome.verdict : null,
          scannerRuleIds: outcome.ruleIds,
          scannerReasons: outcome.reasons,
          scannerScannedAt: new Date(),
          moderationStatus: status,
        },
      },
    );
  } catch (err) {
    logger.error("Safety scan persistence failed", {
      action: "safetyScan",
      promptId,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}
