import { Request, Response } from "express";
import { AiProviderError, aiProviderErrorStatus, callAiProvider, isAiProviderConfigured } from "../services/aiProvider";
import { logger } from "../services/structuredLogger.js";

/**
 * Backend-owned routes the frontend uses in place of calling the AI provider
 * directly (#29). Every route returns the same structured error shape as
 * services/aiProvider: `{ error, message, retryable }`.
 */

const MAX_PROMPT_CHARS = 20_000;
const MODEL_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

function sendError(res: Response, err: unknown, action: string): Response {
  if (err instanceof AiProviderError) {
    logger.warn("AI gateway call failed", { action, code: err.code });
    return res.status(aiProviderErrorStatus(err.code)).json({
      error: err.code,
      message: err.message,
      retryable: err.retryable,
    });
  }
  logger.error("AI gateway unexpected error", { action, error: err instanceof Error ? err.name : "unknown" });
  return res.status(500).json({ error: "INTERNAL_ERROR", message: "Unexpected AI service error.", retryable: false });
}

/** GET /api/chat/gateway?prompt=&model= */
export const GetAiGatewayChat = async (req: Request, res: Response): Promise<Response> => {
  const prompt = typeof req.query.prompt === "string" ? req.query.prompt : "";
  const model = typeof req.query.model === "string" ? req.query.model : "gemini-2.5-flash";

  if (prompt.trim().length === 0) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "prompt is required.", retryable: false });
  }
  if (prompt.length > MAX_PROMPT_CHARS) {
    return res.status(413).json({
      error: "PAYLOAD_TOO_LARGE",
      message: `prompt must be at most ${MAX_PROMPT_CHARS} characters.`,
      retryable: false,
    });
  }
  if (!MODEL_PATTERN.test(model)) {
    return res.status(400).json({ error: "VALIDATION_ERROR", message: "model identifier is invalid.", retryable: false });
  }

  try {
    const data = await callAiProvider({
      method: "GET",
      path: `/api/chat?prompt=${encodeURIComponent(prompt)}&model=${encodeURIComponent(model)}`,
    });
    return res.json(data);
  } catch (err) {
    return sendError(res, err, "gatewayChat");
  }
};

/** GET /api/chat/gateway/models */
export const GetAiModels = async (_req: Request, res: Response): Promise<Response> => {
  try {
    return res.json(await callAiProvider({ method: "GET", path: "/api/models" }));
  } catch (err) {
    return sendError(res, err, "gatewayModels");
  }
};

/**
 * GET /api/chat/gateway/health
 * Reports whether the AI feature is configured and reachable. Never reveals
 * the provider URL.
 */
export const GetAiHealth = async (_req: Request, res: Response): Promise<Response> => {
  if (!isAiProviderConfigured()) {
    return res.status(200).json({ status: "disabled", configured: false });
  }
  try {
    await callAiProvider({ method: "GET", path: "/api/health" });
    return res.status(200).json({ status: "ok", configured: true });
  } catch (err) {
    const code = err instanceof AiProviderError ? err.code : "AI_PROVIDER_UNAVAILABLE";
    return res.status(200).json({ status: "degraded", configured: true, code });
  }
};
