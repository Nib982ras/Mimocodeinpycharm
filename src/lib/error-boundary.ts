import { NextResponse } from "next/server";

/**
 * Global error handling for API routes.
 *
 * Provides consistent error responses and prevents internal errors
 * from leaking to clients.
 */

export interface ApiError {
  ok: false;
  error: string;
  code?: string;
  details?: unknown;
}

export interface ApiResponse<T = unknown> {
  ok: true;
  data: T;
}

/**
 * Create a standardized error response.
 */
export function errorResponse(
  message: string,
  status: number = 500,
  code?: string,
  details?: unknown
): NextResponse<ApiError> {
  return NextResponse.json(
    {
      ok: false,
      error: message,
      code,
      ...(process.env.NODE_ENV !== "production" && details ? { details } : {}),
    },
    { status }
  );
}

/**
 * Create a standardized success response.
 */
export function successResponse<T>(data: T, status: number = 200): NextResponse<ApiResponse<T>> {
  return NextResponse.json({ ok: true, data }, { status });
}

/**
 * Wrap a route handler with global error handling.
 *
 * Catches all unhandled errors and returns a safe error response.
 * Logs the full error server-side for debugging.
 *
 * @example
 * export const POST = withErrorHandling(async (req) => {
 *   // Your handler code
 *   return successResponse({ result: "ok" });
 * });
 */
export function withErrorHandling<T>(
  handler: (req: Request, context?: unknown) => Promise<NextResponse<T | ApiError>>
): (req: Request, context?: unknown) => Promise<NextResponse<T | ApiError>> {
  return async (req: Request, context?: unknown): Promise<NextResponse<T | ApiError>> => {
    try {
      return await handler(req, context);
    } catch (err) {
      // Log the full error server-side
      console.error("[API Error]", {
        path: new URL(req.url).pathname,
        method: req.method,
        error: err instanceof Error ? err.message : "Unknown error",
        stack: err instanceof Error ? err.stack : undefined,
        timestamp: new Date().toISOString(),
      });

      // Handle specific error types
      if (err instanceof ValidationError) {
        return errorResponse(err.message, 400, "VALIDATION_ERROR");
      }

      if (err instanceof AuthError) {
        return errorResponse(err.message, err.status, "AUTH_ERROR");
      }

      if (err instanceof NotFoundError) {
        return errorResponse(err.message, 404, "NOT_FOUND");
      }

      if (err instanceof ConflictError) {
        return errorResponse(err.message, 409, "CONFLICT");
      }

      if (err instanceof RateLimitError) {
        return errorResponse(err.message, 429, "RATE_LIMITED");
      }

      if (err instanceof TimeoutError) {
        return errorResponse("Request timed out", 504, "TIMEOUT");
      }

      // Generic error — don't leak internal details
      return errorResponse(
        process.env.NODE_ENV === "production"
          ? "An unexpected error occurred"
          : err instanceof Error
            ? err.message
            : "An unexpected error occurred",
        500,
        "INTERNAL_ERROR"
      );
    }
  };
}

// ============================================================================
// Custom error classes
// ============================================================================

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class AuthError extends Error {
  status: number;
  constructor(message: string, status: number = 401) {
    super(message);
    this.name = "AuthError";
    this.status = status;
  }
}

export class NotFoundError extends Error {
  constructor(message: string = "Resource not found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class ConflictError extends Error {
  constructor(message: string = "Resource already exists") {
    super(message);
    this.name = "ConflictError";
  }
}

export class RateLimitError extends Error {
  constructor(message: string = "Too many requests") {
    super(message);
    this.name = "RateLimitError";
  }
}

export class TimeoutError extends Error {
  constructor(message: string = "Request timed out") {
    super(message);
    this.name = "TimeoutError";
  }
}

export class ForbiddenError extends Error {
  constructor(message: string = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

export class BadRequestError extends Error {
  constructor(message: string = "Bad request") {
    super(message);
    this.name = "BadRequestError";
  }
}
