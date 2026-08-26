import { Request, Response, NextFunction } from "express";
import crypto from "crypto";

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
    }
  }
}

export function correlationMiddleware(req: Request, res: Response, next: NextFunction) {
  const incomingId = req.headers["x-correlation-id"] || req.headers["x-request-id"];
  const correlationId = (typeof incomingId === "string" && incomingId)
    ? incomingId
    : crypto.randomUUID();

  req.correlationId = correlationId;
  res.setHeader("X-Correlation-ID", correlationId);

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

  console.log(`[Express API Request] ${req.method} ${req.originalUrl} | Correlation ID: ${correlationId}`);

  res.on("finish", () => {
    if (res.statusCode >= 400) {
      console.error(`[Express API Error Response] ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | Correlation ID: ${correlationId}`);
    } else {
      console.log(`[Express API Response] ${req.method} ${req.originalUrl} | Status: ${res.statusCode} | Correlation ID: ${correlationId}`);
    }
  });

  next();
}
