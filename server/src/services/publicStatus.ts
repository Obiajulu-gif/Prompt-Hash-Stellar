import type { MaintenanceBannerPublic } from "./maintenanceBannerService.js";
import type { ProbeResult } from "./healthProbes.js";
import {
  sortMaintenanceBannersDeterministically,
  sortStatusComponentsDeterministically,
} from "./deterministicSorting.js";

/**
 * Safe public-status model (#986).
 *
 * Turns raw dependency checks, active maintenance windows, and the on-chain
 * pause flag into the single status shown to users. Raw error text never
 * leaves this module: it can carry internal hostnames, IPs, RPC payloads, or
 * configuration hints, so it is reduced to a fixed public reason code.
 */

export type ComponentStatus = "up" | "degraded" | "down";

/** Ordered from most to least severe; see `derivePublicStatus`. */
export type PublicStatusState = "outage" | "paused" | "maintenance" | "degraded" | "operational";

export type PublicReasonCode = "timeout" | "unreachable" | "http_error" | "unhealthy" | "check_failed";

/** A dependency check as produced internally (may carry raw error text). */
export interface ComponentCheck {
  name: string;
  status: ComponentStatus;
  latencyMs: number | null;
  error?: string;
}

/** A dependency check safe to publish. `error` holds a reason code only. */
export interface PublicComponent {
  name: string;
  status: ComponentStatus;
  latencyMs: number | null;
  error?: PublicReasonCode;
}

export type PublicProbe = Pick<ProbeResult, "name" | "status" | "latencyMs" | "timestamp">;

export interface PublicStatusInput {
  components: ComponentCheck[];
  probes: ProbeResult[];
  /** Banners already filtered to the active window by the caller. */
  maintenance: MaintenanceBannerPublic[];
  /** On-chain `is_paused`; `null` when it could not be read. */
  contractPaused: boolean | null;
  /** When true, sorts services, probes, and maintenance windows by deterministic status/severity precedence (#1184). */
  deterministicOrder?: boolean;
}

export interface PublicStatus {
  state: PublicStatusState;
  /** Legacy three-value status kept for existing `/api/status` clients. */
  status: ComponentStatus;
  paused: boolean | null;
  services: PublicComponent[];
  probes: PublicProbe[];
  maintenance: MaintenanceBannerPublic[];
}

const REASON_PATTERNS: ReadonlyArray<[RegExp, PublicReasonCode]> = [
  [/timeout|timed out|aborted/i, "timeout"],
  [/^HTTP \d{3}$/, "http_error"],
  [/unhealthy/i, "unhealthy"],
  [/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|network/i, "unreachable"],
];

/** Map raw error text to a fixed public reason code. O(1): constant pattern list. */
export function toPublicReason(rawError: string): PublicReasonCode {
  for (const [pattern, code] of REASON_PATTERNS) {
    if (pattern.test(rawError)) return code;
  }
  return "check_failed";
}

function toPublicComponent(check: ComponentCheck): PublicComponent {
  const { name, status, latencyMs } = check;
  return check.error && status !== "up"
    ? { name, status, latencyMs, error: toPublicReason(check.error) }
    : { name, status, latencyMs };
}

function toLegacyStatus(state: PublicStatusState): ComponentStatus {
  if (state === "operational") return "up";
  if (state === "outage") return "down";
  return "degraded";
}

/**
 * Derive the public status. Precedence (first match wins):
 *   outage      — no component is up (same rule as the legacy "down")
 *   paused      — the contract is paused, so purchases, listings, and other
 *                 contract writes are rejected on-chain (`ContractIsPaused`)
 *   maintenance — an operator-declared maintenance window is active
 *   degraded    — at least one component is not fully up
 *   operational — everything is up
 * An unreadable pause flag (`null`) never claims `paused`; the contract-read
 * failure already surfaces through the component checks.
 *
 * Time O(c + p + m), space O(c + p + m) for c components, p probes, m banners.
 */
export function derivePublicStatus(input: PublicStatusInput): PublicStatus {
  const { components, probes, maintenance, contractPaused } = input;

  const upCount = components.filter((component) => component.status === "up").length;

  let state: PublicStatusState;
  if (components.length > 0 && upCount === 0) state = "outage";
  else if (contractPaused === true) state = "paused";
  else if (maintenance.length > 0) state = "maintenance";
  else if (upCount < components.length) state = "degraded";
  else state = "operational";

  const mappedServices = components.map(toPublicComponent);
  const mappedProbes = probes.map(({ name, status, latencyMs, timestamp }) => ({
    name,
    status,
    latencyMs,
    timestamp,
  }));

  return {
    state,
    status: toLegacyStatus(state),
    paused: contractPaused,
    services: input.deterministicOrder
      ? sortStatusComponentsDeterministically(mappedServices)
      : mappedServices,
    probes: input.deterministicOrder
      ? sortStatusComponentsDeterministically(mappedProbes)
      : mappedProbes,
    maintenance: input.deterministicOrder
      ? sortMaintenanceBannersDeterministically(maintenance)
      : maintenance,
  };
}
