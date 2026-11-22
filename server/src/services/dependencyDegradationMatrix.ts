/**
 * External Dependency Degradation Matrix (Issue #980)
 *
 * Documents each critical third-party dependency's failure modes, fallback
 * UX/API behavior, and provides automated health-check probes that are safe
 * to run in production (read-only, non-mutating).
 *
 * Design goals:
 *  - Every dependency has an entry with documented failure modes.
 *  - Each entry maps a failure mode to a concrete user-safe API/UX response.
 *  - Automated probes return structured results that can be consumed by
 *    health dashboards, alerting pipelines, or CI smoke tests.
 *  - No probe mutates data; all are read-only / connectivity checks.
 */

import { logger } from "./structuredLogger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DependencyName =
  | "stellar_rpc"
  | "stellar_horizon"
  | "mongodb"
  | "redis"
  | "ipfs_pinata"
  | "safety_scanner";

export type FailureMode =
  | "timeout"
  | "connection_refused"
  | "rate_limited"
  | "auth_failure"
  | "partial_data"
  | "stale_data"
  | "unavailable";

export type ImpactSeverity = "critical" | "high" | "medium" | "low";

export interface FailureModeEntry {
  /** Machine-readable label for the failure mode. */
  mode: FailureMode;
  /** Human-readable description of this failure mode. */
  description: string;
  /** Severity classification that determines circuit-breaker aggressiveness. */
  severity: ImpactSeverity;
  /** What the API/UI does when this failure mode is active (user-safe behavior). */
  fallbackBehavior: string;
  /** User-facing message safe to surface in HTTP responses or toasts. */
  userMessage: string;
  /** Operational steps to recover from this mode. */
  recoverySteps: string[];
}

export interface DependencyEntry {
  name: DependencyName;
  /** Brief description of what this dependency provides. */
  purpose: string;
  /** All documented failure modes with fallback policies. */
  failureModes: FailureModeEntry[];
  /**
   * Automated connectivity probe.  Returns true when the dependency responds
   * within its expected SLA; false otherwise.  Must never mutate state.
   */
  probe: () => Promise<ProbeResult>;
}

export interface ProbeResult {
  dependency: DependencyName;
  healthy: boolean;
  latencyMs: number;
  /** Detected failure mode (if any). */
  failureMode?: FailureMode;
  detail?: string;
  checkedAt: string;
}

export interface DegradationMatrixReport {
  checkedAt: string;
  overallHealthy: boolean;
  results: ProbeResult[];
  /** Dependencies whose probe failed — caller should activate fallbacks. */
  degradedDependencies: DependencyName[];
}

// ---------------------------------------------------------------------------
// Probe helpers — injectable so tests can override fetch/socket behaviour
// ---------------------------------------------------------------------------

/** Injected dependencies for testability. */
export interface ProbeEnv {
  stellarRpcUrl: string;
  stellarHorizonUrl: string;
  mongodbUri: string;
  redisHost: string;
  redisPort: number;
  ipfsGatewayUrl: string;
  safetyScannerHealthUrl: string;
  timeoutMs: number;
}

function defaultProbeEnv(): ProbeEnv {
  return {
    stellarRpcUrl: process.env.STELLAR_RPC_URL ?? "https://soroban-testnet.stellar.org",
    stellarHorizonUrl: process.env.STELLAR_HORIZON_URL ?? "https://horizon-testnet.stellar.org",
    mongodbUri: process.env.MONGODB_URI ?? "mongodb://localhost:27017",
    redisHost: process.env.REDIS_HOST ?? "localhost",
    redisPort: Number(process.env.REDIS_PORT ?? 6379),
    ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL ?? "https://gateway.pinata.cloud",
    safetyScannerHealthUrl: process.env.SAFETY_SCANNER_HEALTH_URL ?? "http://localhost:9001/health",
    timeoutMs: 5_000,
  };
}

/**
 * Lightweight HTTP GET with a timeout.  Returns { ok, latencyMs, status }.
 * Never throws — converts errors into { ok: false }.
 */
async function httpGet(
  url: string,
  timeoutMs: number
): Promise<{ ok: boolean; latencyMs: number; status?: number; body?: string }> {
  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    const resp = await fetch(url, { signal: controller.signal });
    clearTimeout(timer);
    const body = await resp.text().catch(() => "");
    return { ok: resp.ok, latencyMs: Date.now() - start, status: resp.status, body };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, latencyMs: Date.now() - start, body: msg };
  }
}

/**
 * Maps a failed HTTP probe to a failure mode. 401/403 means our credentials
 * were rejected — retrying cannot help, so it is reported as auth_failure
 * rather than folded into "unavailable" (#1126).
 */
export function classifyHttpFailure(
  status: number | undefined,
  latencyMs: number,
  timeoutMs: number,
): FailureMode {
  if (status === 401 || status === 403) return "auth_failure";
  if (status === 429) return "rate_limited";
  if (latencyMs >= timeoutMs) return "timeout";
  return "unavailable";
}

// ---------------------------------------------------------------------------
// Degradation matrix definition
// ---------------------------------------------------------------------------

export function buildDegradationMatrix(env: ProbeEnv): DependencyEntry[] {
  return [
    // ------------------------------------------------------------------
    // 1. Stellar RPC (Soroban) — on-chain read/write
    // ------------------------------------------------------------------
    {
      name: "stellar_rpc",
      purpose:
        "Soroban RPC node used to simulate transactions, query on-chain state (has_access, prompt data), and submit buy_prompt calls.",
      failureModes: [
        {
          mode: "timeout",
          severity: "high",
          description: "RPC node does not respond within SLA.",
          fallbackBehavior:
            "Unlock and purchase endpoints return HTTP 503 with Retry-After header.  No funds are moved.  User sees a non-blocking retry banner.",
          userMessage:
            "The Stellar network is taking longer than expected. Your funds are safe — please try again in a moment.",
          recoverySteps: [
            "Check Stellar network status at https://status.stellar.org.",
            "Switch STELLAR_RPC_URL to a secondary node if available.",
            "Increase RPC_TIMEOUT_MS temporarily; revert after recovery.",
          ],
        },
        {
          mode: "connection_refused",
          severity: "critical",
          description: "RPC node is unreachable (network partition or node restart).",
          fallbackBehavior:
            "All on-chain operations (buy_prompt, has_access) are blocked with a user-safe error. Read-only marketplace browsing remains available.",
          userMessage:
            "Prompt purchases are temporarily unavailable while we reconnect to the Stellar network. You can still browse the marketplace.",
          recoverySteps: [
            "Verify STELLAR_RPC_URL is reachable from the server environment.",
            "Check cloud VPC/firewall rules for outbound RPC traffic.",
            "Rotate to backup RPC node; update STELLAR_RPC_URL env var.",
            "Re-run: yarn diagnose stellar-rpc after fix.",
          ],
        },
        {
          mode: "stale_data",
          severity: "high",
          description:
            "RPC reports a ledger sequence far behind the network tip (indexer lag).",
          fallbackBehavior:
            "has_access calls use a stale-ledger warning overlay; unlock is deferred until the ledger catches up or a secondary node confirms access.",
          userMessage:
            "Your access is being verified against a slightly delayed ledger. This is temporary and will resolve automatically.",
          recoverySteps: [
            "Compare getRPC ledger to public Horizon ledger tip.",
            "Restart the indexer if ledger lag exceeds 200 sequences.",
            "Alert on-call if lag exceeds 500 sequences.",
          ],
        },
        {
          mode: "auth_failure",
          severity: "critical",
          description: "RPC provider rejects our API key or allow-listed origin (HTTP 401/403).",
          fallbackBehavior:
            "On-chain operations are blocked and never retried automatically — retrying with rejected credentials cannot succeed. Access checks fail closed. Read-only browsing remains available.",
          userMessage:
            "Prompt purchases are temporarily unavailable. You can still browse the marketplace.",
          recoverySteps: [
            "Verify the RPC provider API key and origin allow-list.",
            "Rotate the credential (see docs/secret-rotation.md) and redeploy.",
            "Re-run the degradation probes to confirm stellar_rpc is healthy.",
          ],
        },
      ],
      probe: async (): Promise<ProbeResult> => {
        const start = Date.now();
        // POST a minimal JSON-RPC getHealth call — read-only and cheap
        const checkedAt = new Date().toISOString();
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), env.timeoutMs);
          const resp = await fetch(env.stellarRpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
            signal: controller.signal,
          });
          clearTimeout(timer);
          const latencyMs = Date.now() - start;
          if (!resp.ok) {
            return { dependency: "stellar_rpc", healthy: false, latencyMs, failureMode: classifyHttpFailure(resp.status, latencyMs, env.timeoutMs), detail: `HTTP ${resp.status}`, checkedAt };
          }
          const data = (await resp.json()) as { result?: { status?: string } };
          const healthy = data?.result?.status === "healthy";
          return {
            dependency: "stellar_rpc",
            healthy,
            latencyMs,
            failureMode: healthy ? undefined : "stale_data",
            checkedAt,
          };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          const isTimeout = msg.includes("abort") || msg.includes("timeout");
          return {
            dependency: "stellar_rpc",
            healthy: false,
            latencyMs: Date.now() - start,
            failureMode: isTimeout ? "timeout" : "connection_refused",
            detail: msg,
            checkedAt,
          };
        }
      },
    },

    // ------------------------------------------------------------------
    // 2. Stellar Horizon — REST API for account balances
    // ------------------------------------------------------------------
    {
      name: "stellar_horizon",
      purpose:
        "Horizon REST API used to look up XLM account balances before purchase and to poll transaction status.",
      failureModes: [
        {
          mode: "timeout",
          severity: "medium",
          description: "Horizon endpoint does not respond within SLA.",
          fallbackBehavior:
            "Balance pre-check is skipped with a UI warning; transaction submission proceeds but the user is warned of possible insufficient-funds rejection.",
          userMessage:
            "Balance verification is temporarily unavailable. Your transaction may be rejected if your balance is insufficient.",
          recoverySteps: [
            "Check https://status.stellar.org for Horizon outages.",
            "Switch STELLAR_HORIZON_URL to Stellar Foundation fallback.",
          ],
        },
        {
          mode: "rate_limited",
          severity: "medium",
          description: "Horizon returns HTTP 429 (Too Many Requests).",
          fallbackBehavior:
            "Client-side exponential back-off with jitter; balance lookups queued for retry rather than discarded.",
          userMessage:
            "We're experiencing high traffic. Please wait a moment before trying again.",
          recoverySteps: [
            "Increase request retry back-off intervals.",
            "Consider running a self-hosted Horizon instance for production traffic.",
          ],
        },
      ],
      probe: async (): Promise<ProbeResult> => {
        const checkedAt = new Date().toISOString();
        const { ok, latencyMs, status, body } = await httpGet(
          `${env.stellarHorizonUrl}/`,
          env.timeoutMs
        );
        let failureMode: FailureMode | undefined;
        if (!ok) {
          failureMode = status === 429 ? "rate_limited" : latencyMs >= env.timeoutMs ? "timeout" : "unavailable";
        }
        return { dependency: "stellar_horizon", healthy: ok, latencyMs, failureMode, detail: ok ? undefined : body, checkedAt };
      },
    },

    // ------------------------------------------------------------------
    // 3. MongoDB — primary data store
    // ------------------------------------------------------------------
    {
      name: "mongodb",
      purpose:
        "Primary database storing prompt metadata, purchases, entitlements, audit logs, and support cases.",
      failureModes: [
        {
          mode: "connection_refused",
          severity: "critical",
          description: "Application cannot open a connection to MongoDB.",
          fallbackBehavior:
            "All API endpoints that require database reads/writes return HTTP 503. Static marketplace preview (cached CDN content) remains available.",
          userMessage:
            "The marketplace is temporarily unavailable for new transactions. Read-only browsing may still work.",
          recoverySteps: [
            "Verify MONGODB_URI and network connectivity from the server.",
            "Check MongoDB Atlas / replica-set primary status.",
            "Restore from latest backup if corruption is suspected: yarn db:restore.",
            "After connection is restored, run: yarn data:integrity:monitor to validate state.",
          ],
        },
        {
          mode: "partial_data",
          severity: "high",
          description: "Secondary replica is serving stale reads during failover.",
          fallbackBehavior:
            "Read operations are retried against the primary. Writes are queued with idempotency keys to prevent double-execution on recovery.",
          userMessage:
            "Some data may appear outdated while our database synchronises. Actions you've taken are safe and will be reflected shortly.",
          recoverySteps: [
            "Confirm replica-set primary election is complete.",
            "Run: yarn data:integrity:monitor to check for drift.",
            "Replay idempotency-keyed write queue: yarn jobs:run idempotency-replay.",
          ],
        },
        {
          mode: "auth_failure",
          severity: "critical",
          description: "MongoDB rejects the configured credentials (rotated or revoked user).",
          fallbackBehavior:
            "Treated like connection_refused: database-backed endpoints return HTTP 503 and are not retried automatically.",
          userMessage:
            "The marketplace is temporarily unavailable for new transactions. Read-only browsing may still work.",
          recoverySteps: [
            "Confirm the database user in MONGODB_URI still exists and has the expected roles.",
            "Rotate the credential and restart the API.",
          ],
        },
      ],
      probe: async (): Promise<ProbeResult> => {
        const checkedAt = new Date().toISOString();
        const start = Date.now();
        // Dynamically import mongoose to avoid circular deps in test environments.
        try {
          const mongoose = await import("mongoose");
          const state = mongoose.default.connection.readyState;
          // 1 = connected, 2 = connecting
          const healthy = state === 1;
          return {
            dependency: "mongodb",
            healthy,
            latencyMs: Date.now() - start,
            failureMode: healthy ? undefined : "connection_refused",
            detail: healthy ? undefined : `readyState=${state}`,
            checkedAt,
          };
        } catch (err: unknown) {
          return {
            dependency: "mongodb",
            healthy: false,
            latencyMs: Date.now() - start,
            failureMode: "connection_refused",
            detail: String(err),
            checkedAt,
          };
        }
      },
    },

    // ------------------------------------------------------------------
    // 4. Redis — distributed rate-limiting and caching
    // ------------------------------------------------------------------
    {
      name: "redis",
      purpose:
        "Stores distributed rate-limit counters, idempotency keys, challenge nonces, and short-lived session caches.",
      failureModes: [
        {
          mode: "connection_refused",
          severity: "high",
          description: "Redis is unreachable; rate limiting falls back to in-process counters.",
          fallbackBehavior:
            "In-process rate limiter activates with conservative (tighter) limits. Challenge nonces stored in-process with shorter TTL. Distributed cache miss means slight increase in DB load.",
          userMessage:
            "Some actions may be temporarily limited while we restore our caching service.",
          recoverySteps: [
            "Check REDIS_HOST / REDIS_PORT environment variables.",
            "Verify Redis container / cluster health.",
            "In-process fallback is automatic; no manual intervention needed for short outages.",
          ],
        },
        {
          mode: "stale_data",
          severity: "low",
          description: "Redis returns expired or inconsistent data after a flush or restart.",
          fallbackBehavior:
            "Cache-miss path fetches authoritative data from MongoDB. Stale nonces are rejected at signature verification; users must re-request a fresh challenge.",
          userMessage:
            "Please re-initiate the signing process to get a fresh verification token.",
          recoverySteps: [
            "Flush affected Redis keys: redis-cli FLUSHDB (non-production) or targeted key deletion.",
            "Monitor cache hit-rate metrics for recovery.",
          ],
        },
      ],
      probe: async (): Promise<ProbeResult> => {
        const checkedAt = new Date().toISOString();
        const start = Date.now();
        try {
          // Use Net to TCP-ping Redis without importing the redis client.
          const { createConnection } = await import("net");
          await new Promise<void>((resolve, reject) => {
            const socket = createConnection({ host: env.redisHost, port: env.redisPort });
            const timer = setTimeout(() => {
              socket.destroy();
              reject(new Error("timeout"));
            }, env.timeoutMs);
            socket.once("connect", () => {
              clearTimeout(timer);
              socket.destroy();
              resolve();
            });
            socket.once("error", (e) => {
              clearTimeout(timer);
              reject(e);
            });
          });
          return { dependency: "redis", healthy: true, latencyMs: Date.now() - start, checkedAt };
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          return {
            dependency: "redis",
            healthy: false,
            latencyMs: Date.now() - start,
            failureMode: msg === "timeout" ? "timeout" : "connection_refused",
            detail: msg,
            checkedAt,
          };
        }
      },
    },

    // ------------------------------------------------------------------
    // 5. IPFS / Pinata — encrypted prompt payload storage
    // ------------------------------------------------------------------
    {
      name: "ipfs_pinata",
      purpose:
        "Off-chain storage for large encrypted prompt payloads pinned via Pinata. Prompt metadata CID stored on-chain.",
      failureModes: [
        {
          mode: "unavailable",
          severity: "high",
          description: "Pinata gateway is unreachable; CID resolution fails.",
          fallbackBehavior:
            "Prompt publication (upload_content) is blocked with a clear error. Existing purchased prompts that have already been decrypted are unaffected. Re-upload is offered once the service recovers.",
          userMessage:
            "Prompt storage is temporarily unavailable. Your existing purchases are unaffected — only new publications are paused.",
          recoverySteps: [
            "Check https://status.pinata.cloud for outage reports.",
            "Switch IPFS_GATEWAY_URL to an alternative public gateway (e.g., cloudflare-ipfs.com).",
            "Re-queue failed upload jobs: yarn jobs:run ipfs-upload-retry.",
          ],
        },
        {
          mode: "timeout",
          severity: "medium",
          description: "Gateway responds slowly; CID fetch exceeds acceptable latency.",
          fallbackBehavior:
            "Unlock service retries up to 3 times with exponential back-off before returning HTTP 503. Preview content (stored in MongoDB) is served in place of full payload.",
          userMessage:
            "Loading your prompt content is taking longer than usual. We're retrying automatically.",
          recoverySteps: [
            "Check Pinata gateway latency metrics.",
            "Enable Pinata dedicated gateway if on paid plan.",
          ],
        },
        {
          mode: "auth_failure",
          severity: "high",
          description: "Pinata rejects the configured JWT (HTTP 401/403).",
          fallbackBehavior:
            "Publication is blocked and not retried automatically. Existing purchases are unaffected; previews are served from MongoDB.",
          userMessage:
            "Prompt storage is temporarily unavailable. Your existing purchases are unaffected — only new publications are paused.",
          recoverySteps: [
            "Verify PINATA_JWT is present and not revoked.",
            "Rotate the key and re-queue failed uploads: yarn jobs:run ipfs-upload-retry.",
          ],
        },
      ],
      probe: async (): Promise<ProbeResult> => {
        const checkedAt = new Date().toISOString();
        const { ok, latencyMs, status } = await httpGet(env.ipfsGatewayUrl, env.timeoutMs);
        return {
          dependency: "ipfs_pinata",
          healthy: ok,
          latencyMs,
          failureMode: ok ? undefined : classifyHttpFailure(status, latencyMs, env.timeoutMs),
          detail: ok ? undefined : `HTTP ${status}`,
          checkedAt,
        };
      },
    },

    // ------------------------------------------------------------------
    // 6. Content Safety Scanner
    // ------------------------------------------------------------------
    {
      name: "safety_scanner",
      purpose:
        "Automated content-safety pipeline that scans new prompt submissions for policy violations before publication.",
      failureModes: [
        {
          mode: "unavailable",
          severity: "high",
          description: "Safety scanner service is offline.",
          fallbackBehavior:
            "Instant auto-publication is blocked. All new submissions enter a manual-review queue visible to maintainers. The creator is shown an estimated review time.",
          userMessage:
            "Automated content review is temporarily offline. Your submission has been queued for manual review — typically within 24 hours.",
          recoverySteps: [
            "Check SAFETY_SCANNER_HEALTH_URL for service health.",
            "Drain the manual review queue: yarn jobs:run manual-review-drain.",
            "Once scanner recovers, re-run queued items: yarn jobs:run safety-rescan.",
          ],
        },
        {
          mode: "timeout",
          severity: "medium",
          description: "Scanner takes longer than SLA to return a decision.",
          fallbackBehavior:
            "Submission placed in async analysis queue; creator notified via email/toast when decision is ready rather than blocking the submission flow.",
          userMessage:
            "Content review is taking a little longer than usual. We'll notify you when it's complete.",
          recoverySteps: [
            "Check scanner queue depth and worker concurrency.",
            "Scale scanner workers horizontally if queue depth exceeds 200.",
          ],
        },
      ],
      probe: async (): Promise<ProbeResult> => {
        const checkedAt = new Date().toISOString();
        const { ok, latencyMs, status } = await httpGet(env.safetyScannerHealthUrl, env.timeoutMs);
        return {
          dependency: "safety_scanner",
          healthy: ok,
          latencyMs,
          failureMode: ok ? undefined : (latencyMs >= env.timeoutMs ? "timeout" : "unavailable"),
          detail: ok ? undefined : `HTTP ${status}`,
          checkedAt,
        };
      },
    },
  ];
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

/**
 * Runs all dependency probes concurrently and returns a structured report.
 * Safe to call from health endpoints or scheduled smoke tests.
 */
export async function runDegradationMatrixProbes(
  envOverride?: Partial<ProbeEnv>,
  matrixOverride?: DependencyEntry[],
): Promise<DegradationMatrixReport> {
  const env: ProbeEnv = { ...defaultProbeEnv(), ...envOverride };
  const matrix = matrixOverride ?? buildDegradationMatrix(env);

  // A probe that throws must not take the whole report down with it; it is
  // reported as unavailable so the other dependencies are still classified.
  const results = await Promise.all(matrix.map((entry) => runProbeSafely(entry)));

  const degraded: DependencyName[] = results
    .filter((r) => !r.healthy)
    .map((r) => r.dependency);

  const overallHealthy = degraded.length === 0;

  if (!overallHealthy) {
    logger.warn("Dependency degradation matrix: unhealthy dependencies detected", {
      action: "dependency_probe",
      degradedDependencies: degraded,
    });
  }

  return {
    checkedAt: new Date().toISOString(),
    overallHealthy,
    results,
    degradedDependencies: degraded,
  };
}

async function runProbeSafely(entry: DependencyEntry): Promise<ProbeResult> {
  const start = Date.now();
  try {
    return await entry.probe();
  } catch (err: unknown) {
    return {
      dependency: entry.name,
      healthy: false,
      latencyMs: Date.now() - start,
      failureMode: "unavailable",
      detail: err instanceof Error ? err.message : String(err),
      checkedAt: new Date().toISOString(),
    };
  }
}

/**
 * Returns the degradation matrix definition without running probes.
 * Useful for generating documentation or surfacing failure-mode data via API.
 */
export function getDegradationMatrixDefinition(
  envOverride?: Partial<ProbeEnv>
): DependencyEntry[] {
  const env: ProbeEnv = { ...defaultProbeEnv(), ...envOverride };
  return buildDegradationMatrix(env);
}

// ---------------------------------------------------------------------------
// User-safe degraded mode helpers (#1013)
// ---------------------------------------------------------------------------

/**
 * Looks up the user-safe message for a dependency failure mode (#1013).
 * Returns a generic fallback if the dependency or mode is not in the matrix.
 */
export function getUserSafeMessage(
  dependency: DependencyName,
  failureMode: FailureMode,
): string {
  const env: ProbeEnv = { ...defaultProbeEnv() };
  const matrix = buildDegradationMatrix(env);
  const entry = matrix.find((e) => e.name === dependency);
  if (!entry) return "A service is temporarily unavailable. Please try again shortly.";
  const mode = entry.failureModes.find((m) => m.mode === failureMode);
  return mode?.userMessage ?? "A service is temporarily unavailable. Please try again shortly.";
}

/**
 * Returns the fallback behavior description for a dependency failure (#1013).
 * Used by the API layer to decide how to degrade gracefully.
 */
export function getFallbackBehavior(
  dependency: DependencyName,
  failureMode: FailureMode,
): string {
  const env: ProbeEnv = { ...defaultProbeEnv() };
  const matrix = buildDegradationMatrix(env);
  const entry = matrix.find((e) => e.name === dependency);
  if (!entry) return "Return a 503 with a generic retry message.";
  const mode = entry.failureModes.find((m) => m.mode === failureMode);
  return mode?.fallbackBehavior ?? "Return a 503 with a generic retry message.";
}

/**
 * Returns the severity of a dependency failure (#1013).
 * Critical failures should trigger circuit-breaker open; low severity can
 * proceed with degraded UX.
 */
export function getFailureSeverity(
  dependency: DependencyName,
  failureMode: FailureMode,
): ImpactSeverity {
  const env: ProbeEnv = { ...defaultProbeEnv() };
  const matrix = buildDegradationMatrix(env);
  const entry = matrix.find((e) => e.name === dependency);
  if (!entry) return "medium";
  const mode = entry.failureModes.find((m) => m.mode === failureMode);
  return mode?.severity ?? "medium";
}

/**
 * Returns recovery steps for a dependency failure (#1013).
 * Used by operational runbooks and on-call dashboards.
 */
export function getRecoverySteps(
  dependency: DependencyName,
  failureMode: FailureMode,
): string[] {
  const env: ProbeEnv = { ...defaultProbeEnv() };
  const matrix = buildDegradationMatrix(env);
  const entry = matrix.find((e) => e.name === dependency);
  if (!entry) return ["Check service status pages.", "Retry after a short delay."];
  const mode = entry.failureModes.find((m) => m.mode === failureMode);
  return mode?.recoverySteps ?? ["Check service status pages.", "Retry after a short delay."];
}
