import { describe, it, expect, vi, beforeEach } from "vitest";
import { createHash } from "crypto";

vi.mock("../models/WebhookOutboxEvent", () => ({
  default: {
    create: vi.fn(),
    findOne: vi.fn(),
    findOneAndUpdate: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));

vi.mock("../models/WebhookSubscription", () => ({
  default: {
    find: vi.fn(),
    findById: vi.fn(),
    findByIdAndUpdate: vi.fn(),
  },
}));

vi.mock("../services/ssrfGuard", async () => {
  const actual = await vi.importActual<typeof import("../services/ssrfGuard")>(
    "../services/ssrfGuard",
  );
  return { ...actual, postSignedWebhook: vi.fn() };
});

import WebhookOutboxEvent from "../models/WebhookOutboxEvent";
import WebhookSubscription from "../models/WebhookSubscription";
import { enqueue } from "../services/webhookOutbox";
import { deliverRow } from "../services/webhookOutboxWorker";
import { postSignedWebhook } from "../services/ssrfGuard";
import {
  buildCsv,
  contentDispositionValue,
  escapeCsvField,
  escapeQuotedCsvField,
  neutralizeCsvFormula,
  opaqueRef,
  projectAllowedFields,
  redactSensitiveFields,
  sanitizeAttachmentFilename,
  toCsvRow,
} from "../services/sensitiveContent";

// ── Rendering/CSV safety ─────────────────────────────────────────────────────

describe("CSV injection boundaries", () => {
  it("neutralizes every spreadsheet formula trigger", () => {
    for (const payload of [
      '=HYPERLINK("https://evil.example","click")',
      "+1+1",
      "-2+3",
      "@SUM(A1)",
      "\t=cmd|' /C calc'!A0",
      "\r=1+1",
    ]) {
      const escaped = escapeCsvField(payload);
      // The raw formula must never start a cell after unquoting.
      expect(escaped).toMatch(/^"'/);
      expect(escaped.startsWith(`"${payload[0]}`)).toBe(false);
    }
  });

  it("keeps legitimate negative numbers readable (numbers are data, not formulas)", () => {
    expect(escapeCsvField(-12.5)).toBe('"-12.5"');
  });

  it("doubles embedded quotes and keeps commas/newlines inside the quoted cell", () => {
    expect(escapeCsvField('say "hi", ok\nnext')).toBe('"say ""hi"", ok\nnext"');
  });

  it("quotes null/undefined as empty cells", () => {
    expect(escapeCsvField(null)).toBe('""');
    expect(escapeCsvField(undefined)).toBe('""');
  });

  it("buildCsv emits a header plus escaped rows", () => {
    const csv = buildCsv(
      ["name", "note"],
      [
        ["title", "=cmd()"],
        ["", null],
      ],
    );
    const lines = csv.split("\n");
    expect(lines[0]).toBe('"name","note"');
    expect(lines[1]).toBe('"title","\'=cmd()"');
    expect(lines[2]).toBe('"",""');
  });

  it("legacy quoting helpers keep historical output for safe cells while guarding formulas", () => {
    // Matches the payout-statement export's historical byte layout.
    expect(escapeQuotedCsvField("0xbuyer789")).toBe('"0xbuyer789"');
    expect(escapeQuotedCsvField('Creative "Quotes" Prompt')).toBe(
      '"Creative ""Quotes"" Prompt"',
    );
    expect(neutralizeCsvFormula("sale")).toBe("sale");
    expect(neutralizeCsvFormula("settled")).toBe("settled");
    // ...but a crafted enum/text cell cannot start a formula.
    expect(neutralizeCsvFormula("=cmd()")).toBe("'=cmd()");
    expect(escapeQuotedCsvField("@SUM(A1)")).toBe('"\'@SUM(A1)"');
  });
});

// ── Download filename / header safety ────────────────────────────────────────

describe("download filename and header boundaries", () => {
  it("strips CRLF, quotes, path separators, and control characters from filenames", () => {
    const safe = sanitizeAttachmentFilename(
      'evil".csv\r\nSet-Cookie: x=1\x00<script>/../',
    );

    // eslint-disable-next-line no-control-regex
    expect(safe).not.toMatch(/[\r\n\u0000"\\/:<>]/);
    expect(safe).not.toContain("..");
    expect(safe).not.toContain("<script>");
  });

  it("falls back when the filename is empty after sanitization", () => {
    expect(sanitizeAttachmentFilename("\r\n")).toBe("download");
  });

  it("bounds filename length", () => {
    expect(
      sanitizeAttachmentFilename("a".repeat(500)).length,
    ).toBeLessThanOrEqual(120);
  });

  it("contentDispositionValue never carries header-injection sequences", () => {
    const header = contentDispositionValue('payout.csv"\r\nX-Injected: 1');
    expect(header.startsWith('attachment; filename="')).toBe(true);
    expect(header).not.toMatch(/[\r\n]/);
    expect(header.match(/"/g)?.length).toBe(2); // exactly the wrapping quotes
  });
});

// ── Export allow-lists ───────────────────────────────────────────────────────

describe("export allow-list projection", () => {
  it("drops every field that is not explicitly allowed", () => {
    const record = {
      entryId: "e1",
      amount: 10,
      description: "payout",
      privateKey: "SXXX",
      encryptedPrompt: "cipher",
      internalNotes: "do not ship",
    };

    const projected = projectAllowedFields(record, [
      "entryId",
      "amount",
      "description",
    ]);

    expect(projected).toEqual({
      entryId: "e1",
      amount: 10,
      description: "payout",
    });
    expect(JSON.stringify(projected)).not.toContain("SXXX");
  });

  it("omits missing allowed fields instead of inventing empty values", () => {
    expect(projectAllowedFields({ a: 1 }, ["a", "b"])).toEqual({ a: 1 });
  });
});

// ── Deep redaction ───────────────────────────────────────────────────────────

describe("redactSensitiveFields", () => {
  it("redacts deny-listed keys at any depth while preserving safe fields", () => {
    const input = {
      event: "PromptPurchased",
      promptId: "42",
      buyer: { wallet: "GABC", privateKey: "SXXX" },
      nested: { deeper: { encryptedPrompt: "cipher", note: "ok" } },
      tokens: ["safe", { refreshToken: "rt" }],
    };

    const redacted = redactSensitiveFields(input) as typeof input;

    expect(redacted.event).toBe("PromptPurchased");
    expect(redacted.promptId).toBe("42");
    expect(redacted.buyer.wallet).toBe("GABC");
    expect(redacted.buyer.privateKey).toBe("[REDACTED]");
    expect(redacted.nested.deeper.encryptedPrompt).toBe("[REDACTED]");
    expect(redacted.nested.deeper.note).toBe("ok");
    expect(JSON.stringify(redacted)).not.toContain("SXXX");
    expect(JSON.stringify(redacted)).not.toContain("cipher");
    expect(JSON.stringify(redacted)).not.toContain("rt");
  });

  it("bounds depth and sibling counts so hostile payloads cannot grow unbounded", () => {
    const deep: Record<string, unknown> = {};
    let cursor = deep;
    for (let i = 0; i < 12; i += 1) {
      cursor.child = {};
      cursor = cursor.child as Record<string, unknown>;
    }

    const bounded = redactSensitiveFields(deep, { maxDepth: 2 }) as Record<
      string,
      any
    >;
    expect(JSON.stringify(bounded)).toContain("[TRUNCATED]");

    const wide = Object.fromEntries(
      Array.from({ length: 500 }, (_, i) => [`k${i}`, i]),
    );
    const trimmed = redactSensitiveFields(wide, { maxEntries: 10 }) as Record<
      string,
      unknown
    >;
    expect(Object.keys(trimmed)).toHaveLength(10);
  });

  it("bounds long strings with a deterministic marker", () => {
    const long = "x".repeat(5000);
    const result = redactSensitiveFields(
      { note: long },
      { maxStringLength: 100 },
    ) as {
      note: string;
    };
    expect(result.note.startsWith("x".repeat(100))).toBe(true);
    expect(result.note).toContain("[truncated:5000]");
  });

  it("opaqueRef is stable, short, and non-reversible", () => {
    const ref = opaqueRef("secret-payload-ref");
    expect(ref).toMatch(/^[a-f0-9]{32}$/);
    expect(ref).toBe(opaqueRef("secret-payload-ref"));
    expect(ref).not.toContain("secret");
  });
});

// ── Webhook payload boundary ─────────────────────────────────────────────────

function canonicalHash(value: Record<string, unknown>): string {
  const sortDeep = (input: unknown): unknown => {
    if (Array.isArray(input)) return input.map(sortDeep);
    if (input && typeof input === "object") {
      return Object.keys(input as Record<string, unknown>)
        .sort()
        .reduce<Record<string, unknown>>((acc, key) => {
          acc[key] = sortDeep((input as Record<string, unknown>)[key]);
          return acc;
        }, {});
    }
    return input;
  };
  return createHash("sha256")
    .update(JSON.stringify(sortDeep(value)))
    .digest("hex");
}

describe("webhook payload sensitive-content boundary", () => {
  beforeEach(() => vi.clearAllMocks());

  it("redacts private fields before the outbox row is created, and hashes the redacted payload", async () => {
    (WebhookSubscription.find as any).mockResolvedValue([{ _id: "sub-1" }]);
    (WebhookOutboxEvent.findOne as any).mockResolvedValue(null);
    (WebhookSubscription.findByIdAndUpdate as any).mockResolvedValue({
      _id: "sub-1",
      nextDeliverySequence: 1,
    });
    (WebhookOutboxEvent.create as any).mockResolvedValue({ _id: "row-1" });

    await enqueue(
      "GCREATOR",
      "PromptPurchased",
      {
        promptId: "42",
        buyerWallet: "GBUYER",
        encryptedPrompt: "cipher-text",
        privateKey: "SPSECRET",
        nested: { plaintext: "the actual prompt" },
      },
      "event-99",
    );

    const createdArg = (WebhookOutboxEvent.create as any).mock.calls[0][0];
    expect(createdArg.payload).toEqual({
      promptId: "42",
      buyerWallet: "GBUYER",
      encryptedPrompt: "[REDACTED]",
      privateKey: "[REDACTED]",
      nested: { plaintext: "[REDACTED]" },
    });
    expect(JSON.stringify(createdArg)).not.toContain("cipher-text");
    expect(JSON.stringify(createdArg)).not.toContain("SPSECRET");
    expect(JSON.stringify(createdArg)).not.toContain("the actual prompt");
    // Subscribers can still verify integrity: hash covers the delivered body.
    expect(createdArg.payloadHash).toBe(canonicalHash(createdArg.payload));
  });

  it("never sends a subscription secret inside the delivered webhook body", async () => {
    const secret = "sub-signing-secret-value";
    (WebhookSubscription.findById as any).mockResolvedValue({
      _id: "sub-1",
      active: true,
      url: "https://example.com/hook",
      secret,
    });
    (postSignedWebhook as any).mockResolvedValue({
      status: 200,
      body: "ok",
      headers: {},
    });
    (WebhookOutboxEvent.findOne as any).mockResolvedValue(null);

    await deliverRow({
      _id: "row-1",
      subscriptionId: "sub-1",
      eventId: "event-42",
      deliveryId: "delivery-42",
      sequence: 1,
      payloadHash: "a".repeat(64),
      event: "PromptPurchased",
      payload: { promptId: "42" },
      attempts: 0,
    } as any);

    const [, headers, body] = (postSignedWebhook as any).mock.calls[0];
    expect(body).not.toContain(secret);
    expect(JSON.stringify(headers)).not.toContain(secret);
  });
});
