import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/*
 * Frontend side of the AI boundary (#29). The browser must talk only to the
 * backend: no provider URL in client code, a clear unavailable state when the
 * backend reports AI disabled or failing, and structured errors surfaced as
 * AiUnavailableError.
 */

const state = vi.hoisted(() => ({ chatApiBase: "" }));

vi.mock("../lib/env", () => ({
  get chatApiBase() {
    return state.chatApiBase;
  },
}));

import {
  AiUnavailableError,
  checkHealth,
  getChatResponse,
  getModels,
  improvePrompt,
  localImprovePrompt,
} from "../lib/api";

/** First argument of the first recorded fetch call. */
function firstFetchUrl(mock: ReturnType<typeof vi.fn>): string {
  return String((mock.mock.calls[0] as unknown as [unknown])[0]);
}

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AI boundary — client code contains no provider URL", () => {
  it("does not hard-code the former third-party gateway in frontend sources", () => {
    const files = ["../lib/env.ts", "../lib/api.ts"];
    for (const file of files) {
      const source = readFileSync(resolve(__dirname, file), "utf8");
      expect(source, file).not.toMatch(/secret-ai-gateway/);
      expect(source, file).not.toMatch(/onrender\.com/);
    }
  });
});

describe("AI boundary — backend unconfigured (disabled state)", () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    state.chatApiBase = "";
    fetchMock = vi.fn(async () =>
      json(503, {
        error: "AI_PROVIDER_NOT_CONFIGURED",
        message: "AI assistance is not configured on this deployment.",
        retryable: false,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("surfaces the backend's disabled message as AiUnavailableError", async () => {
    const err: any = await getChatResponse("hello").catch((e): any => e);

    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err.code).toBe("AI_PROVIDER_NOT_CONFIGURED");
    expect(err.retryable).toBe(false);
    expect(err.message).toBe("AI assistance is not configured on this deployment.");
  });

  it("uses same-origin backend routes when no backend origin is set", async () => {
    await getChatResponse("hello").catch(() => {});
    expect(firstFetchUrl(fetchMock)).toMatch(/^\/api\/chat\/gateway\?prompt=hello&model=/);
  });

  it("reports health as unavailable so the UI can show the disabled state", async () => {
    fetchMock.mockResolvedValueOnce(json(200, { status: "disabled", configured: false }));
    await expect(checkHealth()).resolves.toBe(false);
  });

  it("falls back to the built-in model list rather than failing the picker", async () => {
    await expect(getModels()).resolves.toMatchObject({ models: expect.any(Array) });
  });

  it("improves a prompt locally when the backend is disabled", async () => {
    const draft = "explain tokens";
    await expect(improvePrompt(draft)).resolves.toBe(localImprovePrompt(draft));
  });
});

describe("AI boundary — backend configured", () => {
  beforeEach(() => {
    state.chatApiBase = "https://api.example.test";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("routes chat through the configured backend origin, never a provider", async () => {
    const fetchMock = vi.fn(async () => json(200, { reply: "hi" }));
    vi.stubGlobal("fetch", fetchMock);

    await expect(getChatResponse("hi there", "gemini-2.5-pro")).resolves.toEqual({ reply: "hi" });
    const url = firstFetchUrl(fetchMock);
    expect(url.startsWith("https://api.example.test/api/chat/gateway?")).toBe(true);
    expect(url).toContain("model=gemini-2.5-pro");
  });

  it("maps a provider timeout to a retryable AiUnavailableError", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        json(504, {
          error: "AI_PROVIDER_TIMEOUT",
          message: "AI provider did not respond within 10000 ms.",
          retryable: true,
        }),
      ),
    );

    const err: any = await getChatResponse("slow").catch((e): any => e);
    expect(err).toBeInstanceOf(AiUnavailableError);
    expect(err.code).toBe("AI_PROVIDER_TIMEOUT");
    expect(err.retryable).toBe(true);
  });

  it("keeps plain (non-AI) server errors as ordinary errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("Internal failure", { status: 500 })));

    const err: any = await getChatResponse("x").catch((e): any => e);
    expect(err).not.toBeInstanceOf(AiUnavailableError);
    expect(err.message).toBe("Internal failure");
  });

  it("reports health as available only when the backend says ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json(200, { status: "ok", configured: true })));
    await expect(checkHealth()).resolves.toBe(true);
  });
});
