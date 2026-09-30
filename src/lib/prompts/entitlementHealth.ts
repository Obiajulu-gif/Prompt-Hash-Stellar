/**
 * Entitlement health for a buyer-library entry (#784).
 *
 * Derived from the indexed purchase record and the purchase's
 * delivery/dispute record. Kept dependency-free so the library API
 * (server/src/services/buyerLibrary.ts) and the UI derive the same state.
 */

export type EntitlementHealth = "active" | "refunded" | "revoked" | "recovery_needed";

export interface EntitlementHealthInput {
  /** Purchase.status — "purchased" | "disputed" | "resolved" | "revoked". */
  purchaseStatus?: string | null;
  /** Purchase.disputeResolution — "refunded" | "rejected". */
  disputeResolution?: string | null;
  /** FulfillmentRecord.status of the purchase, if one exists. */
  disputeStatus?: string | null;
}

/** Delivery states in which the buyer paid but cannot use the prompt yet. */
const RECOVERY_STATUSES = ["failed", "retrying", "refund_requested"];

export function deriveEntitlementHealth(input: EntitlementHealthInput): EntitlementHealth {
  if (input.disputeResolution === "refunded" || input.disputeStatus === "refunded") {
    return "refunded";
  }
  if (input.purchaseStatus === "revoked") {
    return "revoked";
  }
  if (
    input.purchaseStatus === "disputed" ||
    RECOVERY_STATUSES.includes(input.disputeStatus ?? "")
  ) {
    return "recovery_needed";
  }
  return "active";
}

/** Whether the licence still grants access to the prompt content. */
export function isEntitled(health: EntitlementHealth): boolean {
  return health === "active" || health === "recovery_needed";
}

export const ENTITLEMENT_HEALTH_COPY: Record<
  EntitlementHealth,
  { label: string; summary: string }
> = {
  active: {
    label: "Active",
    summary: "Your licence is in good standing.",
  },
  recovery_needed: {
    label: "Recovery needed",
    summary:
      "Your payment is confirmed but delivery needs attention. Retry the unlock or follow the dispute below.",
  },
  refunded: {
    label: "Refunded",
    summary: "This purchase was refunded, so the licence no longer grants access.",
  },
  revoked: {
    label: "Revoked",
    summary:
      "Access to this licence was revoked. Open the receipt or contact support if you think this is a mistake.",
  },
};
