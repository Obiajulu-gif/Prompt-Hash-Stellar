import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger";
import { metrics } from "./metrics";

export type ApiHandler = (req: any, res: any) => Promise<void> | void;

export function withObservability(handler: ApiHandler, name: string): ApiHandler {
  return async (req, res) => {
    const requestId = uuidv4();
    const startTime = Date.now();

    // Attach request context for logging
    const childLogger = logger.child({
      requestId,
      method: req.method,
      url: req.url,
      clientIp: req.headers["x-forwarded-for"] || req.socket.remoteAddress,
    });

    try {
      childLogger.info({ body: req.body }, `Request started: ${name}`);

      // Inject logger into request if needed, or just use the childLogger
      req.logger = childLogger;
      req.requestId = requestId;

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
          requestId,
        });
      }
    }
  };
}
