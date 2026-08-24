import express from "express";
import {
  DeleteWebhook,
  GetDeadLetterEvents,
  GetDeadLetterStats,
  GetWebhook,
  RegisterWebhook,
  RetryDeadLetterEvent,
} from "../controllers/webhookControllers";

export const webhookRouter = express.Router();

webhookRouter.post("/", RegisterWebhook);
webhookRouter.get("/", GetWebhook);
webhookRouter.delete("/", DeleteWebhook);

// Dead-letter admin endpoints (#606)
webhookRouter.get("/dead-letter", GetDeadLetterEvents);
webhookRouter.get("/dead-letter/stats", GetDeadLetterStats);
webhookRouter.post("/dead-letter/:eventId/retry", RetryDeadLetterEvent);
