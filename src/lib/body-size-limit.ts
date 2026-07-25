import { NextResponse } from "next/server";

/**
 * Request body size limiting for API routes.
 *
 * Prevents denial-of-service attacks via oversized request bodies.
 * Use this as a wrapper around route handlers that accept uploads.
 */

const MAX_BODY_SIZES: Record<string, number> = {
  // Document uploads — 100MB max
  "/api/documents": 100 * 1024 * 1024,
  // JSON payloads — 1MB max
  "default": 1 * 1024 * 1024,
};

/**
 * Get the maximum body size for a given path.
 */
function getMaxBodySize(pathname: string): number {
  // Check for exact match first
  if (MAX_BODY_SIZES[pathname]) {
    return MAX_BODY_SIZES[pathname];
  }

  // Check for prefix match
  for (const [prefix, size] of Object.entries(MAX_BODY_SIZES)) {
    if (prefix !== "default" && pathname.startsWith(prefix)) {
      return size;
    }
  }

  return MAX_BODY_SIZES.default;
}

/**
 * Format bytes to human-readable string.
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

/**
 * Check if request body exceeds size limit.
 * Returns null if OK, error response if too large.
 */
export function checkBodySize(req: Request): NextResponse | null {
  const contentLength = req.headers.get("content-length");

  if (contentLength) {
    const size = parseInt(contentLength, 10);
    const maxSize = getMaxBodySize(new URL(req.url).pathname);

    if (size > maxSize) {
      return NextResponse.json(
        {
          ok: false,
          error: `Request body too large. Maximum size is ${formatBytes(maxSize)}.`,
        },
        { status: 413 }
      );
    }
  }

  return null;
}

/**
 * Wrapper for route handlers that enforces body size limits.
 */
export function withBodySizeLimit(
  handler: (req: Request, context?: unknown) => Promise<Response>,
  maxSizeBytes?: number
): (req: Request, context?: unknown) => Promise<Response> {
  return async (req: Request, context?: unknown) => {
    const contentLength = req.headers.get("content-length");
    if (contentLength) {
      const size = parseInt(contentLength, 10);
      const maxSize = maxSizeBytes || getMaxBodySize(new URL(req.url).pathname);

      if (size > maxSize) {
        return NextResponse.json(
          {
            ok: false,
            error: `Request body too large. Maximum size is ${formatBytes(maxSize)}.`,
          },
          { status: 413 }
        );
      }
    }

    return handler(req, context);
  };
}
