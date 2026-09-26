/**
 * Bulk listing actions — issue #500.
 *
 * Runs activate / pause / retire against a set of creator-owned listings.
 * Each listing update is still an individual on-chain `set_prompt_sale_status`
 * call (the contract has no batched entrypoint), so this module's job is to:
 *
 *  - reject listings the caller does not own before signing anything,
 *  - run the per-listing calls with bounded concurrency so a large selection
 *    doesn't fire dozens of simultaneous wallet-signing prompts,
 *  - keep going on individual failures and report a per-listing outcome
 *    instead of aborting the whole batch.
 *
 * Complexity: for n selected listings and a concurrency cap c, time is
 * O(n / c) wallet round-trips and space is O(n) for the result list — both
 * are the minimum possible, since every listing needs its own signed
 * transaction and its own reported outcome.
 */
import type { WalletTransactionSigner } from "@/lib/stellar/tx";
import type { PromptHashConfig } from "@/lib/stellar/promptHashClient";
import { setPromptSaleStatus } from "@/lib/stellar/promptHashClient";
import { archivePrompt } from "@/lib/prompts/PromptArchiveStore";

/** Bulk actions available on creator listings (issue #500). */
export type BulkListingAction = "activate" | "pause" | "retire";

/** Minimal listing shape the bulk runner needs — matches the fields already
 * present on prompts returned by `getPromptsByCreator`. */
export interface BulkListingTarget {
  id: bigint;
  title: string;
  creatorAddress: string;
  active: boolean;
}

export interface BulkListingResult {
  promptId: string;
  title: string;
  success: boolean;
  /** Present when `success` is false. */
  error?: string;
}

interface BulkActionRunnerDeps {
  config: PromptHashConfig;
  signer: WalletTransactionSigner;
  address: string;
}

/** Actions that permanently remove a listing from active management and
 * therefore require an explicit confirmation step in the UI. */
export const IRREVERSIBLE_BULK_ACTIONS: ReadonlySet<BulkListingAction> = new Set([
  "retire",
]);

const DEFAULT_CONCURRENCY = 3;

function actionLabel(action: BulkListingAction): string {
  switch (action) {
    case "activate":
      return "activated";
    case "pause":
      return "paused";
    case "retire":
      return "retired";
  }
}

/** Guards against acting on a listing the caller does not own. Ownership is
 * also enforced on-chain via `require_auth`, but rejecting here avoids
 * prompting the user to sign a transaction that would only fail later. */
export function assertOwnedListings(
  targets: BulkListingTarget[],
  address: string,
): { owned: BulkListingTarget[]; rejected: BulkListingResult[] } {
  const owned: BulkListingTarget[] = [];
  const rejected: BulkListingResult[] = [];

  for (const target of targets) {
    if (target.creatorAddress === address) {
      owned.push(target);
    } else {
      rejected.push({
        promptId: target.id.toString(),
        title: target.title,
        success: false,
        error: "You do not own this listing.",
      });
    }
  }

  return { owned, rejected };
}

async function applyAction(
  action: BulkListingAction,
  target: BulkListingTarget,
  deps: BulkActionRunnerDeps,
): Promise<BulkListingResult> {
  const promptId = target.id.toString();
  try {
    if (action === "activate") {
      await setPromptSaleStatus(
        deps.config,
        deps.signer,
        deps.address,
        promptId,
        true,
      );
    } else {
      // "pause" and "retire" both stop the listing from being sold.
      // Retire additionally archives it out of the default management view;
      // the contract has no separate retired state on this code path, so
      // archiving is what makes the action distinct — and, unlike pause,
      // is not meant to be casually reversed from the active-listings view.
      await setPromptSaleStatus(
        deps.config,
        deps.signer,
        deps.address,
        promptId,
        false,
      );
      if (action === "retire") {
        archivePrompt(deps.address, promptId);
      }
    }
    return { promptId, title: target.title, success: true };
  } catch (error) {
    return {
      promptId,
      title: target.title,
      success: false,
      error:
        error instanceof Error
          ? error.message
          : `Failed to mark listing as ${actionLabel(action)}.`,
    };
  }
}

/**
 * Runs `action` against every owned target with at most `concurrency`
 * requests in flight at once. Listings the caller does not own are reported
 * as failures without ever being submitted to the wallet.
 */
export async function runBulkListingAction(
  action: BulkListingAction,
  targets: BulkListingTarget[],
  deps: BulkActionRunnerDeps,
  onResult?: (result: BulkListingResult) => void,
  concurrency: number = DEFAULT_CONCURRENCY,
): Promise<BulkListingResult[]> {
  const { owned, rejected } = assertOwnedListings(targets, deps.address);
  rejected.forEach((result) => onResult?.(result));

  const results: BulkListingResult[] = [...rejected];
  let cursor = 0;

  async function worker(): Promise<void> {
    while (cursor < owned.length) {
      const target = owned[cursor];
      cursor += 1;
      const result = await applyAction(action, target, deps);
      results.push(result);
      onResult?.(result);
    }
  }

  const workerCount = Math.max(1, Math.min(concurrency, owned.length));
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return results;
}
