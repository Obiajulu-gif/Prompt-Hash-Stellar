/**
 * Buyer-facing licence entitlement status — Issue #490.
 *
 * Derives a single, at-a-glance entitlement state for a prompt the buyer has
 * already purchased, requiring the latest ledger verification before a
 * receipt or unlock state can be treated as current access:
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
 *  - `verificationStatus` — did the latest ledger check confirm access?
 */
import type { UnlockState } from "@/components/UnlockExplainer";

export type EntitlementState =
  | "active"
  | "pending"
  | "unavailable"
  | "verification_needed"
  | "not_entitled"
  | "unverifiable";

export type ReferenceStatus = "ready" | "pending" | "unknown";
export type EntitlementVerificationStatus =
  | "verified"
  | "not_entitled"
  | "unverifiable"
  | "unknown";

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
  verificationStatus?: EntitlementVerificationStatus;
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
  verificationStatus = "unknown",
}: DeriveEntitlementStateParams): EntitlementDescriptor {
  if (verificationStatus === "not_entitled") {
    return {
      state: "not_entitled",
      label: "No current entitlement",
      summary:
        "The latest verified ledger state does not show an active licence for this wallet. Older purchase records do not grant current access.",
      unlockReadiness: "Access is unavailable until the on-chain entitlement is restored.",
    };
  }

  if (verificationStatus === "unverifiable" || verificationStatus === "unknown") {
    return {
      state: "unverifiable",
      label: "Unable to verify",
      summary:
        "Current on-chain entitlement could not be confirmed. A receipt or indexed purchase record alone is not proof of current access.",
      unlockReadiness: "Retry verification before relying on this licence.",
    };
  }

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
        "Your current on-chain entitlement is verified, but our indexer hasn't recorded a transaction reference yet. This is usually a short delay, not a failed purchase.",
      unlockReadiness: "Current access is verified; waiting for the receipt reference to finish indexing.",
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
