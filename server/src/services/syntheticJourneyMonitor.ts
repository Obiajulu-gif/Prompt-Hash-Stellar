/**
 * Non-mutating synthetic monitor for the critical browse -> challenge -> unlock
 * journey (#1039). The wallet/prompt pair must be a dedicated, pre-entitled
 * fixture; this monitor never submits a purchase or writes marketplace data.
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

type JsonResponse = { status: number; ok: boolean; body: unknown };

class JourneyFailure extends Error {
  public readonly status?: number;
  public readonly code?: string;

  constructor(message: string, status?: number, code?: string) {
    super(message);
    this.status = status;
    this.code = code;
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

function isRetryable(status: number | undefined): boolean {
  return (
    status === undefined ||
    status === 408 ||
    status === 425 ||
    status === 429 ||
    status >= 500
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
      const failure =
        error instanceof JourneyFailure
          ? error
          : new JourneyFailure(
              error instanceof Error && error.name === "AbortError"
                ? "request_timeout"
                : "network_error",
            );
      if (attempt === options.maxAttempts || !isRetryable(failure.status)) {
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
        const signedMessage =
          config.mode === "authorized"
            ? await dependencies.signChallenge!(challengeBody!.challenge)
            : "invalid-synthetic-signature";
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

export function startPeriodicMonitoring(
  config: SyntheticMonitorConfig,
  dependencies?: SyntheticMonitorDependencies,
  intervalMs = 60_000,
): ReturnType<typeof setInterval> {
  return setInterval(() => {
    void runSyntheticJourney(config, dependencies)
      .then((result) => {
        const log = result.success ? console.info : console.error;
        log(JSON.stringify({ event: "synthetic_journey", ...result }));
      })
      .catch(() =>
        console.error(
          JSON.stringify({
            event: "synthetic_journey",
            success: false,
            error: "monitor_crashed",
          }),
        ),
      );
  }, intervalMs);
}

export const journeyMonitor = { runSyntheticJourney, startPeriodicMonitoring };
