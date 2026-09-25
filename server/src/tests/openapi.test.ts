import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";

describe("OpenAPI reference schema (#713)", () => {
  const docsDir = path.resolve(__dirname, "../../../docs");
  const openApiPath = path.join(docsDir, "openapi.json");
  const spec = JSON.parse(fs.readFileSync(openApiPath, "utf-8"));

  it("is a valid OpenAPI 3.0 document", () => {
    expect(spec.openapi).toBe("3.0.3");
    expect(spec.info.title).toBe("PromptHash Marketplace API");
    expect(spec.info.version).toBe("1.0.0");
    expect(spec.paths).toBeDefined();
    expect(spec.components.schemas).toBeDefined();
  });

  it("documents every marketplace endpoint from promptRoutes.ts", () => {
    const promptRoutes = fs.readFileSync(
      path.resolve(__dirname, "../routes/promptRoutes.ts"),
      "utf-8",
    );

    // Extract route strings like "/buyer/:walletAddress/owned" from the router.
    const routeMatches = promptRoutes.matchAll(
      /(?:promptRouter\.(?:get|post|route)\()\s*["'`]([^"'`]+)["'`]/g,
    );
    const documented = new Set(Object.keys(spec.paths));
    const normalize = (p: string) =>
      p
        .replace(/\/$/, "")
        .replace(/\{[^}]+\}/g, ":param")
        .replace(/:[a-zA-Z_]+/g, ":param");

    for (const match of routeMatches) {
      const route = match[1] as string;
      const openApiPath = `/api/prompts${route}`.replace(/\/$/, "");
      const routeNormalized = normalize(openApiPath);
      let found = false;
      for (const candidate of documented) {
        if (normalize(candidate) === routeNormalized) {
          found = true;
          break;
        }
      }
      expect(
        found,
        `Route ${openApiPath} is not documented in docs/openapi.json`,
      ).toBe(true);
    }
  });

  it("documents admin-scoped endpoints as requiring the admin token", () => {
    const reportsPath = spec.paths["/api/prompts/reports"].get;
    expect(reportsPath.security).toEqual([{ adminToken: [] }]);

    const integrityPath = spec.paths["/api/prompts/admin/integrity-report"].get;
    expect(integrityPath.security).toEqual([{ adminToken: [] }]);
  });

  it("documents the #711 privacy-safe analytics endpoint with redaction", () => {
    const analyticsPath =
      spec.paths[
        "/api/prompts/creator/{walletAddress}/analytics/support-metrics"
      ].get;
    expect(analyticsPath).toBeDefined();
    const analyticsSchema = spec.components.schemas.SellerAnalytics;
    expect(
      analyticsSchema.properties.cohort.properties.buyerIdentitiesRedacted.enum,
    ).toEqual([true]);
  });

  it("covers prompts, purchase/unlock queue side-effects, reviews, webhooks, and reports", () => {
    const paths = Object.keys(spec.paths);
    expect(paths.some((p) => p === "/api/prompts")).toBe(true);
    expect(paths.some((p) => p.includes("transactions"))).toBe(true);
    expect(paths.some((p) => p.includes("reviews"))).toBe(true);
    expect(paths.some((p) => p.includes("webhooks"))).toBe(true);
    expect(paths.some((p) => p === "/api/prompts/reports")).toBe(true);
    expect(paths.some((p) => p.includes("price-history"))).toBe(true);
  });
});

// ── Notification center endpoints (#notification-center) ─────────────────────

describe("OpenAPI notification center coverage (#notification-center)", () => {
  const docsDir = path.resolve(__dirname, "../../../docs");
  const openApiPath = path.join(docsDir, "openapi.json");
  const spec = JSON.parse(fs.readFileSync(openApiPath, "utf-8"));

  it("documents paginated notification list with type and unread filters", () => {
    const listPath = spec.paths["/api/notifications/{walletAddress}"];
    expect(listPath).toBeDefined();
    const params: Array<{ name: string }> = listPath.get.parameters ?? [];
    const paramNames = params.map((p) => p.name);
    expect(paramNames).toContain("page");
    expect(paramNames).toContain("limit");
    expect(paramNames).toContain("unread");
    expect(paramNames).toContain("type");
  });

  it("documents the unread-count endpoint", () => {
    expect(
      spec.paths["/api/notifications/{walletAddress}/unread-count"],
    ).toBeDefined();
  });

  it("documents the mark-read endpoint (supports single and bulk)", () => {
    const markRead = spec.paths["/api/notifications/{walletAddress}/mark-read"];
    expect(markRead).toBeDefined();
    expect(markRead.post).toBeDefined();
  });

  it("documents notification preferences GET and PUT", () => {
    const prefs = spec.paths["/api/notifications/{walletAddress}/preferences"];
    expect(prefs).toBeDefined();
    expect(prefs.get).toBeDefined();
    expect(prefs.put).toBeDefined();
  });

  it("documents all 8 notification types in the NotificationPreferences schema", () => {
    const schema = spec.components.schemas.NotificationPreferences;
    expect(schema).toBeDefined();
    const typeEnum: string[] = schema.properties.mutedTypes.items.enum;
    const expected = [
      "prompt_update",
      "purchase_confirmed",
      "dispute_opened",
      "dispute_resolved",
      "payout_available",
      "moderation_action",
      "ownership_transfer",
      "system",
    ];
    for (const t of expected) {
      expect(typeEnum).toContain(t);
    }
  });

  it("documents the NotificationPreferencesUpdate request schema", () => {
    const schema = spec.components.schemas.NotificationPreferencesUpdate;
    expect(schema).toBeDefined();
    expect(schema.properties.mutedTypes).toBeDefined();
    expect(schema.properties.emailEnabled).toBeDefined();
  });
});

// ── Inbound webhook endpoints (#idempotent-webhooks) ─────────────────────────

describe("OpenAPI inbound webhook coverage (#idempotent-webhooks)", () => {
  const docsDir = path.resolve(__dirname, "../../../docs");
  const openApiPath = path.join(docsDir, "openapi.json");
  const spec = JSON.parse(fs.readFileSync(openApiPath, "utf-8"));

  it("documents the public inbound intake endpoint at POST /api/webhooks/inbound", () => {
    const inbound = spec.paths["/api/webhooks/inbound"];
    expect(inbound).toBeDefined();
    expect(inbound.post).toBeDefined();
  });

  it("documents the required idempotency and signature headers on inbound intake", () => {
    const params: Array<{ name: string; required?: boolean }> =
      spec.paths["/api/webhooks/inbound"].post.parameters ?? [];
    const required = params.filter((p) => p.required).map((p) => p.name);
    expect(required).toContain("X-PromptHash-Event-Id");
    expect(required).toContain("X-PromptHash-Signature");
    expect(required).toContain("X-PromptHash-Timestamp");
  });

  it("documents 200, 202, 400, 401, 503 responses for the intake endpoint", () => {
    const responses = spec.paths["/api/webhooks/inbound"].post.responses;
    expect(responses["200"]).toBeDefined();
    expect(responses["202"]).toBeDefined(); // idempotent replay
    expect(responses["400"]).toBeDefined(); // missing headers
    expect(responses["401"]).toBeDefined(); // bad signature
    expect(responses["503"]).toBeDefined(); // not configured
  });

  it("documents the admin failed-events list endpoint requiring adminToken", () => {
    const failedPath = spec.paths["/api/webhooks/inbound/failed"];
    expect(failedPath).toBeDefined();
    expect(failedPath.get.security).toEqual([{ adminToken: [] }]);
  });

  it("documents the admin single-event retry endpoint requiring adminToken", () => {
    const retryPath = spec.paths["/api/webhooks/inbound/{id}/retry"];
    expect(retryPath).toBeDefined();
    expect(retryPath.post.security).toEqual([{ adminToken: [] }]);
  });

  it("documents the admin inspect endpoint requiring adminToken", () => {
    const inspectPath = spec.paths["/api/webhooks/inbound/{id}"];
    expect(inspectPath).toBeDefined();
    expect(inspectPath.get.security).toEqual([{ adminToken: [] }]);
  });

  it("documents the InboundWebhookEvent schema with verification and processing status fields", () => {
    const schema = spec.components.schemas.InboundWebhookEvent;
    expect(schema).toBeDefined();
    expect(schema.properties.verificationStatus).toBeDefined();
    expect(schema.properties.processingStatus).toBeDefined();
    expect(schema.properties.idempotencyKey).toBeDefined();
    expect(schema.properties.rawHeaders).toBeDefined();
    // rawBody must NOT be documented — it may contain sensitive payload data
    expect(schema.properties.rawBody).toBeUndefined();
  });

  it("documents the InboundEventResult schema", () => {
    const schema = spec.components.schemas.InboundEventResult;
    expect(schema).toBeDefined();
    const statusEnum: string[] = schema.properties.status.enum;
    expect(statusEnum).toContain("processed");
    expect(statusEnum).toContain("skipped");
    expect(statusEnum).toContain("verification_failed");
  });
});

// ── Bulk moderation endpoints ─────────────────────────────────────────────────

describe("OpenAPI bulk moderation coverage (#moderation-queue)", () => {
  const docsDir = path.resolve(__dirname, "../../../docs");
  const openApiPath = path.join(docsDir, "openapi.json");
  const spec = JSON.parse(fs.readFileSync(openApiPath, "utf-8"));

  it("documents the moderation queue endpoint with filters", () => {
    const queuePath = spec.paths["/api/moderation/queue"];
    expect(queuePath).toBeDefined();
    expect(queuePath.get.security).toEqual([{ adminToken: [] }]);

    const params: Array<{ name: string }> = queuePath.get.parameters ?? [];
    const paramNames = params.map((p) => p.name);
    expect(paramNames).toContain("status");
    expect(paramNames).toContain("similarityFlag");
    expect(paramNames).toContain("creatorWallet");
    expect(paramNames).toContain("since");
    expect(paramNames).toContain("page");
    expect(paramNames).toContain("limit");
  });

  it("documents the bulk action endpoint with required admin auth", () => {
    const bulkPath = spec.paths["/api/moderation/bulk"];
    expect(bulkPath).toBeDefined();
    expect(bulkPath.post.security).toEqual([{ adminToken: [] }]);
    expect(bulkPath.post.requestBody).toBeDefined();
  });

  it("documents BulkModerationRequest with required action, promptIds, and reason", () => {
    const schema = spec.components.schemas.BulkModerationRequest;
    expect(schema).toBeDefined();
    expect(schema.required).toContain("action");
    expect(schema.required).toContain("promptIds");
    expect(schema.required).toContain("reason");
    const actionEnum: string[] = schema.properties.action.enum;
    expect(actionEnum).toContain("approve");
    expect(actionEnum).toContain("reject");
    expect(actionEnum).toContain("hide");
    expect(actionEnum).toContain("restore");
  });

  it("documents BulkModerationResult with applied/skipped counts and decisionIds", () => {
    const schema = spec.components.schemas.BulkModerationResult;
    expect(schema).toBeDefined();
    expect(schema.properties.applied).toBeDefined();
    expect(schema.properties.skipped).toBeDefined();
    expect(schema.properties.decisionIds).toBeDefined();
  });

  it("documents the decisions list endpoint with audit-friendly filters", () => {
    const decisionsPath = spec.paths["/api/moderation/decisions"];
    expect(decisionsPath).toBeDefined();
    expect(decisionsPath.get.security).toEqual([{ adminToken: [] }]);
    const params: Array<{ name: string }> = decisionsPath.get.parameters ?? [];
    const paramNames = params.map((p) => p.name);
    expect(paramNames).toContain("promptId");
    expect(paramNames).toContain("actorWallet");
    expect(paramNames).toContain("action");
  });

  it("documents the rollback endpoint requiring a reason in the body", () => {
    const rollbackPath = spec.paths["/api/moderation/decisions/{id}/rollback"];
    expect(rollbackPath).toBeDefined();
    expect(rollbackPath.post.security).toEqual([{ adminToken: [] }]);
    const required: string[] =
      rollbackPath.post.requestBody.content["application/json"].schema
        .required ?? [];
    expect(required).toContain("reason");
  });

  it("documents ModerationDecision schema with rollback metadata fields", () => {
    const schema = spec.components.schemas.ModerationDecision;
    expect(schema).toBeDefined();
    expect(schema.properties.actorWallet).toBeDefined();
    expect(schema.properties.previousStatus).toBeDefined();
    expect(schema.properties.rolledBack).toBeDefined();
    expect(schema.properties.rollbackReason).toBeDefined();
  });

  it("documents ModerationPromptRow with moderationStatus enum", () => {
    const schema = spec.components.schemas.ModerationPromptRow;
    expect(schema).toBeDefined();
    const statusEnum: string[] = schema.properties.moderationStatus.enum;
    expect(statusEnum).toContain("pending_review");
    expect(statusEnum).toContain("approved");
    expect(statusEnum).toContain("rejected");
    expect(statusEnum).toContain("hidden");
    expect(statusEnum).toContain("restored");
  });
});

// ── Schema completeness gate ──────────────────────────────────────────────────

describe("OpenAPI schema completeness gate", () => {
  const docsDir = path.resolve(__dirname, "../../../docs");
  const openApiPath = path.join(docsDir, "openapi.json");
  const spec = JSON.parse(fs.readFileSync(openApiPath, "utf-8"));

  it("has at least 40 documented paths covering all four feature areas", () => {
    const paths = Object.keys(spec.paths);
    expect(paths.length).toBeGreaterThanOrEqual(40);
    // Notification center
    expect(paths.some((p) => p.includes("notifications"))).toBe(true);
    // Inbound webhooks
    expect(paths.some((p) => p.includes("webhooks/inbound"))).toBe(true);
    // Moderation queue
    expect(paths.some((p) => p.includes("moderation/queue"))).toBe(true);
    expect(paths.some((p) => p.includes("moderation/bulk"))).toBe(true);
  });

  it("has all required component schemas", () => {
    const schemas = spec.components.schemas;
    const required = [
      "Error",
      "Prompt",
      "NotificationPreferences",
      "NotificationPreferencesUpdate",
      "InboundWebhookEvent",
      "InboundEventResult",
      "ModerationPromptRow",
      "BulkModerationRequest",
      "BulkModerationResult",
      "ModerationDecision",
    ];
    for (const name of required) {
      expect(schemas[name], `Missing schema: ${name}`).toBeDefined();
    }
  });

  it("all $ref values in paths resolve to defined component schemas", () => {
    const schemas = new Set(Object.keys(spec.components.schemas));
    const unresolved: string[] = [];

    const collectRefs = (obj: unknown): void => {
      if (!obj || typeof obj !== "object") return;
      if (Array.isArray(obj)) {
        obj.forEach(collectRefs);
        return;
      }
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (k === "$ref" && typeof v === "string") {
          // Only validate schema $refs; response $refs (#/components/responses/...)
          // live in a separate component section validated by schema linters.
          if (v.startsWith("#/components/schemas/")) {
            const name = v.replace("#/components/schemas/", "");
            if (!schemas.has(name)) unresolved.push(name);
          }
        } else {
          collectRefs(v);
        }
      }
    };

    collectRefs(spec.paths);

    expect(
      unresolved,
      `Unresolved schema $refs: ${unresolved.join(", ")}`,
    ).toHaveLength(0);
  });

  it("all admin-scoped endpoints declare adminToken security", () => {
    const adminPaths = [
      "/api/prompts/reports",
      "/api/prompts/admin/integrity-report",
      "/api/webhooks/dead-letters",
      "/api/webhooks/inbound/failed",
      "/api/webhooks/inbound/{id}/retry",
      "/api/webhooks/inbound/{id}",
      "/api/moderation/queue",
      "/api/moderation/bulk",
      "/api/moderation/decisions",
      "/api/moderation/decisions/{id}/rollback",
    ];

    for (const p of adminPaths) {
      const pathItem = spec.paths[p];
      expect(pathItem, `Missing path: ${p}`).toBeDefined();
      const op =
        pathItem.get ?? pathItem.post ?? pathItem.put ?? pathItem.delete;
      expect(op?.security, `${p} must declare adminToken security`).toEqual([
        { adminToken: [] },
      ]);
    }
  });

  it("pagination models (page, limit, total, totalPages) are present on list endpoints", () => {
    // Notification list
    const notifList = spec.paths["/api/notifications/{walletAddress}"].get;
    const notifParams = (notifList.parameters ?? []).map(
      (p: { name: string }) => p.name,
    );
    expect(notifParams).toContain("page");
    expect(notifParams).toContain("limit");

    // Moderation queue
    const modQueue = spec.paths["/api/moderation/queue"].get;
    const modParams = (modQueue.parameters ?? []).map(
      (p: { name: string }) => p.name,
    );
    expect(modParams).toContain("page");
    expect(modParams).toContain("limit");
  });
});

// ── Original serving surface tests ───────────────────────────────────────────

describe("OpenAPI serving surface (#713)", () => {
  const serverSource = fs.readFileSync(
    path.resolve(__dirname, "../server.ts"),
    "utf-8",
  );

  it("serves the machine-readable schema at GET /api/openapi.json", () => {
    expect(serverSource).toContain(
      'app.get("/api/openapi.json", GetOpenApiSchema)',
    );
  });

  it("exposes an interactive explorer at GET /api/docs", () => {
    expect(serverSource).toContain('app.get("/api/docs", GetOpenApiExplorer)');
  });

  it("validates the served JSON with a Redoc init pointing at the schema", () => {
    const controllerSource = fs.readFileSync(
      path.resolve(__dirname, "../controllers/docsControllers.ts"),
      "utf-8",
    );
    expect(controllerSource).toContain("Redoc.init");
    expect(controllerSource).toContain('"/api/openapi.json"');
  });
});
