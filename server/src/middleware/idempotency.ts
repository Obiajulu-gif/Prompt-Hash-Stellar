import type { NextFunction, Request, Response } from "express";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  hashIdempotentRequest,
  replayStatus,
  validateIdempotencyKey,
} from "../services/idempotencyService";

function errorResponse(res: Response, status: number, code: string, error: string) {
  return res.status(status).json({ code, error });
}

/**
 * Protects a high-risk mutation with a durable request/outcome gate.
 * The route keeps its original response shape; only replay metadata is added.
 */
export function requireIdempotency(req: Request, res: Response, next: NextFunction): void {
  const key = req.get("Idempotency-Key");
  const keyError = validateIdempotencyKey(key);
  if (keyError) {
    errorResponse(res, 400, "IDEMPOTENCY_KEY_REQUIRED", keyError);
    return;
  }

  const scope = `${req.baseUrl}${req.path}`;
  const requestHash = hashIdempotentRequest({ method: req.method, scope, body: req.body });

  void beginIdempotentRequest({ scope, key: key as string, requestHash })
    .then((decision) => {
      if (decision.kind === "conflict") {
        errorResponse(res, 409, "IDEMPOTENCY_KEY_CONFLICT", decision.message);
        return;
      }
      if (decision.kind === "expired") {
        errorResponse(res, 409, "IDEMPOTENCY_KEY_EXPIRED", decision.message);
        return;
      }
      if (decision.kind === "in_progress") {
        errorResponse(res, 409, "IDEMPOTENCY_REQUEST_IN_PROGRESS", decision.message);
        return;
      }
      if (decision.kind === "replay") {
        res.setHeader("Idempotent-Replayed", "true");
        res.status(replayStatus(decision.record)).json(decision.record.responseBody);
        return;
      }

      let responseBody: unknown = null;
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);
      res.json = ((body: unknown) => {
        responseBody = body;
        return originalJson(body);
      }) as Response["json"];
      res.send = ((body?: unknown) => {
        responseBody = body ?? null;
        return originalSend(body);
      }) as Response["send"];
      res.once("finish", () => {
        void completeIdempotentRequest({
          recordId: decision.record._id,
          statusCode: res.statusCode,
          responseBody,
        });
      });
      next();
    })
    .catch(next);
}
