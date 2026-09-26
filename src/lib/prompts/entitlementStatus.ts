/**
 * Buyer-facing licence entitlement status — Issue #490.
 *
 * Derives a single, at-a-glance entitlement state for a prompt the buyer has
 * already purchased, from three independent signals:
 *
 *  - `listingActive`   — has the creator delisted the prompt (does not
 *                        revoke a licence already sold)?
 *  - `referenceStatus` — can we find the purchase's transaction/licence
 *                        reference (see `entitlementReceipt.ts`)? "pending"
 *                        means the backend hasn't indexed it yet — a delay,
 *                        not a failure.
 *  - `unlockState`     — has the buyer verified wallet ownership this
 *                        session to decrypt the content (see
 *                        `UnlockExplainer`'s `UnlockState`)?
 */
import type { UnlockState } from "@/components/UnlockExplainer";

export type EntitlementState =
  | "active"
  | "pending"
  | "unavailable"
  | "verification_needed";

export type ReferenceStatus = "ready" | "pending" | "unknown";

export interface EntitlementDescriptor {
  state: EntitlementState;
  label: string;
  summary: string;
  unlockReadiness: string;
}

export interface DeriveEntitlementStateParams {
  listingActive: boolean;
  referenceStatus: ReferenceStatus;
  unlockState: UnlockState;
}

const UNLOCK_RECOVERY_COPY: Partial<Record<UnlockState, string>> = {
  rejected:
    "You declined the wallet signature request. Retry any time — your licence is unaffected.",
  expired:
    "The verification challenge expired. Retry to get a fresh one — your licence is unaffected.",
  failed:
    "The last verification attempt failed. This does not affect your on-chain licence — retry to try again.",
};

export function deriveEntitlementState({
  listingActive,
  referenceStatus,
  unlockState,
}: DeriveEntitlementStateParams): EntitlementDescriptor {
  if (!listingActive) {
    return {
      state: "unavailable",
      label: "Unavailable",
      summary:
        "The creator has delisted this prompt. Your existing licence is unaffected — you can still unlock content you already purchased.",
      unlockReadiness:
        unlockState === "success"
          ? "Already unlocked."
          : "Unlock still works for licences you already own.",
    };
  }

  if (referenceStatus === "pending") {
    return {
      state: "pending",
      label: "Pending indexing",
      summary:
        "Your purchase is confirmed on-chain, but our indexer hasn't recorded a transaction reference yet. This is usually a short delay, not a failed purchase.",
      unlockReadiness: "Waiting for the purchase record to finish indexing.",
    };
  }

  if (unlockState === "success") {
    return {
      state: "active",
      label: "Active",
      summary:
        "Your licence is verified and the decrypted content is available below.",
      unlockReadiness: "Ready — content decrypted.",
    };
  }

  return {
    state: "verification_needed",
    label: "Verification needed",
    summary:
      UNLOCK_RECOVERY_COPY[unlockState] ??
      "Sign a free wallet message to verify ownership and unlock the decrypted content. This does not move funds.",
    unlockReadiness:
      unlockState === "signing" || unlockState === "verifying"
        ? "Verifying wallet signature…"
        : "Awaiting wallet verification.",
  };
}
