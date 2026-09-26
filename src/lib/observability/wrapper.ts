import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger";
import { metrics } from "./metrics";

export type ApiHandler = (_req: any, _res: any) => Promise<void> | void;

export function withObservability(handler: ApiHandler, name: string): ApiHandler {
  return async (req, res) => {
    const incomingCorrelationId = req.headers["x-correlation-id"] || req.headers["x-request-id"];
    const correlationId = (typeof incomingCorrelationId === "string" && incomingCorrelationId)
      ? incomingCorrelationId
      : uuidv4();

    const startTime = Date.now();

    // Attach request context for logging
    const childLogger = logger.child({
      correlationId,
      method: req.method,
      url: req.url,
      clientIp: req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown",
    });

    // Wrap res.json to automatically inject correlationId into error/unsuccessful payloads
    const originalJson = res.json;
    res.json = function (body: any) {
      if (body && typeof body === "object" && !body.correlationId) {
        if (body.error || res.statusCode >= 400) {
          body.correlationId = correlationId;
        }
      }
      return originalJson.call(this, body);
    };

    try {
      childLogger.info({ body: req.body }, `Request started: ${name}`);

      // Inject logger and correlation ID into request
      req.logger = childLogger;
      req.requestId = correlationId;
      req.correlationId = correlationId;

      // Add correlation ID header to the response
      res.setHeader("X-Correlation-ID", correlationId);

      await handler(req, res);

      const duration = Date.now() - startTime;
      metrics.emit("api_request_duration_ms", duration, { path: name, status: res.statusCode });
      
      childLogger.info(
        { statusCode: res.statusCode, duration },
        `Request completed: ${name}`
      );
    } catch (error) {
      const duration = Date.now() - startTime;
      const message = error instanceof Error ? error.message : "Unknown error";
      
      childLogger.error(
        { error: message, stack: error instanceof Error ? error.stack : undefined, duration },
        `Request failed: ${name}`
      );

      metrics.emit("api_request_error_total", 1, { path: name, error: message });

      if (!res.writableEnded) {
        res.status(500).json({
          error: "Internal server error",
          correlationId,
        });
      }
    }
  };
}

