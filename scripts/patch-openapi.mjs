import { readFileSync, writeFileSync } from "fs";

const spec = JSON.parse(readFileSync("docs/openapi.json", "utf-8"));

// ── New tags ──────────────────────────────────────────────────────────────
const newTags = [
  { name: "Moderation", description: "Bulk moderation queue — filters, bulk actions, audit records" },
  { name: "Inbound Webhooks", description: "Durable idempotent inbound webhook intake and admin retry tooling" },
];
for (const t of newTags) {
  if (!spec.tags.find((x) => x.name === t.name)) spec.tags.push(t);
}

// ── Notification: preferences endpoints ──────────────────────────────────
spec.paths["/api/notifications/{walletAddress}/preferences"] = {
  get: {
    tags: ["Notifications"],
    summary: "Get notification preferences",
    operationId: "getNotificationPreferences",
    parameters: [{ name: "walletAddress", in: "path", required: true, schema: { type: "string" } }],
    responses: {
      "200": { description: "Preferences document", content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationPreferences" } } } },
      "500": { $ref: "#/components/responses/ServerError" },
    },
  },
  put: {
    tags: ["Notifications"],
    summary: "Update notification preferences",
    operationId: "updateNotificationPreferences",
    parameters: [{ name: "walletAddress", in: "path", required: true, schema: { type: "string" } }],
    requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationPreferencesUpdate" } } } },
    responses: {
      "200": { description: "Updated preferences", content: { "application/json": { schema: { $ref: "#/components/schemas/NotificationPreferences" } } } },
      "400": { description: "No valid preference fields provided", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      "500": { $ref: "#/components/responses/ServerError" },
    },
  },
};

// Update existing GET /notifications/{walletAddress} to document pagination
spec.paths["/api/notifications/{walletAddress}"].get.parameters = [
  { name: "walletAddress", in: "path", required: true, schema: { type: "string" } },
  { name: "page", in: "query", schema: { type: "integer", default: 1 } },
  { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 50 } },
  { name: "unread", in: "query", schema: { type: "boolean" }, description: "Filter to unread only" },
  { name: "type", in: "query", schema: { type: "string" }, description: "Filter by notification type" },
];

// ── Inbound webhook endpoints ─────────────────────────────────────────────
spec.paths["/api/webhooks/inbound"] = {
  post: {
    tags: ["Inbound Webhooks"],
    summary: "Receive inbound webhook event",
    description:
      "Accepts raw webhook deliveries from external sources. Verifies HMAC-SHA256 signature before processing. Idempotent — duplicate X-PromptHash-Event-Id values return 202 without reprocessing.",
    operationId: "receiveInboundWebhook",
    parameters: [
      { name: "X-PromptHash-Event-Id", in: "header", required: true, schema: { type: "string" }, description: "Stable idempotency key for this event" },
      { name: "X-PromptHash-Signature", in: "header", required: true, schema: { type: "string" }, description: "HMAC-SHA256 signature (sha256=<hex>)" },
      { name: "X-PromptHash-Timestamp", in: "header", required: true, schema: { type: "string", format: "date-time" } },
      { name: "X-PromptHash-Event", in: "header", schema: { type: "string" }, description: "Event type label" },
      { name: "X-PromptHash-Delivery", in: "header", schema: { type: "string" } },
    ],
    requestBody: { required: true, content: { "application/json": { schema: { type: "object" } } } },
    responses: {
      "200": { description: "Event received and processed", content: { "application/json": { schema: { $ref: "#/components/schemas/InboundEventResult" } } } },
      "202": { description: "Event already processed (idempotent replay)", content: { "application/json": { schema: { $ref: "#/components/schemas/InboundEventResult" } } } },
      "400": { description: "Missing required headers", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      "401": { description: "HMAC signature verification failed", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      "503": { description: "Inbound webhook intake is not configured", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
    },
  },
};

spec.paths["/api/webhooks/inbound/failed"] = {
  get: {
    tags: ["Inbound Webhooks"],
    summary: "List failed inbound events (admin)",
    operationId: "listFailedInboundEvents",
    security: [{ adminToken: [] }],
    parameters: [
      { name: "source", in: "query", schema: { type: "string" } },
      { name: "eventType", in: "query", schema: { type: "string" } },
      { name: "limit", in: "query", schema: { type: "integer", default: 50, maximum: 200 } },
      { name: "skip", in: "query", schema: { type: "integer", default: 0 } },
    ],
    responses: {
      "200": {
        description: "Paginated failed events",
        content: { "application/json": { schema: { type: "object", properties: { events: { type: "array", items: { $ref: "#/components/schemas/InboundWebhookEvent" } }, total: { type: "integer" } } } } },
      },
      "500": { $ref: "#/components/responses/ServerError" },
    },
  },
};

spec.paths["/api/webhooks/inbound/{id}/retry"] = {
  post: {
    tags: ["Inbound Webhooks"],
    summary: "Retry a failed inbound event (admin)",
    description: "Resets a failed event to pending for reprocessing. Signature is NOT re-checked — only business logic reruns.",
    operationId: "retryFailedInboundEvent",
    security: [{ adminToken: [] }],
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    responses: {
      "200": { description: "Event reset to pending for reprocessing" },
      "404": { description: "Not found or not in failed state", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      "500": { $ref: "#/components/responses/ServerError" },
    },
  },
};

spec.paths["/api/webhooks/inbound/{id}"] = {
  get: {
    tags: ["Inbound Webhooks"],
    summary: "Inspect an inbound event record (admin)",
    operationId: "getInboundEvent",
    security: [{ adminToken: [] }],
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    responses: {
      "200": { description: "Inbound event document", content: { "application/json": { schema: { $ref: "#/components/schemas/InboundWebhookEvent" } } } },
      "404": { description: "Not found", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      "500": { $ref: "#/components/responses/ServerError" },
    },
  },
};

// ── Bulk moderation endpoints ─────────────────────────────────────────────
spec.paths["/api/moderation/queue"] = {
  get: {
    tags: ["Moderation"],
    summary: "Get moderation queue (admin)",
    description: "Returns filtered, paginated prompts for moderation review. Supports filtering by moderationStatus, similarityFlag, creatorWallet, and date range. Stale-query protection: all filters are applied server-side at query time.",
    operationId: "getModerationQueue",
    security: [{ adminToken: [] }],
    parameters: [
      { name: "status", in: "query", schema: { type: "string", enum: ["pending_review", "approved", "rejected", "hidden", "restored"] } },
      { name: "similarityFlag", in: "query", schema: { type: "string", enum: ["clean", "suspicious", "highly_similar"] } },
      { name: "creatorWallet", in: "query", schema: { type: "string" } },
      { name: "reason", in: "query", schema: { type: "string" } },
      { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
      { name: "until", in: "query", schema: { type: "string", format: "date-time" } },
      { name: "page", in: "query", schema: { type: "integer", default: 1 } },
      { name: "limit", in: "query", schema: { type: "integer", default: 20, maximum: 100 } },
    ],
    responses: {
      "200": {
        description: "Moderation queue page",
        content: { "application/json": { schema: { type: "object", properties: { prompts: { type: "array", items: { $ref: "#/components/schemas/ModerationPromptRow" } }, page: { type: "integer" }, total: { type: "integer" }, totalPages: { type: "integer" } } } } },
      },
      "500": { $ref: "#/components/responses/ServerError" },
    },
  },
};

spec.paths["/api/moderation/bulk"] = {
  post: {
    tags: ["Moderation"],
    summary: "Bulk moderation action (admin)",
    description:
      "Applies approve, reject, hide, or restore to a batch of selected prompts. Only eligible prompts (matching expected current state) are acted upon — ineligible ones are counted as skipped. Every decision is recorded in ModerationDecision with actor, reason, and timestamp. Rolls back by reversing the moderationStatus via /decisions/{id}/rollback.",
    operationId: "bulkModerationAction",
    security: [{ adminToken: [] }],
    requestBody: { required: true, content: { "application/json": { schema: { $ref: "#/components/schemas/BulkModerationRequest" } } } },
    responses: {
      "200": { description: "Bulk action result", content: { "application/json": { schema: { $ref: "#/components/schemas/BulkModerationResult" } } } },
      "400": { description: "Validation error — missing or invalid fields", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      "500": { $ref: "#/components/responses/ServerError" },
    },
  },
};

spec.paths["/api/moderation/decisions"] = {
  get: {
    tags: ["Moderation"],
    summary: "List moderation decisions (admin)",
    operationId: "listModerationDecisions",
    security: [{ adminToken: [] }],
    parameters: [
      { name: "promptId", in: "query", schema: { type: "string" } },
      { name: "actorWallet", in: "query", schema: { type: "string" } },
      { name: "action", in: "query", schema: { type: "string", enum: ["approve", "reject", "hide", "restore"] } },
      { name: "since", in: "query", schema: { type: "string", format: "date-time" } },
      { name: "limit", in: "query", schema: { type: "integer", default: 50 } },
    ],
    responses: {
      "200": { description: "Decision records", content: { "application/json": { schema: { type: "array", items: { $ref: "#/components/schemas/ModerationDecision" } } } } },
      "500": { $ref: "#/components/responses/ServerError" },
    },
  },
};

spec.paths["/api/moderation/decisions/{id}/rollback"] = {
  post: {
    tags: ["Moderation"],
    summary: "Rollback a moderation decision (admin)",
    description: "Reverses a previous decision by restoring the prompt's prior moderationStatus and recording a rollback audit entry.",
    operationId: "rollbackModerationDecision",
    security: [{ adminToken: [] }],
    parameters: [{ name: "id", in: "path", required: true, schema: { type: "string" } }],
    requestBody: { required: true, content: { "application/json": { schema: { type: "object", required: ["reason"], properties: { reason: { type: "string", minLength: 1 } } } } } },
    responses: {
      "200": { description: "Decision rolled back successfully" },
      "400": { description: "Validation error", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      "404": { description: "Decision not found or already rolled back", content: { "application/json": { schema: { $ref: "#/components/schemas/Error" } } } },
      "500": { $ref: "#/components/responses/ServerError" },
    },
  },
};

// ── New component schemas ─────────────────────────────────────────────────
const newSchemas = {
  NotificationPreferences: {
    type: "object",
    properties: {
      walletAddress: { type: "string" },
      mutedTypes: { type: "array", items: { type: "string", enum: ["prompt_update", "purchase_confirmed", "dispute_opened", "dispute_resolved", "payout_available", "moderation_action", "ownership_transfer", "system"] } },
      emailEnabled: { type: "boolean" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  NotificationPreferencesUpdate: {
    type: "object",
    properties: {
      mutedTypes: { type: "array", items: { type: "string" } },
      emailEnabled: { type: "boolean" },
    },
  },
  InboundEventResult: {
    type: "object",
    properties: {
      message: { type: "string" },
      eventId: { type: "string" },
      status: { type: "string", enum: ["processed", "skipped", "failed", "verification_failed"] },
      alreadyProcessed: { type: "boolean" },
    },
  },
  InboundWebhookEvent: {
    type: "object",
    properties: {
      _id: { type: "string" },
      idempotencyKey: { type: "string" },
      eventType: { type: "string" },
      source: { type: "string" },
      verificationStatus: { type: "string", enum: ["pending", "verified", "verification_failed"] },
      processingStatus: { type: "string", enum: ["pending", "processing", "processed", "failed", "skipped"] },
      rawHeaders: { type: "object", description: "Non-sensitive request headers retained for debugging" },
      errorMessage: { type: "string", nullable: true },
      attemptCount: { type: "integer" },
      lastAttemptAt: { type: "string", format: "date-time", nullable: true },
      processedAt: { type: "string", format: "date-time", nullable: true },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
    },
  },
  ModerationPromptRow: {
    type: "object",
    properties: {
      _id: { type: "string" },
      onChainId: { type: "string", nullable: true },
      title: { type: "string" },
      moderationStatus: { type: "string", enum: ["pending_review", "approved", "rejected", "hidden", "restored"] },
      isActive: { type: "boolean" },
      similarityFlag: { type: "string", enum: ["clean", "suspicious", "highly_similar"] },
      integrityStatus: { type: "string" },
      createdAt: { type: "string", format: "date-time" },
    },
  },
  BulkModerationRequest: {
    type: "object",
    required: ["action", "promptIds", "reason"],
    properties: {
      action: { type: "string", enum: ["approve", "reject", "hide", "restore"], description: "Action to apply to all selected prompts" },
      promptIds: { type: "array", items: { type: "string" }, minItems: 1, maxItems: 100, description: "MongoDB _id values of the prompts to act on" },
      reason: { type: "string", minLength: 1, maxLength: 500 },
      evidenceNote: { type: "string", maxLength: 1000, description: "Optional supporting evidence note stored with each decision" },
    },
  },
  BulkModerationResult: {
    type: "object",
    properties: {
      action: { type: "string" },
      requested: { type: "integer", description: "Number of prompt IDs submitted" },
      applied: { type: "integer", description: "Number of prompts successfully acted upon" },
      skipped: { type: "integer", description: "Number of prompts skipped (ineligible state)" },
      decisionIds: { type: "array", items: { type: "string" }, description: "ModerationDecision IDs created" },
    },
  },
  ModerationDecision: {
    type: "object",
    properties: {
      _id: { type: "string" },
      promptId: { type: "string" },
      action: { type: "string", enum: ["approve", "reject", "hide", "restore"] },
      actorWallet: { type: "string", description: "SHA-256 hash of the admin wallet address" },
      reason: { type: "string" },
      evidenceNote: { type: "string", nullable: true },
      previousStatus: { type: "string" },
      newStatus: { type: "string" },
      rolledBack: { type: "boolean" },
      rollbackReason: { type: "string", nullable: true },
      rollbackAt: { type: "string", format: "date-time", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
  },
};

for (const [k, v] of Object.entries(newSchemas)) {
  spec.components.schemas[k] = v;
}

writeFileSync("docs/openapi.json", JSON.stringify(spec, null, 2) + "\n");
console.log("Patched. Total paths:", Object.keys(spec.paths).length);
console.log("Total schemas:", Object.keys(spec.components.schemas).length);
