import { Request, Response, NextFunction } from "express";
import mapFailureToRejection from "../services/rejectionExplanations";
import { REJECTION_EXPLANATIONS } from "../services/rejectionExplanations";

/**
 * Standardized error response middleware.
 * Wraps route handler errors into consistent rejection explanation format.
 * Ensures all errors return: status code, error code, user-friendly message, and recovery hint.
 */
export function errorHandlerMiddleware(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  // Capture the original send method
  const originalSend = res.send;

  // Override res.send to intercept error responses
  res.send = function (body: any) {
    // If this is an error response (status >= 400) and body is an Error object
    if (res.statusCode >= 400 && body instanceof Error) {
      const explanation = mapFailureToRejection(body);
      res.status(explanation.status).json({
        error: explanation.reason,
        code: explanation.code,
        message: explanation.message,
        hint: explanation.hint,
        recoveryPath: explanation.recoveryPath,
        correlationId: req.correlationId,
      });
    } else {
      // Pass through normally
      originalSend.call(this, body);
    }
  };

  next();
}

/**
 * Async error wrapper for route handlers.
 * Catches async errors and maps them to standardized rejection explanations.
 */
export function asyncWrapper(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<any>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      await handler(req, res, next);
    } catch (err) {
      const error = err as Error & {
        code?: string;
        status?: number;
        rejectionCode?: RejectionCode;
      };

      // If the error already has a rejectionCode, use it directly
      if (error.rejectionCode) {
        const explanation = REJECTION_EXPLANATIONS[error.rejectionCode] || REJECTION_EXPLANATIONS.not_found;
        res.status(error.status || explanation.status).json({
          error: explanation.reason,
          code: explanation.code,
          message: explanation.message,
          hint: explanation.hint,
          recoveryPath: explanation.recoveryPath,
          correlationId: req.correlationId,
        });
        return;
      }

      // Otherwise, map the error to a rejection explanation
      const explanation = mapFailureToRejection(error);

      // Preserve any additional error context
      const response: Record<string, unknown> = {
        error: explanation.reason,
        code: explanation.code,
        message: explanation.message,
        hint: explanation.hint,
        recoveryPath: explanation.recoveryPath,
        correlationId: req.correlationId,
      };

      // Include original error details in development/debug mode
      if (process.env.NODE_ENV !== "production") {
        ;(response as any).originalError = error.message;
        ;(response as any).originalStack = error.stack;
      }

      res.status(explanation.status).json(response);
    }
  };
}

/**
 * Route-specific error helpers for common failure scenarios.
 */

export function validationError(
  message: string,
  field?: string
): Error & { code: string; status: number; rejectionCode: "validation" } {
  const error: any = new Error(message);
  error.code = "VALIDATION_ERROR";
  error.status = 400;
  error.rejectionCode = "validation";
  if (field) {
    error.message = `${field}: ${message}`;
  }
  return error;
}

export function permissionDeniedError(
  resource: string
): Error & { code: string; status: number; rejectionCode: "permission_denied" } {
  const error: any = new Error(`Permission denied for ${resource}`);
  error.code = "FORBIDDEN";
  error.status = 403;
  error.rejectionCode = "permission_denied";
  return error;
}

export function notFoundError(resource: string = "resource"): Error & {
  code: string;
  status: number;
  rejectionCode: "not_found";
} {
  const error: any = new Error(`${resource} not found`);
  error.code = "NOT_FOUND";
  error.status = 404;
  error.rejectionCode = "not_found";
  return error;
}

export function conflictError(
  message: string
): Error & { code: string; status: number; rejectionCode: "conflict" } {
  const error: any = new Error(message);
  error.code = "CONFLICT";
  error.status = 409;
  error.rejectionCode = "conflict";
  return error;
}

export function rateLimitedError(
  retryAfter?: number
): Error & { code: string; status: number; rejectionCode: "rate_limited" } {
  const error: any = new Error("Rate limit exceeded");
  error.code = "RATE_LIMIT";
  error.status = 429;
  error.rejectionCode = "rate_limited";
  if (retryAfter) {
    error.message = `Rate limit exceeded. Retry in ${retryAfter} seconds.`;
  }
  return error;
}

export function externalServiceError(
  service: string
): Error & { code: string; status: number; rejectionCode: "external_service" } {
  const error: any = new Error(`${service} service unavailable`);
  error.code = "EXTERNAL_TIMEOUT";
  error.status = 502;
  error.rejectionCode = "external_service";
  return error;
}

export function staleStateError(
  reason: string
): Error & { code: string; status: number; rejectionCode: "stale_state" } {
  const error: any = new Error(`Stale state: ${reason}`);
  error.code = "STALE_RECORD";
  error.status = 409;
  error.rejectionCode = "stale_state";
  return error;
}