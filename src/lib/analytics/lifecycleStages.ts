/**
 * Lifecycle stages and event capture points.
 *
 * Browser-safe (no Node imports): imported by the client tracker, the server
 * ingest route and the analytics engine so all three agree on one vocabulary.
 *
 * Each workflow is an ordered list of stages. A journey "completes" when it
 * reaches the last stage. An event is either `reached` (the user got to that
 * stage) or `failed` (an attempt at that stage failed, with an allow-listed
 * reason). Docs: docs/lifecycle-analytics.md
 */

export type LifecycleKind = "reached" | "failed";

export interface LifecycleStageDef {
  id: string;
  label: string;
  /** Where the event is emitted, for maintainers adding/auditing capture. */
  capturePoint: string;
}

export interface LifecycleWorkflowDef {
  label: string;
  stages: readonly LifecycleStageDef[];
}

export const LIFECYCLE_WORKFLOWS = {
  purchase: {
    label: "Buyer purchase and unlock",
    stages: [
      {
        id: "detail_viewed",
        label: "Viewed prompt detail",
        capturePoint: "src/pages/browse/PromptModal.tsx — modal opens for a prompt",
      },
      {
        id: "purchase_started",
        label: "Started purchase",
        capturePoint: "src/pages/browse/PromptModal.tsx — runPurchase begins (failed: wallet/network/signing/tx errors)",
      },
      {
        id: "payment_confirmed",
        label: "Payment confirmed on Stellar",
        capturePoint: "src/pages/browse/PromptModal.tsx — runPurchase onSuccess",
      },
      {
        id: "unlock_succeeded",
        label: "Prompt unlocked",
        capturePoint: "src/pages/browse/PromptModal.tsx — runUnlock onSuccess (failed: runUnlock onError)",
      },
    ],
  },
  publish: {
    label: "Creator publishing",
    stages: [
      {
        id: "form_opened",
        label: "Opened the listing form",
        capturePoint: "src/pages/sell/CreatePromptForm.tsx — form mounts",
      },
      {
        id: "publish_submitted",
        label: "Submitted for publishing",
        capturePoint: "src/pages/sell/CreatePromptForm.tsx — onSubmit passes validation (failed: guard/validation errors)",
      },
      {
        id: "publish_confirmed",
        label: "Listing confirmed on-chain",
        capturePoint: "src/pages/sell/CreatePromptForm.tsx — createPrompt result.success (failed: unconfirmed / thrown)",
      },
    ],
  },
} as const satisfies Record<string, LifecycleWorkflowDef>;

export type LifecycleWorkflow = keyof typeof LIFECYCLE_WORKFLOWS;
export const LIFECYCLE_WORKFLOW_IDS = Object.keys(LIFECYCLE_WORKFLOWS) as LifecycleWorkflow[];

export function workflowDef(workflow: LifecycleWorkflow): LifecycleWorkflowDef {
  return LIFECYCLE_WORKFLOWS[workflow];
}

export function stageIds(workflow: LifecycleWorkflow): string[] {
  return workflowDef(workflow).stages.map((s) => s.id);
}

export function stageIndex(workflow: LifecycleWorkflow, stage: string): number {
  return stageIds(workflow).indexOf(stage);
}

/**
 * Failure reasons are an allow-list. Anything else (free text, error
 * messages that may embed addresses, emails or amounts) collapses to
 * `other`, so a reason can never carry personal data.
 */
export const LIFECYCLE_FAILURE_REASONS = [
  "user_rejected",
  "wallet_not_connected",
  "wallet_connect_failed",
  "wallet_wrong_network",
  "signature_failed",
  "tx_submission_failed",
  "tx_insufficient_balance",
  "tx_network_error",
  "tx_confirmation_timeout",
  "unlock_no_access",
  "unlock_rate_limited",
  "unlock_integrity_failed",
  "validation_error",
  "payout_setup_incomplete",
  "moderation_restricted",
  "offline",
  "unknown_error",
] as const;

export type LifecycleFailureReason = (typeof LIFECYCLE_FAILURE_REASONS)[number] | "other";

export function sanitizeFailureReason(raw: unknown): LifecycleFailureReason {
  if (typeof raw !== "string") return "other";
  const slug = raw.trim().toLowerCase();
  return (LIFECYCLE_FAILURE_REASONS as readonly string[]).includes(slug)
    ? (slug as LifecycleFailureReason)
    : "other";
}
