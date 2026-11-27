import { describe, it, expect, vi } from "vitest";
import {
  AiProviderError,
  aiProviderErrorStatus,
  callAiProvider,
  parseAiProviderConfig,
  validateAiProviderConfig,
  type AiProviderConfig,
} from "../services/aiProvider";
import { StartupConfigurationError, validateStartupConfig } from "../config/startupValidation";

const CONFIG: AiProviderConfig = {
  baseUrl: "https://ai.example.test",
  timeoutMs: 1_000,
  maxRetries: 2,
};

/** Deterministic deps: no real waiting between retries. */
function deps(fetchImpl: any, config: AiProviderConfig | null = CONFIG) {
  return {
    config,
    fetchImpl: fetchImpl as typeof fetch,
    sleep: vi.fn(async () => {}),
    random: () => 0.5,
  };
}

function jsonResponse(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AI provider configuration", () => {
  it("treats an unset base URL as disabled, not as an error", () => {
    expect(parseAiProviderConfig({})).toBeNull();
    expect(parseAiProviderConfig({ AI_PROVIDER_BASE_URL: "   " })).toBeNull();
    expect(() => validateAiProviderConfig({})).not.toThrow();
  });

  it("parses a valid https provider with defaults for timeout and retries", () => {
    const config = parseAiProviderConfig({ AI_PROVIDER_BASE_URL: "https://ai.example.test/" });
    expect(config).toEqual({
      baseUrl: "https://ai.example.test",
      apiKey: undefined,
      timeoutMs: 10_000,
      maxRetries: 1,
    });
  });

  it("rejects plain http for a non-local host", () => {
    expect(() =>
      parseAiProviderConfig({ AI_PROVIDER_BASE_URL: "http://ai.example.test" }),
    ).toThrow(/must use https/);
  });

  it("allows http only for localhost outside production", () => {
    expect(
      parseAiProviderConfig({ AI_PROVIDER_BASE_URL: "http://localhost:8080", NODE_ENV: "development" })?.baseUrl,
    ).toBe("http://localhost:8080");
    expect(() =>
      parseAiProviderConfig({ AI_PROVIDER_BASE_URL: "http://localhost:8080", NODE_ENV: "production" }),
    ).toThrow(/must use https/);
  });

  it("rejects credentials and query strings embedded in the URL", () => {
    expect(() => parseAiProviderConfig({ AI_PROVIDER_BASE_URL: "https://user:pw@ai.example.test" })).toThrow(
      /must not embed credentials/,
    );
    expect(() => parseAiProviderConfig({ AI_PROVIDER_BASE_URL: "https://ai.example.test/?key=abc" })).toThrow(
      /query string/,
    );
  });

  it("rejects a malformed URL and out-of-range timeout or retry settings", () => {
    expect(() => parseAiProviderConfig({ AI_PROVIDER_BASE_URL: "not a url" })).toThrow(/not a valid URL/);
    expect(() =>
      parseAiProviderConfig({ AI_PROVIDER_BASE_URL: "https://ai.example.test", AI_PROVIDER_TIMEOUT_MS: "5" }),
    ).toThrow(/AI_PROVIDER_TIMEOUT_MS/);
    expect(() =>
      parseAiProviderConfig({ AI_PROVIDER_BASE_URL: "https://ai.example.test", AI_PROVIDER_MAX_RETRIES: "9" }),
    ).toThrow(/AI_PROVIDER_MAX_RETRIES/);
  });

  it("rejects a short API key without echoing it", () => {
    try {
      parseAiProviderConfig({ AI_PROVIDER_BASE_URL: "https://ai.example.test", AI_PROVIDER_API_KEY: "short" });
      throw new Error("expected throw");
    } catch (err) {
      expect((err as Error).message).toMatch(/at least 16 characters/);
      expect((err as Error).message).not.toContain("short");
    }
  });

  it("surfaces AI misconfiguration through startup validation, failing closed", () => {
    const env = { NODE_ENV: "production", AI_PROVIDER_BASE_URL: "http://ai.example.test" };
    expect(() => validateStartupConfig(env, { strictProduction: true })).toThrow(StartupConfigurationError);
    try {
      validateStartupConfig(env, { strictProduction: true });
    } catch (err) {
      const keys = (err as StartupConfigurationError).errors.map((e) => e.key);
      expect(keys).toContain("AI_PROVIDER_BASE_URL");
    }
  });
});

describe("callAiProvider — configured provider", () => {
  it("returns parsed JSON from a successful provider call", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { improved: "better prompt" }));
    const result = await callAiProvider(
      { method: "POST", path: "/api/improve-prompt", body: "draft", contentType: "text/plain" },
      deps(fetchImpl),
    );

    expect(result).toEqual({ improved: "better prompt" });
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://ai.example.test/api/improve-prompt",
      expect.objectContaining({ method: "POST", body: "draft" }),
    );
  });

  it("sends the bearer credential when configured", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(200, { ok: true }));
    await callAiProvider({ path: "/api/health" }, deps(fetchImpl, { ...CONFIG, apiKey: "k".repeat(20) }));

    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    expect((init.headers as Record<string, string>).Authorization).toBe(`Bearer ${"k".repeat(20)}`);
  });

  it("returns plain-text provider responses as strings", async () => {
    const fetchImpl = vi.fn(async () => new Response("plain answer", { status: 200 }));
    await expect(callAiProvider({ path: "/api/chat" }, deps(fetchImpl))).resolves.toBe("plain answer");
  });

  it("reports an empty success body as an invalid response", async () => {
    const fetchImpl = vi.fn(async () => new Response("", { status: 200 }));
    await expect(callAiProvider({ path: "/api/chat" }, deps(fetchImpl))).rejects.toMatchObject({
      code: "AI_PROVIDER_INVALID_RESPONSE",
    });
  });
});

describe("callAiProvider — unconfigured provider", () => {
  it("fails with NOT_CONFIGURED without making any network call", async () => {
    const fetchImpl = vi.fn();
    const err = await callAiProvider({ path: "/api/chat" }, deps(fetchImpl, null)).catch((e) => e);

    expect(err).toBeInstanceOf(AiProviderError);
    expect(err.code).toBe("AI_PROVIDER_NOT_CONFIGURED");
    expect(err.retryable).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(aiProviderErrorStatus(err.code)).toBe(503);
  });
});

describe("callAiProvider — timeouts", () => {
  it("aborts a hung provider and reports AI_PROVIDER_TIMEOUT after bounded retries", async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => {
            const abort = new Error("aborted");
            abort.name = "AbortError";
            reject(abort);
          });
        }),
    );

    const err = await callAiProvider(
      { path: "/api/chat" },
      deps(fetchImpl, { ...CONFIG, timeoutMs: 500, maxRetries: 1 }),
    ).catch((e) => e);

    expect(err.code).toBe("AI_PROVIDER_TIMEOUT");
    expect(err.retryable).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2); // first attempt + one retry
    expect(aiProviderErrorStatus(err.code)).toBe(504);
  }, 10_000);
});

describe("callAiProvider — provider errors", () => {
  it("retries a 5xx up to maxRetries and then reports AI_PROVIDER_UNAVAILABLE", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(503, { detail: "upstream down" }));
    const d = deps(fetchImpl);

    const err = await callAiProvider({ path: "/api/chat" }, d).catch((e) => e);

    expect(err.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(fetchImpl).toHaveBeenCalledTimes(CONFIG.maxRetries + 1);
    expect(d.sleep).toHaveBeenCalledTimes(CONFIG.maxRetries);
    expect(aiProviderErrorStatus(err.code)).toBe(503);
  });

  it("recovers when a transient 500 is followed by success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse(500, {}))
      .mockResolvedValueOnce(jsonResponse(200, { improved: "ok" }));

    await expect(callAiProvider({ path: "/api/chat" }, deps(fetchImpl))).resolves.toEqual({ improved: "ok" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("does not retry a 4xx rejection and maps it to 502", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(400, { error: "bad prompt" }));

    const err = await callAiProvider({ path: "/api/chat" }, deps(fetchImpl)).catch((e) => e);

    expect(err.code).toBe("AI_PROVIDER_REJECTED");
    expect(err.retryable).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(aiProviderErrorStatus(err.code)).toBe(502);
  });

  it("treats a network failure as retryable unavailability", async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError("fetch failed");
    });

    const err = await callAiProvider({ path: "/api/chat" }, deps(fetchImpl, { ...CONFIG, maxRetries: 0 })).catch(
      (e) => e,
    );

    expect(err.code).toBe("AI_PROVIDER_UNAVAILABLE");
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("never includes the provider response body or the prompt in the error message", async () => {
    const secretPrompt = "my confidential prompt text";
    const fetchImpl = vi.fn(async () => jsonResponse(400, { echo: secretPrompt }));

    const err = await callAiProvider(
      { method: "POST", path: "/api/improve-prompt", body: secretPrompt, contentType: "text/plain" },
      deps(fetchImpl),
    ).catch((e) => e);

    expect(err.message).not.toContain(secretPrompt);
    expect(err.message).toBe("AI provider rejected the request with status 400.");
  });
});
