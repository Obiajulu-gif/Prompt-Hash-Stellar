// @vitest-environment node
/**
 * Contract tests for the API problem-details taxonomy (docs/error-code-reference.md).
 * A failure here means a stable machine code, status, message, or doc drifted.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { apiError, ERROR_MESSAGES, ErrorCode } from "../lib/api/errorCodes";
import {
  PROBLEMS,
  PROBLEM_CONTENT_TYPE,
  isErrorCode,
  problemDetails,
  problemDocsRef,
  problemType,
  sendApiError,
  wantsProblemJson,
} from "../lib/api/problemDetails";
import { getUnlockErrorMeta } from "../lib/errors/unlockErrors";

const ROOT = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(join(ROOT, f), "utf8");
const codes = Object.values(ErrorCode);

/**
 * Golden contract. Changing a code's name or allowed statuses is a breaking API change:
 * update this table, docs/error-code-reference.md, and the migration notes in the same commit.
 */
const GOLDEN: Record<string, number[]> = {
  MISSING_FIELDS: [400],
  INVALID_INPUT: [400],
  VALIDATION_ERROR: [400],
  STALE_REQUEST: [400],
  METHOD_NOT_ALLOWED: [405],
  NOT_FOUND: [404],
  PROMPT_NOT_FOUND: [404],
  CHALLENGE_EXPIRED: [400],
  CHALLENGE_INVALID: [400],
  INVALID_SIGNATURE: [401, 400],
  UNAUTHORIZED: [403, 401],
  ACCESS_NOT_PURCHASED: [403],
  STALE_PROMPT_TERMS: [409],
  INVALID_STATE: [409],
  OPERATION_NOT_ALLOWED: [400],
  PERMISSION_DIFF_REQUIRED: [409],
  STALE_PERMISSION_DIFF: [409],
  IDEMPOTENCY_CONFLICT: [409],
  DUPLICATE_EVENT: [409],
  RATE_LIMIT_IP: [429],
  RATE_LIMIT_WALLET: [429],
  RATE_LIMIT_ENTITLEMENT: [429],
  CONFIGURATION_ERROR: [500],
  INTEGRITY_FAILURE: [500],
  TEMPORARY_FAILURE: [500, 400, 401],
  INTERNAL_ERROR: [500],
};

describe("taxonomy registry", () => {
  it("matches the golden contract exactly (no silent adds, removals, or status changes)", () => {
    expect([...codes].sort()).toEqual(Object.keys(GOLDEN).sort());
    for (const [code, statuses] of Object.entries(GOLDEN)) {
      expect(PROBLEMS[code as ErrorCode].statuses, code).toEqual(statuses);
    }
  });

  it("has a definition and a user message for every code, and nothing extra", () => {
    expect(Object.keys(PROBLEMS).sort()).toEqual([...codes].sort());
    expect(Object.keys(ERROR_MESSAGES).sort()).toEqual([...codes].sort());
  });

  it("uses stable code names whose value equals the key", () => {
    for (const [key, value] of Object.entries(ErrorCode)) {
      expect(value).toBe(key);
      expect(key).toMatch(/^[A-Z][A-Z0-9]*(_[A-Z0-9]+)*$/);
    }
  });

  it("uses only 4xx/5xx statuses and unique, non-empty titles", () => {
    const titles = new Set<string>();
    for (const code of codes) {
      const def = PROBLEMS[code];
      for (const s of def.statuses) expect(s, code).toBeGreaterThanOrEqual(400);
      for (const s of def.statuses) expect(s, code).toBeLessThan(600);
      expect(def.title.length, code).toBeGreaterThan(0);
      expect(titles.has(def.title), `duplicate title ${def.title}`).toBe(false);
      titles.add(def.title);
      expect(def.remediation, code).toMatch(/\.$/);
    }
  });

  it("keeps user messages short, sentence-like, and free of internals", () => {
    for (const code of codes) {
      const msg = ERROR_MESSAGES[code];
      expect(msg.length, code).toBeLessThanOrEqual(160);
      expect(msg, code).toMatch(/[.!]$/);
      expect(msg, code).not.toMatch(/secret|private key|stack|mongo|redis|econn|exception|\.ts\b|undefined|null/i);
    }
  });

  it("marks only the documented classes as retryable", () => {
    const retryable = codes.filter((c) => PROBLEMS[c].retryable).sort();
    expect(retryable).toEqual(
      [
        "CHALLENGE_EXPIRED",
        "CHALLENGE_INVALID",
        "INTERNAL_ERROR",
        "INVALID_SIGNATURE",
        "RATE_LIMIT_ENTITLEMENT",
        "RATE_LIMIT_IP",
        "RATE_LIMIT_WALLET",
        "STALE_PROMPT_TERMS",
        "STALE_REQUEST",
        "TEMPORARY_FAILURE",
      ].sort(),
    );
  });

  it("recognizes only registered codes", () => {
    expect(isErrorCode("NOT_FOUND")).toBe(true);
    expect(isErrorCode("toString")).toBe(false);
    expect(isErrorCode(undefined)).toBe(false);
  });
});

describe("problemDetails()", () => {
  it("returns an RFC 9457 body that still carries the legacy error + code", () => {
    const p = problemDetails(ErrorCode.CHALLENGE_EXPIRED);
    expect(p).toMatchObject({
      type: "urn:prompthash:problem:CHALLENGE_EXPIRED",
      title: "Challenge expired",
      status: 400,
      code: "CHALLENGE_EXPIRED",
      retryable: true,
      docs: "docs/error-code-reference.md#challenge_expired",
    });
    expect(p.detail).toBe(ERROR_MESSAGES.CHALLENGE_EXPIRED);
    expect(p.error).toBe(p.detail);
    expect(p).not.toHaveProperty("instance");
  });

  it("honors status, detail, request id, reset, and correlation id", () => {
    const p = problemDetails(ErrorCode.RATE_LIMIT_IP, {
      status: 429,
      detail: "Slow down.",
      requestId: "req-1",
      reset: 123,
      correlationId: "corr-1",
    });
    expect(p).toMatchObject({
      status: 429,
      detail: "Slow down.",
      error: "Slow down.",
      instance: "urn:prompthash:request:req-1",
      reset: 123,
      correlationId: "corr-1",
    });
  });

  it("never exposes fields outside the documented set", () => {
    const allowed = new Set([
      "type", "title", "status", "detail", "instance", "code", "error",
      "remediation", "retryable", "docs", "reset", "correlationId",
    ]);
    for (const code of codes) {
      for (const key of Object.keys(problemDetails(code, { requestId: "r", reset: 1, correlationId: "c" }))) {
        expect(allowed.has(key), `${code}: ${key}`).toBe(true);
      }
    }
  });

  it("builds stable type and docs references", () => {
    expect(problemType(ErrorCode.NOT_FOUND)).toBe("urn:prompthash:problem:NOT_FOUND");
    expect(problemDocsRef(ErrorCode.NOT_FOUND)).toBe("docs/error-code-reference.md#not_found");
  });
});

describe("content negotiation + sendApiError()", () => {
  function fakeRes() {
    const out: { status?: number; json?: unknown; sent?: string; headers: Record<string, string> } = { headers: {} };
    const res = {
      setHeader: (k: string, v: string) => {
        out.headers[k] = v;
      },
      status: (n: number) => {
        out.status = n;
        return {
          json: (b: unknown) => {
            out.json = b;
          },
          send: (b: string) => {
            out.sent = b;
          },
        };
      },
    };
    return { res, out };
  }

  it("detects the problem+json media type", () => {
    expect(wantsProblemJson("application/problem+json")).toBe(true);
    expect(wantsProblemJson("text/html, Application/Problem+JSON;q=0.9")).toBe(true);
    expect(wantsProblemJson(["application/json", "application/problem+json"])).toBe(true);
    expect(wantsProblemJson("application/json")).toBe(false);
    expect(wantsProblemJson(undefined)).toBe(false);
  });

  it("default responses are byte-for-byte the legacy apiError body", () => {
    const { res, out } = fakeRes();
    sendApiError({ headers: {} }, res, ErrorCode.RATE_LIMIT_IP, "Too many requests.", { status: 429, reset: 99 });
    expect(out.status).toBe(429);
    expect(JSON.stringify(out.json)).toBe(
      JSON.stringify(apiError(ErrorCode.RATE_LIMIT_IP, "Too many requests.", { reset: 99 })),
    );
    expect(out.headers).toEqual({});
  });

  it("works with requests that have no headers object", () => {
    const { res, out } = fakeRes();
    sendApiError({}, res, ErrorCode.METHOD_NOT_ALLOWED, "Method not allowed.", { status: 405 });
    expect(out.json).toEqual({ error: "Method not allowed.", code: "METHOD_NOT_ALLOWED" });
  });

  it("emits problem+json only when asked, without changing the status", () => {
    const { res, out } = fakeRes();
    sendApiError(
      { headers: { accept: PROBLEM_CONTENT_TYPE }, requestId: "req-9" },
      res,
      ErrorCode.TEMPORARY_FAILURE,
      "Already processed.",
      { status: 400 },
    );
    expect(out.status).toBe(400);
    expect(out.headers["Content-Type"]).toBe(PROBLEM_CONTENT_TYPE);
    const body = JSON.parse(out.sent!);
    expect(body).toMatchObject({
      code: "TEMPORARY_FAILURE",
      error: "Already processed.",
      detail: "Already processed.",
      status: 400,
      instance: "urn:prompthash:request:req-9",
    });
  });
});

// ─── static scan of the real handlers ────────────────────────────────────────

function apiSources(): { file: string; text: string }[] {
  return (readdirSync(join(ROOT, "api"), { recursive: true }) as string[])
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"))
    .map((f) => ({ file: `api/${f}`, text: read(`api/${f}`) }));
}

describe("handler contract (static scan of api/)", () => {
  const sources = apiSources();

  it("only references ErrorCode members that exist", () => {
    const unknown: string[] = [];
    for (const { file, text } of sources) {
      for (const m of text.matchAll(/ErrorCode\.([A-Z][A-Z0-9_]*)/g)) {
        if (!(m[1] in ErrorCode)) unknown.push(`${file}: ErrorCode.${m[1]}`);
      }
    }
    expect(unknown).toEqual([]);
  });

  it("only sends a code with a status the taxonomy allows", () => {
    const bad: string[] = [];
    let checked = 0;
    for (const { file, text } of sources) {
      const legacy = /status\((\d{3})\)\s*\.json\(\s*apiError\(\s*ErrorCode\.([A-Z][A-Z0-9_]*)/g;
      for (const m of text.matchAll(legacy)) {
        checked++;
        const allowed = PROBLEMS[m[2] as ErrorCode]?.statuses as readonly number[] | undefined;
        if (!allowed?.includes(Number(m[1]))) bad.push(`${file}: ${m[2]} sent with ${m[1]}`);
      }
      for (const call of text.matchAll(/sendApiError\(([\s\S]*?)\);/g)) {
        const status = call[1].match(/status:\s*(\d{3})/)?.[1];
        const callCodes = [...call[1].matchAll(/ErrorCode\.([A-Z][A-Z0-9_]*)/g)].map((c) => c[1]);
        expect(status, `${file}: sendApiError without status`).toBeTruthy();
        for (const c of callCodes) {
          checked++;
          if (!(PROBLEMS[c as ErrorCode]?.statuses as readonly number[] | undefined)?.includes(Number(status))) {
            bad.push(`${file}: ${c} sent with ${status}`);
          }
        }
      }
    }
    expect(checked).toBeGreaterThan(20);
    expect(bad).toEqual([]);
  });

  it("auth endpoints use the shared helper so problem+json can be negotiated", () => {
    for (const f of ["api/auth/verify.ts", "api/auth/challenge.ts"]) {
      const text = read(f);
      expect(text, f).toContain("sendApiError(");
      expect(text, f).not.toMatch(/\.json\(\s*apiError\(/);
    }
  });
});

// ─── docs and locales stay in sync ───────────────────────────────────────────

describe("documentation + localization contract", () => {
  const doc = read("docs/error-code-reference.md");

  it("documents every code with a heading and a table row that matches the registry", () => {
    for (const code of codes) {
      const def = PROBLEMS[code];
      expect(doc, `heading for ${code}`).toMatch(new RegExp(`^### ${code}$`, "m"));
      const row = doc.match(new RegExp(`^\\| \`${code}\` \\|(.*)\\|$`, "m"))?.[1];
      expect(row, `table row for ${code}`).toBeTruthy();
      const cells = row!.split("|").map((c) => c.trim());
      const [canonical, ...legacy] = def.statuses;
      expect(cells[0], `${code} status`).toBe(legacy.length ? `${canonical} (also ${legacy.join(", ")})` : String(canonical));
      expect(cells[1], `${code} title`).toBe(def.title);
      expect(cells[2], `${code} message`).toBe(`"${ERROR_MESSAGES[code]}"`);
      expect(cells[3], `${code} remediation`).toBe(def.remediation);
      expect(cells[4], `${code} retry`).toBe(def.retryable ? "yes" : "no");
    }
  });

  it("documents no code that does not exist", () => {
    const documented = [...doc.matchAll(/^\| `([A-Z][A-Z0-9_]+)` \|/gm)].map((m) => m[1]);
    expect(documented.sort()).toEqual([...codes].sort());
  });

  it("has a translation for every code in every locale and UI metadata for every code", () => {
    for (const lang of ["en", "es", "fr", "zh"]) {
      const locale = JSON.parse(read(`src/i18n/locales/${lang}.json`));
      const translated = Object.keys(locale.unlockErrors.codes);
      for (const code of codes) {
        expect(translated, `${lang}.${code}`).toContain(code);
        expect(String(locale.unlockErrors.codes[code]).length, `${lang}.${code}`).toBeGreaterThan(0);
      }
    }
    for (const code of codes) expect(getUnlockErrorMeta(code), code).not.toBeNull();
  });

  it("keeps the English locale text identical to the API user messages", () => {
    const en = JSON.parse(read("src/i18n/locales/en.json")).unlockErrors.codes;
    for (const code of codes) expect(en[code], code).toBe(ERROR_MESSAGES[code]);
  });
});
