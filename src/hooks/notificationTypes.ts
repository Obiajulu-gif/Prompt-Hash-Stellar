/**
 * Shared notification type enum mirroring the server-side NotificationType.
 * Kept in one place so the hook and component stay in sync with the API.
 */
export type NotificationType =
  | "prompt_update"
  | "purchase_confirmed"
  | "dispute_opened"
  | "dispute_resolved"
  | "payout_available"
  | "moderation_action"
  | "ownership_transfer"
  | "system";

/** Human-readable label for each notification type used in the UI. */
export const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  prompt_update: "Prompt Update",
  purchase_confirmed: "Purchase Confirmed",
  dispute_opened: "Dispute Opened",
  dispute_resolved: "Dispute Resolved",
  payout_available: "Payout Available",
  moderation_action: "Moderation Action",
  ownership_transfer: "Ownership Transfer",
  system: "System",
};
