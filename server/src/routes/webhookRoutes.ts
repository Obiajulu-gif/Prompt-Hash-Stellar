import express from "express";
import { DeleteWebhook, GetWebhook, RegisterWebhook } from "../controllers/webhookControllers";

export const webhookRouter = express.Router();

webhookRouter.post("/", RegisterWebhook);
webhookRouter.get("/", GetWebhook);
webhookRouter.delete("/", DeleteWebhook);
