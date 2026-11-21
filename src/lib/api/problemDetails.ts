/**
 * API problem-details taxonomy (RFC 9457 shaped) layered on the stable `ErrorCode`s.
 *
 * Every `ErrorCode` has exactly one `PROBLEMS` entry: the HTTP statuses it may be sent with
 * (first = canonical), a stable title, a remediation hint, and whether retrying can help.
 * User-facing text always comes from `ERROR_MESSAGES`, never from internals.
 *
 * Compatibility: the default response body is still the legacy `{ error, code, ... }` shape.
 * Clients opt in to `application/problem+json` with `Accept: application/problem+json`;
 * that body is a superset (it keeps `error` and `code`). See docs/error-code-reference.md.
 */

import { apiError, ERROR_MESSAGES, type ApiErrorResponse, type ErrorCode } from "./errorCodes";

export const PROBLEM_CONTENT_TYPE = "application/problem+json";
export const PROBLEM_TYPE_PREFIX = "urn:prompthash:problem:";
export const PROBLEM_DOCS_PATH = "docs/error-code-reference.md";

export interface ProblemDefinition {
  /** Allowed HTTP statuses. The first is canonical; others are legacy statuses still emitted. */
  statuses: readonly [number, ...number[]];
  /** Short, stable, human-readable summary of the problem class (RFC 9457 `title`). */
  title: string;
  /** What the caller should do next. Safe to show to integrators. */
  remediation: string;
  /** Whether retrying the same request can succeed after the remediation. */
  retryable: boolean;
}

export const PROBLEMS: Record<ErrorCode, ProblemDefinition> = {
  MISSING_FIELDS: { statuses: [400], title: "Missing required fields", remediation: "Send every required field and retry.", retryable: false },
  INVALID_INPUT: { statuses: [400], title: "Invalid input", remediation: "Correct the invalid field value and retry.", retryable: false },
  VALIDATION_ERROR: { statuses: [400], title: "Validation failed", remediation: "Fix the request body to match the documented schema and retry.", retryable: false },
  STALE_REQUEST: { statuses: [400], title: "Stale request", remediation: "Regenerate the request with a current timestamp and retry.", retryable: true },
  METHOD_NOT_ALLOWED: { statuses: [405], title: "Method not allowed", remediation: "Use the HTTP method documented for this endpoint.", retryable: false },
  NOT_FOUND: { statuses: [404], title: "Resource not found", remediation: "Check the identifier; the record may not exist.", retryable: false },
  PROMPT_NOT_FOUND: { statuses: [404], title: "Prompt not found", remediation: "Check the prompt id; the listing may have been removed.", retryable: false },
  CHALLENGE_EXPIRED: { statuses: [400], title: "Challenge expired", remediation: "Request a new challenge and sign it promptly.", retryable: true },
  CHALLENGE_INVALID: { statuses: [400], title: "Challenge invalid", remediation: "Request a new challenge; do not reuse tokens across wallets or prompts.", retryable: true },
  INVALID_SIGNATURE: { statuses: [401, 400], title: "Invalid wallet signature", remediation: "Sign the exact challenge message with the wallet that requested it.", retryable: true },
  UNAUTHORIZED: { statuses: [403, 401], title: "Not authorized", remediation: "Authenticate with credentials that have permission for this action.", retryable: false },
  ACCESS_NOT_PURCHASED: { statuses: [403], title: "Access not purchased", remediation: "Purchase the prompt with this wallet, then retry.", retryable: false },
  STALE_PROMPT_TERMS: { statuses: [409], title: "Prompt terms changed", remediation: "Re-fetch the prompt, review the new price or version, and sign again.", retryable: true },
  INVALID_STATE: { statuses: [409], title: "Invalid state for action", remediation: "Check the record's current status; perform an allowed transition instead.", retryable: false },
  OPERATION_NOT_ALLOWED: { statuses: [400], title: "Operation not allowed", remediation: "This record cannot be modified this way; see the operation's documentation.", retryable: false },
  PERMISSION_DIFF_REQUIRED: { statuses: [409], title: "Permission review required", remediation: "Request a permission preview and submit its digest after review.", retryable: false },
  STALE_PERMISSION_DIFF: { statuses: [409], title: "Permission preview is stale", remediation: "Request and review a fresh permission preview before retrying.", retryable: true },
  IDEMPOTENCY_CONFLICT: { statuses: [409], title: "Idempotency key conflict", remediation: "Use a new idempotency key for a different request body.", retryable: false },
  DUPLICATE_EVENT: { statuses: [409], title: "Duplicate event", remediation: "No action needed; the event was already processed.", retryable: false },
  RATE_LIMIT_IP: { statuses: [429], title: "Rate limit exceeded (IP)", remediation: "Wait until the reset time, then retry with backoff.", retryable: true },
  RATE_LIMIT_WALLET: { statuses: [429], title: "Rate limit exceeded (wallet)", remediation: "Wait about a minute, then retry with backoff.", retryable: true },
  RATE_LIMIT_ENTITLEMENT: { statuses: [429], title: "Rate limit exceeded (prompt)", remediation: "Wait a moment before retrying unlock for this prompt.", retryable: true },
  CONFIGURATION_ERROR: { statuses: [500], title: "Server configuration error", remediation: "Not caused by the request. Contact the operator; see docs/environments.md.", retryable: false },
  INTEGRITY_FAILURE: { statuses: [500], title: "Content integrity check failed", remediation: "Do not use the content. Report to support with the correlation id.", retryable: false },
  TEMPORARY_FAILURE: { statuses: [500, 400, 401], title: "Temporary failure", remediation: "Retry after a short delay; if it persists, report the correlation id.", retryable: true },
  INTERNAL_ERROR: { statuses: [500], title: "Internal error", remediation: "Retry later; if it persists, report the correlation id.", retryable: true },
};

export interface ProblemDetails extends ApiErrorResponse {
  /** RFC 9457 problem type: a stable URN per code. */
  type: string;
  title: string;
  status: number;
  /** Safe, user-displayable explanation (same text as the legacy `error`). */
  detail: string;
  /** RFC 9457 `instance`: identifies this occurrence when a request id is known. */
  instance?: string;
  remediation: string;
  retryable: boolean;
  /** Repo-relative documentation anchor for this code. */
  docs: string;
}

export interface ProblemOptions {
  /** HTTP status actually sent. Defaults to the canonical status. */
  status?: number;
  /** Safe message override. Defaults to `ERROR_MESSAGES[code]`. */
  detail?: string;
  requestId?: string | null;
  reset?: number;
  correlationId?: string;
}

export function isErrorCode(value: unknown): value is ErrorCode {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(PROBLEMS, value);
}

export function problemType(code: ErrorCode): string {
  return `${PROBLEM_TYPE_PREFIX}${code}`;
}

/** Anchor GitHub generates for the `### CODE` heading (underscores are kept). */
export function problemDocsRef(code: ErrorCode): string {
  return `${PROBLEM_DOCS_PATH}#${code.toLowerCase()}`;
}

export function problemDetails(code: ErrorCode, options: ProblemOptions = {}): ProblemDetails {
  const def = PROBLEMS[code];
  const detail = options.detail ?? ERROR_MESSAGES[code];
  return {
    type: problemType(code),
    title: def.title,
    status: options.status ?? def.statuses[0],
    detail,
    ...(options.requestId ? { instance: `urn:prompthash:request:${options.requestId}` } : {}),
    code,
    error: detail,
    remediation: def.remediation,
    retryable: def.retryable,
    docs: problemDocsRef(code),
    ...(options.reset !== undefined ? { reset: options.reset } : {}),
    ...(options.correlationId ? { correlationId: options.correlationId } : {}),
  };
}

/** True when the caller prefers RFC 9457 output. */
export function wantsProblemJson(accept: string | string[] | undefined): boolean {
  const value = Array.isArray(accept) ? accept.join(",") : accept ?? "";
  return value.toLowerCase().includes(PROBLEM_CONTENT_TYPE);
}

interface ErrorRequest {
  headers?: Record<string, string | string[] | undefined>;
  requestId?: string | null;
}

interface ErrorResponse {
  setHeader(name: string, value: string): unknown;
  status(code: number): { json(body: unknown): unknown; send(body: string): unknown };
}

/**
 * Drop-in for `res.status(n).json(apiError(code, message, extra))`.
 *
 * Pass the status the endpoint already returns: this helper does not change statuses.
 * Without the problem+json `Accept` header the body is byte-for-byte the legacy shape.
 */
export function sendApiError(
  req: ErrorRequest,
  res: ErrorResponse,
  code: ErrorCode,
  message: string,
  options: { status: number; reset?: number; correlationId?: string },
): void {
  const { status, reset, correlationId } = options;
  if (wantsProblemJson(req.headers?.accept)) {
    res.setHeader("Content-Type", PROBLEM_CONTENT_TYPE);
    res
      .status(status)
      .send(
        JSON.stringify(
          problemDetails(code, { status, detail: message, requestId: req.requestId, reset, correlationId }),
        ),
      );
    return;
  }
  const extra: Partial<ApiErrorResponse> = {};
  if (reset !== undefined) extra.reset = reset;
  if (correlationId) extra.correlationId = correlationId;
  res.status(status).json(apiError(code, message, extra));
}
