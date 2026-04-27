import { v4 as uuidv4 } from "uuid";
import { logger } from "./logger";
import { metrics } from "./metrics";

export interface ApiRequest {
  method?: string;
  url?: string;
  headers: Record<string, string | string[] | undefined>;
  socket: { remoteAddress?: string };
  body: any;
}

export interface ApiResponse {
  statusCode: number;
  status: (statusCode: number) => ApiResponse;
  json: (data: any) => void;
  writableEnded?: boolean;
}

export interface RequestWithLogger extends ApiRequest {
  logger: typeof logger;
  requestId: string;
}

export type ApiHandler = (req: RequestWithLogger, res: ApiResponse) => Promise<void> | void;

export function withObservability(handler: ApiHandler, name: string) {
  return async (req: ApiRequest, res: ApiResponse) => {
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
      const reqWithLogger = req as RequestWithLogger;
      reqWithLogger.logger = childLogger;
      reqWithLogger.requestId = requestId;

      await handler(reqWithLogger, res);

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
