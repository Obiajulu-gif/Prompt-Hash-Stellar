export type RejectionCode =
  | "validation"
  | "permission_denied"
  | "policy_violation"
  | "stale_state"
  | "external_service"
  | "not_found"
  | "conflict"
  | "rate_limited";

export interface RejectionExplanation {
  code: RejectionCode;
  /** Short, machine-readable reason key */
  reason: string;
  /** User-friendly message shown in UI */
  message: string;
  /** Actionable recovery hint */
  hint: string;
  /** Suggested API path or UI navigation for recovery */
  recoveryPath?: string;
  /** HTTP status code typically associated with this rejection */
  status: number;
}

/**
 * Rejection explanations mapped by rejection code.
 * Each entry provides a user-safe message and actionable recovery hint.
 * This is the single source of truth for rejection reason codes and messages.
 */
export const REJECTION_EXPLANATIONS: Record<RejectionCode, RejectionExplanation> = {
  validation: {
    code: "validation",
    reason: "validation_error",
    message: "Invalid input provided",
    hint: "Check the request parameters and try again.",
    recoveryPath: "/api/prompts",
    status: 400,
  },

  permission_denied: {
    code: "permission_denied",
    reason: "insufficient_permission",
    message: "You don't have permission to perform this action",
    hint: "Ensure you're authenticated as an authorized user or maintainer.",
    recoveryPath: "/api/auth/login",
    status: 403,
  },

  policy_violation: {
    code: "policy_violation",
    reason: "policy_violation",
    message: "This action violates platform policy",
    hint: "Review the platform guidelines and try a different approach.",
    recoveryPath: "/api/policies",
    status: 403,
  },

  stale_state: {
    code: "stale_state",
    reason: "stale_state",
    message: "The record is out of date or no longer applicable",
    hint: "Refresh the page or re-request the operation with current data.",
    recoveryPath: null,
    status: 409,
  },

  external_service: {
    code: "external_service",
    reason: "external_service_unavailable",
    message: "External service is temporarily unavailable",
    hint: "This is a temporary issue. Please try again in a moment.",
    recoveryPath: null,
    status: 502,
  },

  not_found: {
    code: "not_found",
    reason: "resource_not_found",
    message: "The requested resource could not be found",
    hint: "Verify the ID or path is correct, then try again.",
    recoveryPath: "/api/prompts",
    status: 404,
  },

  conflict: {
    code: "conflict",
    reason: "resource_conflict",
    message: "There is a conflict with the current state of the resource",
    hint: "Another operation may be in progress. Wait and try again.",
    recoveryPath: null,
    status: 409,
  },

  rate_limited: {
    code: "rate_limited",
    reason: "rate_limit_exceeded",
    message: "Too many requests. Please slow down.",
    hint: "Wait before making another request, or reduce the request frequency.",
    recoveryPath: null,
    status: 429,
  },
};

/**
 * Get a rejection explanation by code.
 * Returns the default "unknown rejection" explanation if code not found.
 */
export function getRejectionExplanation(code: RejectionCode): RejectionExplanation {
  return REJECTION_EXPLANATIONS[code] || REJECTION_EXPLANATIONS.not_found;
}

/**
 * Map a failure to a rejection explanation.
 * This function centralizes the mapping of internal error types to
 * user-facing rejection explanations with recovery hints.
 */
export function mapFailureToRejection(
  error: Error & { code?: string; status?: number },
): RejectionExplanation {
  const { code = "validation", status = 400 } = error;

  // Map known error codes to rejection explanations
  const mapping: Record<string, RejectionExplanation> = {
    // Validation errors
    "VALIDATION_ERROR": REJECTION_EXPLANATIONS.validation,
    "LIMIT_EXCEEDED": REJECTION_EXPLANATIONS.rate_limited,
    "INVALID_FORMAT": REJECTION_EXPLANATIONS.validation,
    "MISSING_REQUIRED": REJECTION_EXPLANATIONS.validation,

    // Permission errors
    "FORBIDDEN": REJECTION_EXPLANATIONS.permission_denied,
    "INSUFFICIENT_SCOPE": REJECTION_EXPLANATIONS.permission_denied,
    "UNAUTHORIZED": REJECTION_EXPLANATIONS.permission_denied,

    // Policy errors
    "POLICY_VIOLATION": REJECTION_EXPLANATIONS.policy_violation,

    // Stale state errors
    "STALE_RECORD": REJECTION_EXPLANATIONS.stale_state,
    "VERSION_MISMATCH": REJECTION_EXPLANATIONS.stale_state,

    // External service errors
    "EXTERNAL_TIMEOUT": REJECTION_EXPLANATIONS.external_service,
    "EXTERNAL_UNAVAILABLE": REJECTION_EXPLANATIONS.external_service,
    "NETWORK_ERROR": REJECTION_EXPLANATIONS.external_service,

    // Not found errors
    "NOT_FOUND": REJECTION_EXPLANATIONS.not_found,
    "RESOURCE_NOT_FOUND": REJECTION_EXPLANATIONS.not_found,

    // Conflict errors
    "CONFLICT": REJECTION_EXPLANATIONS.conflict,
    "DUPLICATE_RESOURCE": REJECTION_EXPLANATIONS.conflict,

    // Rate limit errors
    "RATE_LIMIT": REJECTION_EXPLANATIONS.rate_limited,
  };

  const mapped = mapping[code] || REJECTION_EXPLANATIONS.not_found;

  // Ensure status is correct
  mapped.status = status || mapped.status;

  return mapped;
}

export default mapFailureToRejection;