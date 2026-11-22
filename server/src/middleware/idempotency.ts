import type { NextFunction, Request, Response } from "express";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  hashIdempotentRequest,
  replayStatus,
  validateIdempotencyKey,
} from "../services/idempotencyService";
import { serializeLogEntry } from "./correlation";

function logDecision(level: "info" | "warn", event: string, fields: Record<string, unknown>) {
  console[level](serializeLogEntry({ level, event, ...fields }));
}

function errorResponse(res: Response, status: number, code: string, error: string) {
  return res.status(status).json({ code, error });
}

/**
 * Protects a high-risk mutation with a durable request/outcome gate.
 * The route keeps its original response shape; only replay metadata is added.
 *
 * Concurrency behavior:
 * - Two simultaneous requests with the same key and body: the first claims the
 *   record and proceeds; the second receives IDEMPOTENCY_REQUEST_IN_PROGRESS (409)
 *   and must retry after the first completes, at which point it gets a replay.
 * - Same key, different body or scope: IDEMPOTENCY_KEY_CONFLICT (409).
 * - Expired key: IDEMPOTENCY_KEY_EXPIRED (409); clients must mint a new key.
 * - Failure before completion: the record remains in progress until the service
 *   expires it; the outcome is never recorded as a successful replay, so a retry
 *   after expiry re-executes the mutation. Rollback of partial side effects is the
 *   responsibility of the route handler.
 * - Authorization: the actor is folded into the store scope, so the same key used
 *   by different actors does not collide or leak replay responses across actors.
 */
export function requireIdempotency(
  req: Request,
  res: Response,
  next: NextFunction,
  actor?: string,
): void {
  const key = req.get("Idempotency-Key");
  const keyError = validateIdempotencyKey(key);
  if (keyError) {
    logDecision("info", "idempotency.key_invalid", {
      method: req.method,
      path: `${req.baseUrl}${req.path}`,
      reason: keyError,
    });
    errorResponse(res, 400, "IDEMPOTENCY_KEY_REQUIRED", keyError);
    return;
  }

  const scope = `${req.baseUrl}${req.path}`;
  const requestHash = hashIdempotentRequest({ method: req.method, scope, body: req.body });

  const storeScope = actor
    ? hashIdempotentRequest({ method: req.method, scope, body: { actor } })
    : scope;
  void beginIdempotentRequest({ scope: storeScope, key: key as string, requestHash })
    .then((decision) => {
      if (decision.kind === "conflict") {
        logDecision("warn", "idempotency.conflict", {
          method: req.method,
          path: scope,
          requestHash,
        });
        errorResponse(res, 409, "IDEMPOTENCY_KEY_CONFLICT", decision.message);
        return;
      }
      if (decision.kind === "expired") {
        logDecision("warn", "idempotency.expired", {
          method: req.method,
          path: scope,
          requestHash,
        });
        errorResponse(res, 409, "IDEMPOTENCY_KEY_EXPIRED", decision.message);
        return;
      }
      if (decision.kind === "in_progress") {
        logDecision("info", "idempotency.in_progress", {
          method: req.method,
          path: scope,
          requestHash,
        });
        errorResponse(res, 409, "IDEMPOTENCY_REQUEST_IN_PROGRESS", decision.message);
        return;
      }
      if (decision.kind === "replay") {
        logDecision("info", "idempotency.replay", {
          method: req.method,
          path: scope,
          requestHash,
          statusCode: replayStatus(decision.record),
        });
        res.setHeader("Idempotent-Replayed", "true");
        res.status(replayStatus(decision.record)).json(decision.record.responseBody);
        return;
      }

      let responseBody: unknown = null;
      let capturedJson = false;
      const originalJson = res.json.bind(res);
      const originalSend = res.send.bind(res);
      res.json = ((body: unknown) => {
        responseBody = body;
        capturedJson = true;
        return originalJson(body);
      }) as Response["json"];
      res.send = ((body?: unknown) => {
        // `res.json()` delegates to `res.send()` with the ALREADY-STRINGIFIED
        // payload. Without this guard the send wrapper overwrites the object
        // captured by json, and every replay double-encodes the stored body --
        // the client then receives a JSON string instead of the original
        // response object (#1041).
        if (!capturedJson) {
          responseBody = body ?? null;
        }
        return originalSend(body);
      }) as Response["send"];
      res.once("finish", () => {
        logDecision("info", "idempotency.completed", {
          method: req.method,
          path: scope,
          requestHash,
          statusCode: res.statusCode,
        });
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
