/**
 * Non-mutating synthetic monitor for the critical browse -> challenge -> unlock
 * journey (#1039, #1154). The wallet/prompt pair must be a dedicated,
 * pre-entitled fixture; this monitor never submits a purchase or writes
 * marketplace data.
 */
export type SyntheticMode = "authorized" | "authorization-probe";

export interface SyntheticMonitorConfig {
  baseUrl: string;
  promptId: string;
  buyerAddress: string;
  mode: SyntheticMode;
  timeoutMs?: number;
  maxAttempts?: number;
  retryBaseMs?: number;
}

export interface SyntheticStep {
  name: "browse" | "challenge" | "unlock";
  success: boolean;
  latencyMs: number;
  attempts: number;
  status?: number;
  code?: string;
  error?: string;
}

export interface SyntheticJourneyResult {
  timestamp: string;
  success: boolean;
  mode: SyntheticMode;
  totalDurationMs: number;
  steps: SyntheticStep[];
  failedStep?: SyntheticStep["name"];
  /** Correlation ID for tracing this run across logs and alerting pipelines (#917). */
  correlationId: string;
}

export interface SyntheticMonitorDependencies {
  fetch: typeof fetch;
  /** Signs the exact challenge string. Required only in authorized mode. */
  signChallenge?: (challenge: string) => Promise<string> | string;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

/**
 * Structured alert emitted once a journey crosses the consecutive-failure
 * threshold, and again when it recovers. Contains only stable codes and
 * timings: never tokens, signatures, wallet secrets, or response bodies.
 */
export interface SyntheticAlertEvent {
  event: "synthetic_journey_alert" | "synthetic_journey_recovered";
  correlationId: string;
  consecutiveFailures: number;
  mode: SyntheticMode;
  failedStep?: SyntheticStep["name"];
  status?: number;
  code?: string;
  timestamp: string;
}

export interface JourneyHealthDecision {
  consecutiveFailures: number;
  alerting: boolean;
  /** Present exactly once per incident, when the failure threshold is crossed. */
  alert?: SyntheticAlertEvent;
  /** Present exactly once per incident, on the first success after alerting. */
  recovered?: SyntheticAlertEvent;
}

export interface JourneyHealthTracker {
  record(result: SyntheticJourneyResult): JourneyHealthDecision;
  snapshot(): { consecutiveFailures: number; alerting: boolean };
}

export interface SyntheticMonitorOptions {
  intervalMs?: number;
  /** Consecutive failed runs before an alert is emitted. Defaults to 2. */
  failureThreshold?: number;
  runImmediately?: boolean;
  /** Keep the event loop alive (set false for long-running watch mode). */
  unref?: boolean;
  /** Override structured logging (receives a single JSON line). */
  log?: (level: "info" | "error", line: string) => void;
  /** Override alert delivery, e.g. to forward to an alerting webhook. */
  onAlert?: (event: SyntheticAlertEvent) => void;
  onResult?: (result: SyntheticJourneyResult) => void;
}

export interface SyntheticMonitorHandle {
  timer: ReturnType<typeof setInterval>;
  /** Resolves to null when a run is already in flight (overlap is skipped). */
  runNow: () => Promise<SyntheticJourneyResult | null>;
  stop: () => void;
}

type JsonResponse = { status: number; ok: boolean; body: unknown };

class JourneyFailure extends Error {
  public readonly status?: number;
  public readonly code?: string;
  public readonly retryable: boolean;

  constructor(
    message: string,
    status?: number,
    code?: string,
    retryable = isRetryableStatus(status),
  ) {
    super(message);
    this.status = status;
    this.code = code;
    this.retryable = retryable;
  }
}

const defaultSleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function safeCode(body: unknown): string | undefined {
  if (!body || typeof body !== "object") return undefined;
  const value = (body as { code?: unknown }).code;
  return typeof value === "string" && /^[A-Z][A-Z0-9_]{1,63}$/.test(value)
    ? value
    : undefined;
}

function isRetryableStatus(status: number | undefined): boolean {
  return (
    status === undefined ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
  );
}

function failureFromError(error: unknown): JourneyFailure {
  if (error instanceof JourneyFailure) return error;
  return new JourneyFailure(
    error instanceof Error && error.name === "AbortError"
      ? "request_timeout"
      : "network_error",
  );
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<JsonResponse> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
    });
    // A non-JSON response (proxy error page, maintenance HTML) is treated as a
    // malformed body. The caller decides whether that is retryable.
    const body = await response.json().catch(() => null);
    return { status: response.status, ok: response.ok, body };
  } finally {
    clearTimeout(timer);
  }
}

async function runStep(
  name: SyntheticStep["name"],
  operation: () => Promise<{ status: number; code?: string }>,
  options: {
    maxAttempts: number;
    retryBaseMs: number;
    sleep: (ms: number) => Promise<void>;
    now: () => number;
  },
): Promise<SyntheticStep> {
  const startedAt = options.now();

  for (let attempt = 1; attempt <= options.maxAttempts; attempt++) {
    try {
      const result = await operation();
      return {
        name,
        success: true,
        latencyMs: options.now() - startedAt,
        attempts: attempt,
        status: result.status,
        ...(result.code ? { code: result.code } : {}),
      };
    } catch (error) {
      const failure = failureFromError(error);
      if (attempt === options.maxAttempts || !failure.retryable) {
        return {
          name,
          success: false,
          latencyMs: options.now() - startedAt,
          attempts: attempt,
          ...(failure.status ? { status: failure.status } : {}),
          ...(failure.code ? { code: failure.code } : {}),
          error: failure.message,
        };
      }
      await options.sleep(options.retryBaseMs * 2 ** (attempt - 1));
    }
  }
  throw new Error("unreachable");
}

function alertFromResult(
  event: SyntheticAlertEvent["event"],
  result: SyntheticJourneyResult,
  consecutiveFailures: number,
): SyntheticAlertEvent {
  const failed = result.steps.find((step) => !step.success);
  return {
    event,
    correlationId: result.correlationId,
    consecutiveFailures,
    mode: result.mode,
    timestamp: result.timestamp,
    ...(failed
      ? {
          failedStep: failed.name,
          ...(failed.status ? { status: failed.status } : {}),
          ...(failed.code ? { code: failed.code } : {}),
        }
      : {}),
  };
}

/**
 * Tracks consecutive failed runs so a single transient response does not page,
 * while a sustained outage alerts exactly once and recovery is announced.
 */
export function createJourneyHealthTracker(
  failureThreshold = 2,
): JourneyHealthTracker {
  const threshold = Math.max(1, Math.floor(failureThreshold));
  let consecutiveFailures = 0;
  let alerting = false;

  return {
    record(result) {
      const decision: JourneyHealthDecision = {
        consecutiveFailures,
        alerting,
      };

      if (result.success) {
        if (alerting) {
          decision.recovered = alertFromResult(
            "synthetic_journey_recovered",
            result,
            consecutiveFailures,
          );
        }
        consecutiveFailures = 0;
        alerting = false;
      } else {
        consecutiveFailures += 1;
        if (!alerting && consecutiveFailures >= threshold) {
          alerting = true;
          decision.alert = alertFromResult(
            "synthetic_journey_alert",
            result,
            consecutiveFailures,
          );
        }
      }

      decision.consecutiveFailures = consecutiveFailures;
      decision.alerting = alerting;
      return decision;
    },
    snapshot() {
      return { consecutiveFailures, alerting };
    },
  };
}

/** Run one journey. Stops after the first failed step to avoid misleading cascades. */
export async function runSyntheticJourney(
  config: SyntheticMonitorConfig,
  dependencies: SyntheticMonitorDependencies = { fetch: globalThis.fetch },
): Promise<SyntheticJourneyResult> {
  const now = dependencies.now ?? Date.now;
  const sleep = dependencies.sleep ?? defaultSleep;
  const timeoutMs = Math.max(1, config.timeoutMs ?? 8_000);
  const maxAttempts = Math.max(1, Math.min(5, config.maxAttempts ?? 3));
  const retryBaseMs = Math.max(0, config.retryBaseMs ?? 250);
  const baseUrl = config.baseUrl.replace(/\/$/, "");
  const startedAt = now();
  const correlationId = `synth_${startedAt}_${Math.random().toString(36).slice(2, 10)}`;
  const idempotencyKey = `synthetic:${config.promptId}:${config.mode}:${correlationId}`;
  const steps: SyntheticStep[] = [];
  let challengeBody: { token: string; challenge: string } | undefined;
  const stepOptions = { maxAttempts, retryBaseMs, sleep, now };

  const browse = await runStep(
    "browse",
    async () => {
      const response = await requestJson(
        dependencies.fetch,
        `${baseUrl}/api/prompts/index?onChainId=${encodeURIComponent(config.promptId)}`,
        { method: "GET", headers: { Accept: "application/json" } },
        timeoutMs,
      );
      const found = Array.isArray(response.body) && response.body.length === 1;
      if (!response.ok || !found) {
        throw new JourneyFailure(
          found ? "browse_failed" : "synthetic_prompt_missing",
          response.status,
          safeCode(response.body),
        );
      }
      return { status: response.status };
    },
    stepOptions,
  );
  steps.push(browse);

  if (browse.success) {
    const challenge = await runStep(
      "challenge",
      async () => {
        const response = await requestJson(
          dependencies.fetch,
          `${baseUrl}/api/auth/challenge`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              address: config.buyerAddress,
              promptId: config.promptId,
              action: "unlock",
            }),
          },
          timeoutMs,
        );
        const body = response.body as {
          token?: unknown;
          challenge?: unknown;
        } | null;
        if (
          !response.ok ||
          typeof body?.token !== "string" ||
          typeof body.challenge !== "string"
        ) {
          throw new JourneyFailure(
            "challenge_failed",
            response.status,
            safeCode(response.body),
          );
        }
        challengeBody = { token: body.token, challenge: body.challenge };
        return { status: response.status };
      },
      stepOptions,
    );
    steps.push(challenge);
  }

  if (steps.every((step) => step.success) && challengeBody) {
    const unlock = await runStep(
      "unlock",
      async () => {
        if (config.mode === "authorized" && !dependencies.signChallenge) {
          throw new JourneyFailure("authorized_signer_missing", 400);
        }
        let signedMessage: string;
        if (config.mode === "authorized") {
          try {
            signedMessage = await dependencies.signChallenge!(
              challengeBody!.challenge,
            );
          } catch {
            // A local signing failure is deterministic; retrying the request
            // would only repeat it.
            throw new JourneyFailure(
              "challenge_signing_failed",
              undefined,
              undefined,
              false,
            );
          }
          if (!signedMessage) {
            throw new JourneyFailure(
              "challenge_signing_failed",
              undefined,
              undefined,
              false,
            );
          }
        } else {
          signedMessage = "invalid-synthetic-signature";
        }
        const response = await requestJson(
          dependencies.fetch,
          `${baseUrl}/api/prompts/unlock`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Accept: "application/json",
            },
            body: JSON.stringify({
              address: config.buyerAddress,
              promptId: config.promptId,
              token: challengeBody!.token,
              signedMessage,
              idempotencyKey,
            }),
          },
          timeoutMs,
        );
        const code = safeCode(response.body);
        if (config.mode === "authorization-probe") {
          if (response.status !== 401 || code !== "INVALID_SIGNATURE") {
            throw new JourneyFailure(
              "authorization_boundary_failed",
              response.status,
              code,
            );
          }
          return { status: response.status, code };
        }
        if (!response.ok)
          throw new JourneyFailure("unlock_failed", response.status, code);
        return { status: response.status };
      },
      stepOptions,
    );
    steps.push(unlock);
  }

  const failed = steps.find((step) => !step.success);
  return {
    timestamp: new Date().toISOString(),
    success: !failed && steps.length === 3,
    mode: config.mode,
    totalDurationMs: now() - startedAt,
    steps,
    correlationId,
    ...(failed ? { failedStep: failed.name } : {}),
  };
}

/**
 * Runs the journey on an interval with:
 *  - an immediate first run (configurable),
 *  - overlap protection (a slow run is never stacked),
 *  - consecutive-failure alerting and a one-time recovery event.
 *
 * `stop()` is safe to call during an in-flight run; that run finishes and no
 * further runs are scheduled.
 */
export function startSyntheticMonitoring(
  config: SyntheticMonitorConfig,
  dependencies: SyntheticMonitorDependencies = { fetch: globalThis.fetch },
  options: SyntheticMonitorOptions = {},
): SyntheticMonitorHandle {
  const intervalMs = Math.max(1, options.intervalMs ?? 60_000);
  const tracker = createJourneyHealthTracker(options.failureThreshold ?? 2);
  const log =
    options.log ??
    ((level, line) => {
      if (level === "error") console.error(line);
      else console.info(line);
    });
  const emitAlert =
    options.onAlert ?? ((event) => log("error", JSON.stringify(event)));
  let inFlight = false;

  const runNow = async (): Promise<SyntheticJourneyResult | null> => {
    if (inFlight) {
      log(
        "info",
        JSON.stringify({
          event: "synthetic_journey_skipped",
          reason: "overlap",
        }),
      );
      return null;
    }

    inFlight = true;
    try {
      const result = await runSyntheticJourney(config, dependencies);
      const decision = tracker.record(result);
      options.onResult?.(result);
      log(
        result.success ? "info" : "error",
        JSON.stringify({ event: "synthetic_journey", ...result }),
      );
      if (decision.alert) emitAlert(decision.alert);
      if (decision.recovered) emitAlert(decision.recovered);
      return result;
    } catch {
      log(
        "error",
        JSON.stringify({
          event: "synthetic_journey",
          success: false,
          error: "monitor_crashed",
        }),
      );
      return null;
    } finally {
      inFlight = false;
    }
  };

  const timer = setInterval(() => {
    void runNow();
  }, intervalMs);
  // By default the scheduler must not keep a short-lived process (or test
  // runner) alive. Watch mode opts out so the CLI stays running.
  if (options.unref ?? true) {
    (timer as unknown as { unref?: () => void }).unref?.();
  }

  if (options.runImmediately ?? true) {
    void runNow();
  }

  return {
    timer,
    runNow,
    stop() {
      clearInterval(timer);
    },
  };
}

/**
 * Backwards-compatible interval helper. Prefer `startSyntheticMonitoring`
 * when alerting or overlap protection is needed.
 */
export function startPeriodicMonitoring(
  config: SyntheticMonitorConfig,
  dependencies?: SyntheticMonitorDependencies,
  intervalMs = 60_000,
): ReturnType<typeof setInterval> {
  return startSyntheticMonitoring(config, dependencies, { intervalMs }).timer;
}

export const journeyMonitor = { runSyntheticJourney, startPeriodicMonitoring };
