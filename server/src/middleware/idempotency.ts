import type { NextFunction, Request, Response } from "express";
import {
  beginIdempotentRequest,
  completeIdempotentRequest,
  hashIdempotentRequest,
  replayStatus,
  validateIdempotencyKey,
} from "../services/idempotencyService";
import { logger } from "../services/structuredLogger";

function errorResponse(res: Response, status: number, code: string, error: string) {
  return res.status(status).json({ code, error });
}

/**
 * Protects a high-risk mutation with a durable request/outcome gate.
 * The route keeps its original response shape; only replay metadata is added.
 *
 * Path coverage:
 * - normal: first request with a valid key runs the handler and records the outcome.
 * - replay: same key + same request hash returns the stored response with
 *   `Idempotent-Replayed: true` and the original status code.
 * - conflict: same key with a different request hash is rejected with 409.
 * - in_progress: a concurrent request with the same key is rejected with 409
 *   so the handler never runs twice.
 * - expired: a key past its retention window is rejected with 409.
 * - failure: if the handler fails before `finish`, the record is not completed;
 *   a later retry with the same key sees `in_progress`/recovery state from the
 *   service rather than a fabricated success.
 * - authorization: `actor` is folded into the store scope so keys are isolated
 *   per caller; one actor cannot replay or collide with another actor's record.
 *
 * Edge cases:
 * - Missing or malformed key -> 400 IDEMPOTENCY_KEY_REQUIRED, handler not run.
 * - Non-JSON bodies: `res.send` captures raw payloads when `res.json` is not used.
 * - `res.json` delegates to `res.send` with an already-stringified payload; the
 *   `capturedJson` guard prevents double-encoding on replay (#1041).
 *
 * Rollback / recovery:
 * - Completion is best-effort after `finish`; if completion fails, the record
 *   stays in progress and the service's expiry governs eventual release, so a
 *   retry after expiry is rejected as expired rather than re-executed silently.
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
    logger.info("idempotency.key_invalid", {
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
        logger.warn("idempotency.conflict", {
          method: req.method,
          path: scope,
          requestHash,
        });
        errorResponse(res, 409, "IDEMPOTENCY_KEY_CONFLICT", decision.message);
        return;
      }
      if (decision.kind === "expired") {
        logger.warn("idempotency.expired", {
          method: req.method,
          path: scope,
          requestHash,
        });
        errorResponse(res, 409, "IDEMPOTENCY_KEY_EXPIRED", decision.message);
        return;
      }
      if (decision.kind === "in_progress") {
        logger.info("idempotency.in_progress", {
          method: req.method,
          path: scope,
          requestHash,
        });
        errorResponse(res, 409, "IDEMPOTENCY_REQUEST_IN_PROGRESS", decision.message);
        return;
      }
      if (decision.kind === "replay") {
        logger.info("idempotency.replay", {
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
        // `res.json()` delegates to `res.send()` with the ALEADY-STRINGIFIED
        // payload. Without this guard the send wrapper overwrites the object
        // captured by json, and every replay double-encodes the stored body —
        // the client then receives a JSON string instead of the original
        // response object (#1041).
        if (!capturedJson) {
          responseBody = body ?? null;
        }
        return originalSend(body);
      }) as Response["send"];
      res.once("finish", () => {
        logger.info("idempotency.completed", {
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
