import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Strict allow-list validation for URLs, file types, and destinations (#1025).
 *
 * Policy logic is tested directly; the webhook registration path runs the
 * real controller + idempotency middleware against an in-memory mongod so
 * the reject → correct → retry flow is exercised end to end. Only
 * `requireAdminScope` is stubbed (header-driven).
 */

vi.mock("../middleware/adminAuth", () => ({
  requireAdminScope: (scope: string) => (req: any, res: any, next: any) => {
    const header = String(req.headers["x-test-admin"] ?? "");
    if (!header.split(",").includes(scope)) {
      res.status(401).json({ error: "Unauthorized: invalid or insufficient admin token." });
      return;
    }
    next();
  },
}));
vi.mock("../db/connectDb", () => ({ default: async () => undefined }));

import {
  checkContentAgainstPolicy,
  checkFileType,
  checkUrlAgainstPolicy,
  clearRuntimeAllowListOverride,
  enforceContentAllowList,
  enforceEvidenceUrl,
  enforceUrlAllowList,
  hostMatchesAllowList,
  setRuntimeAllowListOverride,
  sniffFileKind,
} from "../services/allowListPolicy";
import { assertSafeWebhookUrlShape, UnsafeWebhookUrlError } from "../services/ssrfGuard";
import { validateEvidence } from "../services/ownershipTransferDisputes";
import { validateListingMetadata } from "../services/listingValidation";
import { allowListRouter } from "../routes/allowListRoutes";
import { webhookRouter } from "../routes/webhookRoutes";
import WebhookSubscription from "../models/WebhookSubscription";
import IdempotencyRecord from "../models/IdempotencyRecord";
import { jsonCall, startHttpServer, type HttpTestServer } from "./helpers/httpApp";
import { resetRealMongo, setupRealMongo, teardownRealMongo } from "./helpers/realMongo";

const ENV_KEYS = [
  "ALLOWLIST_MODE",
  "WEBHOOK_ALLOWED_HOSTS",
  "IMAGE_ALLOWED_HOSTS",
  "DISPUTE_EVIDENCE_ALLOWED_HOSTS",
  "EXTERNAL_REFERENCE_ALLOWED_HOSTS",
] as const;
const savedEnv: Record<string, string | undefined> = {};
beforeEach(() => {
  clearRuntimeAllowListOverride();
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  clearRuntimeAllowListOverride();
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

describe("webhook_destination policy", () => {
  const code = (url: unknown) => checkUrlAgainstPolicy(url, "webhook_destination").code;

  it("allows public https destinations on the default port or 8443", () => {
    expect(checkUrlAgainstPolicy("https://hooks.example.com/prompthash", "webhook_destination")).toMatchObject({
      allowed: true,
      normalizedUrl: "https://hooks.example.com/prompthash",
    });
    expect(code("https://hooks.example.com:8443/x")).toBeUndefined();
  });

  it.each([
    ["http://hooks.example.com/x", "scheme_not_allowed"],
    ["ftp://hooks.example.com/x", "scheme_not_allowed"],
    ["javascript:alert(1)", "scheme_not_allowed"],
    ["https://user:pw@hooks.example.com/x", "credentials_not_allowed"],
    ["https://hooks.example.com:22/x", "port_not_allowed"],
    ["https://127.0.0.1/x", "ip_literal_not_allowed"],
    ["https://169.254.169.254/latest/meta-data", "ip_literal_not_allowed"],
    ["https://2130706433/x", "ip_literal_not_allowed"], // decimal 127.0.0.1
    ["https://0x7f.0.0.1/x", "ip_literal_not_allowed"], // hex octet
    ["https://[::1]/x", "ip_literal_not_allowed"],
    ["https://8.8.8.8/x", "ip_literal_not_allowed"], // public IPs are refused too
    ["https://localhost/x", "host_not_allowed"],
    ["https://api.localhost/x", "host_not_allowed"],
    ["https://metadata.google.internal/x", "host_not_allowed"],
    ["https://printer.local/x", "host_not_allowed"],
    ["https://intranet/x", "host_not_allowed"],
    ["not a url", "url_invalid"],
    ["", "url_invalid"],
    [42, "url_invalid"],
    [`https://hooks.example.com/${"a".repeat(2100)}`, "url_too_long"],
  ])("rejects %s with %s", (url, expected) => {
    expect(code(url)).toBe(expected);
  });

  it("applies the optional operator host allow-list, with subdomain wildcards", () => {
    process.env.WEBHOOK_ALLOWED_HOSTS = "hooks.partner.io, *.example.com";
    expect(code("https://hooks.partner.io/x")).toBeUndefined();
    expect(code("https://a.example.com/x")).toBeUndefined();
    expect(code("https://example.com/x")).toBe("host_not_allowed");
    expect(code("https://evil-example.com/x")).toBe("host_not_allowed");
    expect(hostMatchesAllowList("b.a.example.com", ["*.example.com"])).toBe(true);
  });
});

describe("listing_image policy", () => {
  it("keeps the existing http(s) contract but requires raster image types", () => {
    expect(checkUrlAgainstPolicy("https://cdn.example.com/cover.png", "listing_image").allowed).toBe(true);
    expect(checkUrlAgainstPolicy("http://example.com/img.png", "listing_image").allowed).toBe(true);
    // No extension (IPFS gateways, CDN ids) is allowed; the type is unknown, not wrong.
    expect(checkUrlAgainstPolicy("https://ipfs.io/ipfs/bafybeigdyrzt", "listing_image").allowed).toBe(true);
    expect(checkUrlAgainstPolicy("https://cdn.example.com/x.svg", "listing_image").code).toBe("file_type_not_allowed");
    expect(checkUrlAgainstPolicy("https://cdn.example.com/x.html", "listing_image").code).toBe("file_type_not_allowed");
    expect(
      checkUrlAgainstPolicy("https://cdn.example.com/x.pdf", "listing_image", { expectedKind: "image" }).code,
    ).toBe("file_type_not_allowed");
    expect(checkUrlAgainstPolicy("http://192.168.1.10/cover.png", "listing_image").code).toBe("ip_literal_not_allowed");
  });

  it("is enforced by listing metadata validation", () => {
    const base = { title: "Launch plan", content: "x".repeat(40), price: 1, category: "Marketing" };
    expect(validateListingMetadata({ ...base, image: "https://cdn.example.com/a.png" }).errors.image).toBeUndefined();
    expect(validateListingMetadata({ ...base, image: "https://cdn.example.com/a.svg" }).errors.image).toMatch(/svg/);
    expect(validateListingMetadata({ ...base, image: "http://localhost/a.png" }).errors.image).toBeDefined();
    // Pre-existing message for non-http schemes is unchanged.
    expect(validateListingMetadata({ ...base, image: "ftp://x.com/i.png" }).errors.image).toBe(
      "Image URL must start with http:// or https://.",
    );
  });
});

describe("report_evidence policy", () => {
  it("matches the URL's file type to the declared evidence kind", () => {
    expect(enforceEvidenceUrl("https://imgur.example.com/proof.png", "image").allowed).toBe(true);
    expect(enforceEvidenceUrl("https://docs.example.com/terms.pdf", "pdf").allowed).toBe(true);
    expect(enforceEvidenceUrl("https://docs.example.com/terms.pdf", "image").code).toBe("file_type_mismatch");
    expect(enforceEvidenceUrl("https://blog.example.com/post.html", "link").allowed).toBe(true);
    expect(enforceEvidenceUrl("https://dl.example.com/payload.exe", "pdf").code).toBe("file_type_not_allowed");
    expect(enforceEvidenceUrl("javascript:alert(1)", "link").code).toBe("scheme_not_allowed");
  });
});

describe("dispute_evidence & external_reference destination policies (#1177)", () => {
  it("enforces https, public DNS hosts, and allowed document/image extensions for dispute evidence", () => {
    expect(checkUrlAgainstPolicy("https://evidence.example.com/receipt.pdf", "dispute_evidence").allowed).toBe(true);
    expect(checkUrlAgainstPolicy("https://evidence.example.com/case-123", "dispute_evidence").allowed).toBe(true);
    expect(checkUrlAgainstPolicy("http://evidence.example.com/receipt.pdf", "dispute_evidence").code).toBe(
      "scheme_not_allowed",
    );
    expect(checkUrlAgainstPolicy("https://169.254.169.254/latest", "dispute_evidence").code).toBe(
      "ip_literal_not_allowed",
    );
    expect(checkUrlAgainstPolicy("https://metadata.aws/iam", "dispute_evidence").code).toBe("host_not_allowed");
    expect(checkUrlAgainstPolicy("https://evidence.example.com/payload.exe", "dispute_evidence").code).toBe(
      "file_type_not_allowed",
    );

    // Wired into ownershipTransferDisputes.validateEvidence
    expect(
      validateEvidence({ note: "Valid proof", evidenceUrl: "https://127.0.0.1/receipt.pdf" }, 0),
    ).toMatchObject({ ok: false, status: 400 });
    expect(
      validateEvidence({ note: "<script>alert(1)</script>", evidenceUrl: "https://example.com/receipt.pdf" }, 0),
    ).toMatchObject({ ok: false, status: 400 });
  });

  it("enforces https and operator host allow-lists for external_reference and delivery-time ssrfGuard", () => {
    process.env.EXTERNAL_REFERENCE_ALLOWED_HOSTS = "catalog.partner.io, *.trusted.org";
    expect(checkUrlAgainstPolicy("https://catalog.partner.io/item/42", "external_reference").allowed).toBe(true);
    expect(checkUrlAgainstPolicy("https://sub.trusted.org/item/42", "external_reference").allowed).toBe(true);
    expect(checkUrlAgainstPolicy("https://untrusted.org/item/42", "external_reference").code).toBe("host_not_allowed");

    // Delivery-time ssrfGuard enforces WEBHOOK_ALLOWED_HOSTS and rejects internal DNS hosts
    process.env.WEBHOOK_ALLOWED_HOSTS = "hooks.partner.io";
    expect(() => assertSafeWebhookUrlShape("https://hooks.partner.io/webhook")).not.toThrow();
    expect(() => assertSafeWebhookUrlShape("https://unapproved.example.com/webhook")).toThrow(UnsafeWebhookUrlError);
    expect(() => assertSafeWebhookUrlShape("https://localhost/webhook")).toThrow(UnsafeWebhookUrlError);
  });
});

describe("strict content allow-list policies (#1177)", () => {
  it("allows safe markdown and plain text in prompt_content while rejecting unsafe tags, attributes, URIs, and control bytes", () => {
    expect(
      checkContentAgainstPolicy(
        {
          content: "# Prompt guide\n\nUse **clear** steps and a [reference](https://example.com/docs).",
          contentType: "text/markdown",
        },
        "prompt_content",
      ).allowed,
    ).toBe(true);

    expect(
      checkContentAgainstPolicy(
        { content: "Hello <script>alert(1)</script>", contentType: "text/markdown" },
        "prompt_content",
      ).code,
    ).toBe("content_tag_not_allowed");

    expect(
      checkContentAgainstPolicy(
        { content: '<img src="https://example.com/a.png" onerror="alert(1)">', contentType: "text/markdown" },
        "prompt_content",
      ).code,
    ).toBe("content_tag_not_allowed");

    expect(
      checkContentAgainstPolicy(
        { content: "[Click](javascript:alert(1))", contentType: "text/markdown" },
        "prompt_content",
      ).code,
    ).toBe("content_uri_not_allowed");

    expect(
      checkContentAgainstPolicy(
        { content: "[Obfuscated](&#x6a;avascript:alert(1))", contentType: "text/markdown" },
        "prompt_content",
      ).code,
    ).toBe("content_uri_not_allowed");

    expect(
      checkContentAgainstPolicy(
        { content: "Binary null\u0000byte", contentType: "text/plain" },
        "prompt_content",
      ).code,
    ).toBe("content_encoding_invalid");

    expect(
      checkContentAgainstPolicy(
        { content: "Valid text", contentType: "application/x-sh" },
        "prompt_content",
      ).code,
    ).toBe("content_type_not_allowed");

    // Wired into listing metadata validation
    const base = { title: "Launch plan", image: "https://cdn.example.com/a.png", price: 1, category: "Marketing" };
    expect(
      validateListingMetadata({ ...base, content: "Safe prompt instructions for the marketing launch." }).errors
        .content,
    ).toBeUndefined();
    expect(
      validateListingMetadata({ ...base, content: "Unsafe prompt <script> evil() </script> content" }).errors.content,
    ).toMatch(/script/);
  });

  it("validates webhook_payload and import_manifest content policies", () => {
    expect(
      checkContentAgainstPolicy(
        { content: { event: "PromptPurchased", promptId: "1" }, contentType: "application/json" },
        "webhook_payload",
      ).allowed,
    ).toBe(true);

    expect(
      checkContentAgainstPolicy({ content: "not-json", contentType: "application/json" }, "webhook_payload").code,
    ).toBe("content_structure_invalid");

    expect(
      checkContentAgainstPolicy({ content: '["array-not-object"]', contentType: "application/json" }, "webhook_payload")
        .code,
    ).toBe("content_structure_invalid");

    expect(
      checkContentAgainstPolicy(
        { content: "title,category,price\nLaunch,Marketing,10", contentType: "text/csv" },
        "import_manifest",
      ).allowed,
    ).toBe(true);
  });

  it("supports report mode and runtime overrides for content and destination policies", () => {
    setRuntimeAllowListOverride({
      mode: "report",
      hostAllowLists: { webhook_destination: ["hooks.only.io"] },
      actor: "ops-admin",
      reason: "Rollout verification",
    });

    expect(enforceUrlAllowList("https://other.example.com/hook", "webhook_destination")).toMatchObject({
      allowed: true,
      reportOnly: true,
      code: "host_not_allowed",
    });
    expect(
      enforceContentAllowList({ content: "<script>x</script>", contentType: "text/plain" }, "prompt_content"),
    ).toMatchObject({
      allowed: true,
      reportOnly: true,
      code: "content_tag_not_allowed",
    });

    clearRuntimeAllowListOverride();
    expect(enforceUrlAllowList("https://other.example.com/hook", "webhook_destination").allowed).toBe(true);
  });
});

describe("enforcement mode", () => {
  it("report mode logs but lets violations through, flagged reportOnly", () => {
    process.env.ALLOWLIST_MODE = "report";
    expect(enforceUrlAllowList("http://localhost/x", "webhook_destination")).toMatchObject({
      allowed: true,
      reportOnly: true,
      code: "scheme_not_allowed",
    });
  });

  it("anything other than 'report' enforces (fail closed on typos)", () => {
    process.env.ALLOWLIST_MODE = "reprot";
    expect(enforceUrlAllowList("http://localhost/x", "webhook_destination").allowed).toBe(false);
  });
});

describe("file type allow-list", () => {
  const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const PDF = new Uint8Array([...Buffer.from("%PDF-1.7\n")]);
  const SVG = new Uint8Array([...Buffer.from('<svg xmlns="http://www.w3.org/2000/svg">')]);
  const WEBP = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WEBPVP8 ")]);
  const WAV = new Uint8Array([...Buffer.from("RIFF"), 0, 0, 0, 0, ...Buffer.from("WAVEfmt ")]);

  it("sniffs allow-listed binary kinds from magic bytes", () => {
    expect(sniffFileKind(PNG)).toBe("image");
    expect(sniffFileKind(PDF)).toBe("pdf");
    expect(sniffFileKind(WEBP)).toBe("image");
    expect(sniffFileKind(WAV)).toBeNull();
    expect(sniffFileKind(SVG)).toBeNull();
  });

  it("requires extension, MIME type and content to agree", () => {
    expect(checkFileType({ kind: "image", filename: "a.png", contentType: "image/png", bytes: PNG }).allowed).toBe(true);
    expect(checkFileType({ kind: "image", filename: "a.svg" }).code).toBe("file_type_not_allowed");
    expect(checkFileType({ kind: "image", contentType: "image/svg+xml" }).code).toBe("file_type_not_allowed");
    expect(checkFileType({ kind: "image", filename: "a.png", contentType: "image/png", bytes: SVG }).code).toBe(
      "file_type_mismatch",
    );
    expect(checkFileType({ kind: "pdf", filename: "a.pdf", contentType: "application/pdf; charset=binary", bytes: PDF }).allowed).toBe(true);
    expect(checkFileType({ kind: "json", filename: "import.json", contentType: "application/json" }).allowed).toBe(true);
  });
});

describe("HTTP paths", () => {
  let dbReady = false;
  let http: HttpTestServer;

  beforeAll(async () => {
    dbReady = await setupRealMongo();
    // Build the unique (scope, key) index before the first request so the
    // idempotency gate is in force from the start.
    if (dbReady) await IdempotencyRecord.init();
    http = await startHttpServer((app) => {
      app.use("/api/webhooks", webhookRouter);
      app.use("/api/admin/allow-list", allowListRouter);
    });
  });
  afterAll(async () => {
    await http?.close();
    await teardownRealMongo();
  });
  beforeEach(async () => {
    if (dbReady) await resetRealMongo();
  });

  const WALLET = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const register = (url: string, key: string) =>
    jsonCall(http.baseUrl, "/api/webhooks", {
      method: "POST",
      headers: { "idempotency-key": key },
      body: JSON.stringify({ walletAddress: WALLET, url }),
    });

  it("failure + retry path: an internal destination is never stored; a corrected retry succeeds", async () => {
    if (!dbReady) return;

    const rejected = await register("https://169.254.169.254/latest", "reg-attempt-0001");
    expect(rejected.status).toBe(400);
    expect(rejected.body.code).toBe("ip_literal_not_allowed");
    expect(await WebhookSubscription.countDocuments()).toBe(0);

    // Replaying the same key + body returns the same deterministic rejection.
    const replay = await register("https://169.254.169.254/latest", "reg-attempt-0001");
    expect(replay.status).toBe(400);
    expect(replay.headers.get("idempotent-replayed")).toBe("true");

    // The corrected request is a new request: new key, new body.
    const accepted = await register("https://hooks.example.com/prompthash", "reg-attempt-0002");
    expect(accepted.status).toBe(201);
    expect(await WebhookSubscription.countDocuments()).toBe(1);
  });

  it("authorization path: policy inspection and dry runs require allowlist:read", async () => {
    expect((await jsonCall(http.baseUrl, "/api/admin/allow-list")).status).toBe(401);
    expect(
      (await jsonCall(http.baseUrl, "/api/admin/allow-list", { headers: { "x-test-admin": "flags:read" } })).status,
    ).toBe(401);

    const admin = { "x-test-admin": "allowlist:read" };
    const view = await jsonCall(http.baseUrl, "/api/admin/allow-list", { headers: admin });
    expect(view.status).toBe(200);
    expect(view.body.mode).toBe("enforce");
    expect(view.body.urlPolicies.webhook_destination.schemes).toEqual(["https"]);

    const dryRun = await jsonCall(http.baseUrl, "/api/admin/allow-list/check", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ policy: "webhook_destination", url: "https://localhost/x" }),
    });
    expect(dryRun.body).toMatchObject({ allowed: false, code: "host_not_allowed" });

    const fileCheck = await jsonCall(http.baseUrl, "/api/admin/allow-list/check", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        file: { kind: "image", filename: "a.png", base64Prefix: Buffer.from("<svg>").toString("base64") },
      }),
    });
    expect(fileCheck.body).toMatchObject({ allowed: false, code: "file_type_mismatch" });

    const badPolicy = await jsonCall(http.baseUrl, "/api/admin/allow-list/check", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({ policy: "everything", url: "https://x.example.com" }),
    });
    expect(badPolicy.status).toBe(400);

    const contentCheck = await jsonCall(http.baseUrl, "/api/admin/allow-list/check", {
      method: "POST",
      headers: admin,
      body: JSON.stringify({
        content: { policy: "prompt_content", contentType: "text/markdown", value: "<iframe src='https://evil.test'>" },
      }),
    });
    expect(contentCheck.body).toMatchObject({ allowed: false, code: "content_tag_not_allowed" });
  });

  it("authorization + rollback path: runtime overrides require allowlist:write and can be rolled back cleanly", async () => {
    const readOnly = { "x-test-admin": "allowlist:read" };
    const writeAdmin = { "x-test-admin": "allowlist:read,allowlist:write" };

    // Read-only admin cannot mutate overrides
    const deniedPut = await jsonCall(http.baseUrl, "/api/admin/allow-list/override", {
      method: "PUT",
      headers: readOnly,
      body: JSON.stringify({ mode: "report", reason: "Emergency rollback" }),
    });
    expect(deniedPut.status).toBe(401);

    // Missing reason is rejected with 400
    const missingReason = await jsonCall(http.baseUrl, "/api/admin/allow-list/override", {
      method: "PUT",
      headers: writeAdmin,
      body: JSON.stringify({ mode: "report", reason: "" }),
    });
    expect(missingReason.status).toBe(400);

    // Apply runtime host allow-list override
    const applied = await jsonCall(http.baseUrl, "/api/admin/allow-list/override", {
      method: "PUT",
      headers: writeAdmin,
      body: JSON.stringify({
        mode: "enforce",
        hostAllowLists: { webhook_destination: ["hooks.approved.io"] },
        reason: "Restrict webhook destinations during incident #1177",
      }),
    });
    expect(applied.status).toBe(200);
    expect(applied.body.urlPolicies.webhook_destination.hostAllowList).toEqual(["hooks.approved.io"]);

    // Dry-run reflects the active runtime override
    const blockedHost = await jsonCall(http.baseUrl, "/api/admin/allow-list/check", {
      method: "POST",
      headers: readOnly,
      body: JSON.stringify({ policy: "webhook_destination", url: "https://hooks.other.io/x" }),
    });
    expect(blockedHost.body).toMatchObject({ allowed: false, code: "host_not_allowed" });

    // Roll back override via DELETE
    const rolledBack = await jsonCall(http.baseUrl, "/api/admin/allow-list/override", {
      method: "DELETE",
      headers: writeAdmin,
      body: JSON.stringify({ reason: "Incident resolved" }),
    });
    expect(rolledBack.status).toBe(200);
    expect(rolledBack.body.urlPolicies.webhook_destination.hostAllowList).toEqual([]);
  });
});
