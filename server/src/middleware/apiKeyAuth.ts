import type { Request, Response, NextFunction } from "express";
import { authenticateApiKey, type AuthenticatedApiKey } from "../services/apiKeys";
import type { ApiKeyScope } from "../models/ApiKey";

export interface ApiKeyRequest extends Request {
  apiKey?: AuthenticatedApiKey;
}

export function requireApiKeyScope(requiredScope: ApiKeyScope) {
  return async function apiKeyAuthMiddleware(
    req: ApiKeyRequest,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const suppliedKey = req.header("x-api-key");
    if (!suppliedKey) {
      res.status(401).json({ error: "API key required." });
      return;
    }

    try {
      const apiKey = await authenticateApiKey(suppliedKey, req);
      if (!apiKey || !apiKey.scopes.includes(requiredScope)) {
        res.status(401).json({ error: "Invalid, revoked, expired, or insufficient API key." });
        return;
      }

      req.apiKey = apiKey;
      next();
    } catch (error) {
      console.error("API key authentication failed:", error);
      res.status(401).json({ error: "Invalid, revoked, expired, or insufficient API key." });
    }
  };
}