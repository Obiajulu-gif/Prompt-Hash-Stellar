/**
 * Browser-side lifecycle event capture.
 *
 * Best-effort and privacy-preserving by construction:
 *  - the subject is a random per-tab-session id (sessionStorage), never a
 *    wallet address, and it is HMAC-hashed again on the server;
 *  - only allow-listed workflow/stage ids and failure reasons are sent;
 *  - it never throws, never blocks the UI, and is a no-op in tests, when the
 *    browser sends Do Not Track, or when VITE_LIFECYCLE_ANALYTICS=off.
 *
 * Stage ids and capture points: src/lib/analytics/lifecycleStages.ts
 */

import {
  sanitizeFailureReason,
  stageIndex,
  type LifecycleKind,
  type LifecycleWorkflow,
} from "./lifecycleStages";

const SESSION_KEY = "ph_lifecycle_sid";
const ENDPOINT = "/api/analytics/lifecycle";

function isDisabled(): boolean {
  try {
    const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};
    if (env.MODE === "test" || env.VITE_LIFECYCLE_ANALYTICS === "off") return true;
    if (typeof navigator !== "undefined" && (navigator.doNotTrack === "1" || (window as any).doNotTrack === "1")) {
      return true;
    }
    return typeof window === "undefined" || typeof fetch !== "function";
  } catch {
    return true;
  }
}

function sessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const id =
      typeof crypto !== "undefined" && "randomUUID" in crypto
        ? crypto.randomUUID()
        : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
    sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    // Storage blocked: fall back to a per-page-load id (journeys still group
    // within the page, they just cannot span reloads).
    return (globalThis as any).__phLifecycleFallbackSid ??= Math.random().toString(36).slice(2);
  }
}

/** Fire-and-forget. Safe to call anywhere, including render-adjacent effects. */
export function trackLifecycle(
  workflow: LifecycleWorkflow,
  stage: string,
  kind: LifecycleKind = "reached",
  reason?: string,
): void {
  try {
    if (isDisabled() || stageIndex(workflow, stage) < 0) return;
    const body = JSON.stringify({
      sessionId: sessionId(),
      workflow,
      stage,
      kind,
      ...(kind === "failed" ? { reason: sanitizeFailureReason(reason) } : {}),
    });
    const apiBase =
      window.location.origin.includes("localhost") ? "http://localhost:5000" : "";
    void fetch(`${apiBase}${ENDPOINT}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  } catch {
    // Analytics must never affect the product flow.
  }
}

/** Map an arbitrary thrown error to an allow-listed failure reason. */
export function reasonFromError(error: unknown): string {
  const message = (error instanceof Error ? error.message : String(error ?? "")).toLowerCase();
  if (/reject|denied|declin|cancel/.test(message)) return "user_rejected";
  if (/wrong network|network mismatch/.test(message)) return "wallet_wrong_network";
  if (/wallet.*(connect|required)|connect.*wallet/.test(message)) return "wallet_not_connected";
  if (/insufficient/.test(message)) return "tx_insufficient_balance";
  if (/timeout|timed out/.test(message)) return "tx_confirmation_timeout";
  if (/network|fetch|offline/.test(message)) return "tx_network_error";
  if (/rate.?limit|too many/.test(message)) return "unlock_rate_limited";
  if (/integrity/.test(message)) return "unlock_integrity_failed";
  if (/access|not purchased/.test(message)) return "unlock_no_access";
  return "unknown_error";
}
