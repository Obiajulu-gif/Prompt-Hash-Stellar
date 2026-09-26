import express from "express";
import {
  DeleteWebhook,
  GetWebhook,
  ListWebhookDeadLetters,
  RegisterWebhook,
  ReplayWebhookDeadLetter,
  RotateWebhookSecret,
} from "../controllers/webhookControllers";
import {
  ReceiveInboundWebhook,
  ListFailedInboundEvents,
  RetryFailedInboundEvent,
  GetInboundEvent,
} from "../controllers/inboundWebhookControllers";
import { requireAdminScope } from "../middleware/adminAuth";

export const webhookRouter = express.Router();

// ── Outbound subscription management ─────────────────────────────────────────
webhookRouter.post("/", RegisterWebhook);
webhookRouter.get("/", GetWebhook);
webhookRouter.delete("/", DeleteWebhook);

// Dead-letter inspection and replay (admin) — outbound outbox (#536).
webhookRouter.get(
  "/dead-letters",
  requireAdminScope("webhook:read"),
  ListWebhookDeadLetters,
);
webhookRouter.post(
  "/dead-letters/:id/replay",
  requireAdminScope("webhook:write"),
  ReplayWebhookDeadLetter,
);
webhookRouter.post(
  "/:id/rotate-secret",
  requireAdminScope("webhook:write"),
  RotateWebhookSecret,
);

// ── Inbound webhook intake (#idempotent-webhooks) ─────────────────────────────
// Public intake endpoint — verification is done inside the controller.
webhookRouter.post("/inbound", ReceiveInboundWebhook);

// Admin tooling: failed event queue and single-event retry.
webhookRouter.get(
  "/inbound/failed",
  requireAdminScope("webhook:read"),
  ListFailedInboundEvents,
);
webhookRouter.post(
  "/inbound/:id/retry",
  requireAdminScope("webhook:write"),
  RetryFailedInboundEvent,
);
webhookRouter.get(
  "/inbound/:id",
  requireAdminScope("webhook:read"),
  GetInboundEvent,
);
