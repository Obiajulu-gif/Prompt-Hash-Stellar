import express from "express";
import {
  DeleteWebhook,
  GetWebhook,
  ListWebhookDeadLetters,
  RegisterWebhook,
  ReplayWebhookDeadLetter,
  RotateWebhookSecret,
} from "../controllers/webhookControllers";
import { requireAdminScope } from "../middleware/adminAuth";

export const webhookRouter = express.Router();

webhookRouter.post("/", RegisterWebhook);
webhookRouter.get("/", GetWebhook);
webhookRouter.delete("/", DeleteWebhook);

webhookRouter.get("/dead-letters", requireAdminScope("webhook:read"), ListWebhookDeadLetters);
webhookRouter.post(
  "/dead-letters/:id/replay",
  requireAdminScope("webhook:write"),
  ReplayWebhookDeadLetter,
);
webhookRouter.post("/:id/rotate-secret", requireAdminScope("webhook:write"), RotateWebhookSecret);
