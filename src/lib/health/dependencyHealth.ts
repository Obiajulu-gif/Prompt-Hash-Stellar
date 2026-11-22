/**
 * Public dependency-aware health (#1179).
 *
 * `GET /api/health` publishes a redacted readiness view: one status per
 * dependency (`up`, `degraded`, `down`) and one overall status (`ok`,
 * `degraded`, `down`). This module normalises that payload for the public
 * status page and is deliberately defensive:
 *
 *  - only documented fields are copied, so an expanded server payload can
 *    never leak raw error text, hostnames, or observed values into the UI;
 *  - unknown statuses, reason codes and malformed entries are dropped rather
 *    than rendered;
 *  - an older deployment that answers with the legacy `{ status: "ok" }`
 *    shape is treated as "dependency health not reported" instead of failing.
 *
 * The retry helper turns `Retry-After` into a bounded delay so the page backs
 * off during an outage instead of hammering the endpoint.
 *
 * See docs/operations/public-health-endpoint.md.
 */

export const DEPENDENCY_STATUSES = ["up", "degraded", "down"] as const;
export type DependencyStatus = (typeof DEPENDENCY_STATUSES)[number];

export const OVERALL_HEALTH_STATES = ["ok", "degraded", "down"] as const;
export type OverallHealth = (typeof OVERALL_HEALTH_STATES)[number];

/** The only reason codes the server is allowed to publish. */
export const PUBLIC_REASON_CODES = [
  "timeout",
  "unreachable",
  "http_error",
  "unhealthy",
  "check_failed",
] as const;
export type PublicReasonCode = (typeof PUBLIC_REASON_CODES)[number];

export interface PublicDependency {
  name: string;
  status: DependencyStatus;
  critical: boolean;
  latencyMs: number;
  reason?: PublicReasonCode;
}

export interface DependencyHealthView {
  status: OverallHealth;
  checkedAt: string | null;
  cached: boolean;
  dependencies: PublicDependency[];
  /**
   * False when the endpoint answered with a payload that does not describe
   * individual dependencies (legacy deployment). Callers should not claim a
   * dependency is healthy or broken in that case.
   */
  reported: boolean;
}

const DEPENDENCY_STATUS_SET = new Set<string>(DEPENDENCY_STATUSES);
const OVERALL_HEALTH_SET = new Set<string>(OVERALL_HEALTH_STATES);
const REASON_CODE_SET = new Set<string>(PUBLIC_REASON_CODES);

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeOverallStatus(value: unknown, httpStatus: number): OverallHealth {
  if (typeof value === "string" && OVERALL_HEALTH_SET.has(value)) {
    return value as OverallHealth;
  }
  // A 5xx without a parsable body is an outage; any other unrecognised answer
  // is treated as degraded rather than silently "ok".
  return httpStatus >= 500 ? "down" : "degraded";
}

function normalizeDependency(value: unknown): PublicDependency | null {
  const record = asRecord(value);
  if (!record || typeof record.name !== "string" || record.name.length === 0) {
    return null;
  }
  if (typeof record.status !== "string" || !DEPENDENCY_STATUS_SET.has(record.status)) {
    return null;
  }

  const latencyMs =
    typeof record.latencyMs === "number" && Number.isFinite(record.latencyMs) && record.latencyMs >= 0
      ? Math.round(record.latencyMs)
      : 0;

  const dependency: PublicDependency = {
    name: record.name,
    status: record.status as DependencyStatus,
    critical: record.critical === true,
    latencyMs,
  };

  // Only a documented reason code survives; anything else (including raw
  // error text accidentally placed in `reason`) is discarded.
  if (typeof record.reason === "string" && REASON_CODE_SET.has(record.reason)) {
    dependency.reason = record.reason as PublicReasonCode;
  }

  return dependency;
}

/**
 * Normalise `GET /api/health` into a rendering-safe view.
 *
 * `payload` may come from an untrusted or newer server: every field is
 * re-derived instead of copied.
 */
export function normalizeDependencyHealth(
  payload: unknown,
  httpStatus = 200,
): DependencyHealthView {
  const record = asRecord(payload);
  if (!record) {
    return {
      status: normalizeOverallStatus(undefined, httpStatus),
      checkedAt: null,
      cached: false,
      dependencies: [],
      reported: false,
    };
  }

  const rawDependencies = Array.isArray(record.dependencies) ? record.dependencies : null;
  const dependencies = (rawDependencies ?? [])
    .map(normalizeDependency)
    .filter((dependency): dependency is PublicDependency => dependency !== null);

  return {
    status: normalizeOverallStatus(record.status, httpStatus),
    checkedAt: typeof record.checkedAt === "string" ? record.checkedAt : null,
    cached: record.cached === true,
    dependencies,
    reported: rawDependencies !== null,
  };
}

/** True when a critical dependency is down, which the API reports as 503. */
export function hasCriticalOutage(view: DependencyHealthView): boolean {
  return view.dependencies.some((dependency) => dependency.critical && dependency.status === "down");
}

export const OVERALL_HEALTH_COPY: Record<OverallHealth, string> = {
  ok: "All dependencies operational",
  degraded: "Some dependencies are degraded",
  down: "A critical dependency is unavailable",
};

export const DEPENDENCY_STATUS_COPY: Record<DependencyStatus, string> = {
  up: "Operational",
  degraded: "Degraded",
  down: "Unavailable",
};

export const DEFAULT_RETRY_AFTER_MS = 30_000;
export const MIN_RETRY_AFTER_MS = 0;
export const MAX_RETRY_AFTER_MS = 60_000;

/**
 * Convert a `Retry-After` header (delta-seconds or an HTTP date) into a bounded
 * delay in milliseconds. Missing or unparsable values fall back to 30 s so a
 * retry loop can never spin.
 */
export function retryAfterDelayMs(
  headerValue: string | null | undefined,
  nowMs: number = Date.now(),
): number {
  if (headerValue == null || headerValue.trim() === "") {
    return DEFAULT_RETRY_AFTER_MS;
  }

  const trimmed = headerValue.trim();
  let delay: number;

  if (/^\d+$/.test(trimmed)) {
    delay = Number(trimmed) * 1000;
  } else {
    const at = Date.parse(trimmed);
    delay = Number.isNaN(at) ? DEFAULT_RETRY_AFTER_MS : at - nowMs;
  }

  if (!Number.isFinite(delay)) return DEFAULT_RETRY_AFTER_MS;
  return Math.min(MAX_RETRY_AFTER_MS, Math.max(MIN_RETRY_AFTER_MS, delay));
}

/** Short, user-facing description of a retry delay ("5s", "1m 30s"). */
export function formatRetryDelay(ms: number): string {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}
