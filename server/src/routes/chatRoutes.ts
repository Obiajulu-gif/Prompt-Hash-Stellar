import express from "express";
import { PostChat } from "../controllers/controllers.js";
import { GetAiHealth, GetAiModels, GetAiGatewayChat } from "../controllers/aiGatewayControllers.js";

export const chatRouter = express.Router();

// OpenAI-backed streaming chat (POST, requires OPENAI_API_KEY).
chatRouter.route("/").post(PostChat);

// Provider-agnostic AI boundary (#29). The frontend calls these backend routes;
// the provider URL and credentials stay in server env (AI_PROVIDER_BASE_URL).
chatRouter.route("/gateway").get(GetAiGatewayChat);
chatRouter.route("/gateway/models").get(GetAiModels);
chatRouter.route("/gateway/health").get(GetAiHealth);
