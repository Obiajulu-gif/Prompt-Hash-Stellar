/**
 * Backend-owned AI provider boundary (#29).
 *
 * The provider URL and credentials live only in validated server
 * environment variables. Frontend code talks to this backend, never to the
 * provider, so provider details are not shipped to browsers and every
 * prompt that leaves the application passes through one place with explicit
 * timeouts, bounded retries and structured failures.
 *
 * Privacy: prompt text is forwarded to the configured provider and to
 * nothing else. Errors and logs never include prompt content or the
 * provider's response body (an echoing upstream could otherwise leak it).
 * See docs/AI_PROVIDER_BOUNDARY.md for what is transmitted.
 *
 * Environment:
 *   AI_PROVIDER_BASE_URL    Provider base URL. Unset = AI features disabled.
 *                           Must be https (http allowed only for localhost in
 *                           non-production) with no credentials or query string.
 *   AI_PROVIDER_API_KEY     Optional bearer credential. Never logged.
 *   AI_PROVIDER_TIMEOUT_MS  Per-attempt timeout. Default 10000, range 500-60000.
 *   AI_PROVIDER_MAX_RETRIES Retries after the first attempt. Default 1, range 0-3.
 */

const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_MAX_RETRIES = 1;
const MAX_TIMEOUT_MS = 60_000;
const MIN_TIMEOUT_MS = 500;
const MAX_RETRIES_LIMIT = 3;
const RETRY_BASE_MS = 200;
const RETRY_CAP_MS = 2_000;
const MIN_API_KEY_LENGTH = 16;

export type AiProviderErrorCode =
  | "AI_PROVIDER_NOT_CONFIGURED"
  | "AI_PROVIDER_TIMEOUT"
  | "AI_PROVIDER_UNAVAILABLE"
  | "AI_PROVIDER_REJECTED"
  | "AI_PROVIDER_INVALID_RESPONSE";

export interface AiProviderConfig {
  baseUrl: string;
  apiKey?: string;
  timeoutMs: number;
  maxRetries: number;
}

export class AiProviderError extends Error {
  readonly code: AiProviderErrorCode;
  readonly retryable: boolean;

  constructor(code: AiProviderErrorCode, message: string, retryable: boolean) {
    super(message);
    this.name = "AiProviderError";
    this.code = code;
    this.retryable = retryable;
  }
}

type Env = Record<string, string | undefined>;

function parseBoundedInt(raw: string | undefined, name: string, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  }
  return value;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

/**
 * Validates the AI provider environment. Returns `null` when the provider is
 * not configured (the feature is then disabled, which is a valid state).
 * Throws with an actionable message when configuration is present but wrong,
 * so a misconfigured deployment fails at startup rather than at first use.
 */
export function parseAiProviderConfig(env: Env = process.env): AiProviderConfig | null {
  const rawUrl = env.AI_PROVIDER_BASE_URL?.trim();
  if (!rawUrl) return null;

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error("AI_PROVIDER_BASE_URL is not a valid URL.");
  }

  const isProduction = env.NODE_ENV === "production";
  const httpAllowed = !isProduction && isLocalHost(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && httpAllowed)) {
    throw new Error(
      "AI_PROVIDER_BASE_URL must use https (http is allowed only for localhost outside production).",
    );
  }
  if (url.username || url.password) {
    throw new Error("AI_PROVIDER_BASE_URL must not embed credentials; use AI_PROVIDER_API_KEY.");
  }
  if (url.search || url.hash) {
    throw new Error("AI_PROVIDER_BASE_URL must not include a query string or fragment.");
  }

  const apiKey = env.AI_PROVIDER_API_KEY?.trim() || undefined;
  if (apiKey !== undefined && apiKey.length < MIN_API_KEY_LENGTH) {
    throw new Error(`AI_PROVIDER_API_KEY must be at least ${MIN_API_KEY_LENGTH} characters.`);
  }

  return {
    baseUrl: url.toString().replace(/\/+$/, ""),
    apiKey,
    timeoutMs: parseBoundedInt(env.AI_PROVIDER_TIMEOUT_MS, "AI_PROVIDER_TIMEOUT_MS", DEFAULT_TIMEOUT_MS, MIN_TIMEOUT_MS, MAX_TIMEOUT_MS),
    maxRetries: parseBoundedInt(env.AI_PROVIDER_MAX_RETRIES, "AI_PROVIDER_MAX_RETRIES", DEFAULT_MAX_RETRIES, 0, MAX_RETRIES_LIMIT),
  };
}

/** Startup check: throws on invalid configuration. Unset is allowed (disabled). */
export function validateAiProviderConfig(env: Env = process.env): void {
  parseAiProviderConfig(env);
}

export function isAiProviderConfigured(env: Env = process.env): boolean {
  return parseAiProviderConfig(env) !== null;
}

export interface AiProviderRequest {
  method?: "GET" | "POST";
  /** Path appended to the configured base URL, e.g. `/api/improve-prompt`. */
  path: string;
  body?: string;
  contentType?: string;
}

export interface AiProviderDeps {
  config?: AiProviderConfig | null;
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function retryDelayMs(attempt: number, random: () => number): number {
  const cap = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** attempt);
  return Math.floor(cap / 2 + random() * (cap / 2));
}

async function readJsonOrText(response: Response): Promise<unknown> {
  const text = await response.text();
  if (text.length === 0) return null;
  try {
    return JSON.parse(text);
  } catch {
    // Plain-text provider responses are returned as strings. The body is
    // never placed in an error message or log line.
    return text;
  }
}

/**
 * Calls the configured AI provider with a per-attempt timeout and bounded
 * retries. Retries apply only to transient failures (network errors,
 * timeouts, 429, 5xx); a 4xx rejection is returned immediately because it
 * will not succeed on retry.
 *
 * Throws {@link AiProviderError}. Callers map `code` to an HTTP status.
 */
export async function callAiProvider(request: AiProviderRequest, deps: AiProviderDeps = {}): Promise<unknown> {
  const config = deps.config === undefined ? parseAiProviderConfig() : deps.config;
  if (!config) {
    throw new AiProviderError(
      "AI_PROVIDER_NOT_CONFIGURED",
      "AI assistance is not configured on this deployment.",
      false,
    );
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const sleep = deps.sleep ?? defaultSleep;
  const random = deps.random ?? Math.random;
  const url = `${config.baseUrl}${request.path}`;
  const headers: Record<string, string> = { Accept: "application/json" };
  if (request.contentType) headers["Content-Type"] = request.contentType;
  if (config.apiKey) headers.Authorization = `Bearer ${config.apiKey}`;

  const attempts = config.maxRetries + 1;
  let lastError: AiProviderError | null = null;

  for (let attempt = 0; attempt < attempts; attempt++) {
    if (attempt > 0) await sleep(retryDelayMs(attempt, random));

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), config.timeoutMs);
    try {
      const response = await fetchImpl(url, {
        method: request.method ?? (request.body !== undefined ? "POST" : "GET"),
        headers,
        body: request.body,
        signal: controller.signal,
      });

      if (response.status === 429 || response.status >= 500) {
        lastError = new AiProviderError(
          "AI_PROVIDER_UNAVAILABLE",
          `AI provider returned status ${response.status}.`,
          true,
        );
        continue;
      }
      if (!response.ok) {
        throw new AiProviderError(
          "AI_PROVIDER_REJECTED",
          `AI provider rejected the request with status ${response.status}.`,
          false,
        );
      }

      const data = await readJsonOrText(response);
      if (data === null) {
        throw new AiProviderError("AI_PROVIDER_INVALID_RESPONSE", "AI provider returned an empty response.", false);
      }
      return data;
    } catch (err) {
      if (err instanceof AiProviderError) {
        if (!err.retryable) throw err;
        lastError = err;
        continue;
      }
      const aborted = (err as { name?: string })?.name === "AbortError";
      lastError = aborted
        ? new AiProviderError("AI_PROVIDER_TIMEOUT", `AI provider did not respond within ${config.timeoutMs} ms.`, true)
        : new AiProviderError("AI_PROVIDER_UNAVAILABLE", "AI provider could not be reached.", true);
    } finally {
      clearTimeout(timer);
    }
  }

  throw lastError ?? new AiProviderError("AI_PROVIDER_UNAVAILABLE", "AI provider could not be reached.", true);
}

/** Maps a provider error code to the HTTP status the backend returns. */
export function aiProviderErrorStatus(code: AiProviderErrorCode): number {
  switch (code) {
    case "AI_PROVIDER_NOT_CONFIGURED":
      return 503;
    case "AI_PROVIDER_TIMEOUT":
      return 504;
    case "AI_PROVIDER_UNAVAILABLE":
      return 503;
    case "AI_PROVIDER_REJECTED":
    case "AI_PROVIDER_INVALID_RESPONSE":
      return 502;
  }
}
