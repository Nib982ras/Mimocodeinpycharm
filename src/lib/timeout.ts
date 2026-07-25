import { NextResponse } from "next/server";

/**
 * Request timeout middleware.
 *
 * Prevents requests from hanging indefinitely by enforcing a timeout.
 * Useful for preventing resource exhaustion from slow clients or
 * unresponsive downstream services.
 */

const DEFAULT_TIMEOUT_MS = 30 * 1000; // 30 seconds
const UPLOAD_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes for uploads

/**
 * Create an AbortController that triggers after the specified timeout.
 */
export function createTimeoutController(timeoutMs: number = DEFAULT_TIMEOUT_MS) {
  const controller = new AbortController();

  const timeoutId = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  return {
    signal: controller.signal,
    timeoutId,
    cleanup: () => clearTimeout(timeoutId),
  };
}

/**
 * Get timeout for a given path.
 */
export function getTimeoutForPath(pathname: string): number {
  // Longer timeout for file uploads
  if (pathname.startsWith("/api/documents") && !pathname.includes("/decrypt")) {
    return UPLOAD_TIMEOUT_MS;
  }

  // Longer timeout for backup operations
  if (pathname.startsWith("/api/backup")) {
    return UPLOAD_TIMEOUT_MS;
  }

  return DEFAULT_TIMEOUT_MS;
}

/**
 * Wrapper for route handlers with timeout enforcement.
 *
 * @example
 * export const POST = withTimeout(async (req) => {
 *   // Long-running operation
 *   return NextResponse.json({ ok: true });
 * });
 */
export function withTimeout(
  handler: (req: Request, context?: unknown) => Promise<Response>,
  timeoutMs?: number
) {
  return async (req: Request, context?: unknown): Promise<Response> => {
    const timeout = timeoutMs || getTimeoutForPath(new URL(req.url).pathname);
    const { signal, cleanup } = createTimeoutController(timeout);

    try {
      // Race the handler against the timeout
      const result = await Promise.race([
        handler(req, context),
        new Promise<never>((_, reject) => {
          signal.addEventListener("abort", () => {
            reject(new TimeoutError(`Request timed out after ${timeout}ms`));
          });
        }),
      ]);

      return result;
    } catch (err) {
      if (err instanceof TimeoutError) {
        return NextResponse.json(
          { ok: false, error: "Request timed out" },
          { status: 504 }
        );
      }
      throw err;
    } finally {
      cleanup();
    }
  };
}

/**
 * Custom timeout error class.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}
