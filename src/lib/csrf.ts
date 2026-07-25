import crypto from "crypto";
import { cookies } from "next/headers";

/**
 * CSRF protection using the Double Submit Cookie pattern.
 *
 * This is more practical for SPAs than synchronizer tokens because:
 *   1. No server-side session state required per token
 *   2. Works across origins when using SameSite cookies
 *   3. Frontend can easily include the token in headers
 *
 * Flow:
 *   1. Server generates a random CSRF token and sets it as a cookie
 *   2. Client reads the cookie and includes the token in X-CSRF-Token header
 *   3. Server verifies the cookie and header match
 *
 * Security properties:
 *   - Token is 32 bytes of cryptographic randomness
 *   - Token is bound to the session via cookie
 *   - Constant-time comparison prevents timing attacks
 */

const CSRF_COOKIE = "csrf-token";
const CSRF_HEADER = "x-csrf-token";

/**
 * Generate and set a CSRF token cookie.
 * Called during login or on the first API request.
 */
export async function setCsrfToken(): Promise<string> {
  const token = crypto.randomBytes(32).toString("hex");
  const store = await cookies();
  store.set(CSRF_COOKIE, token, {
    httpOnly: false, // Must be readable by JavaScript
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60, // 1 hour
  });
  return token;
}

/**
 * Get the current CSRF token from the cookie.
 */
export async function getCsrfToken(): Promise<string | null> {
  const store = await cookies();
  return store.get(CSRF_COOKIE)?.value || null;
}

/**
 * Validate that the CSRF token from the header matches the cookie.
 * Uses constant-time comparison to prevent timing attacks.
 *
 * @param req - The incoming request
 * @returns true if valid, false otherwise
 */
export async function validateCsrfToken(req: Request): Promise<boolean> {
  const cookieToken = await getCsrfToken();
  const headerToken = req.headers.get(CSRF_HEADER);

  if (!cookieToken || !headerToken) {
    return false;
  }

  // Constant-time comparison — pad to equal length to avoid length leakage
  try {
    const cookieBuf = Buffer.from(cookieToken, "hex");
    const headerBuf = Buffer.from(headerToken, "hex");

    // Pad shorter buffer to match length (constant-time safe)
    const maxLen = Math.max(cookieBuf.length, headerBuf.length);
    const a = Buffer.alloc(maxLen, 0);
    const b = Buffer.alloc(maxLen, 0);
    cookieBuf.copy(a);
    headerBuf.copy(b);

    const match = crypto.timingSafeEqual(a, b);
    // Also verify lengths match (timing-safe via constant-time AND)
    return match && cookieBuf.length === headerBuf.length;
  } catch {
    return false;
  }
}

/**
 * CSRF protection middleware wrapper.
 * Use this to protect state-changing endpoints.
 *
 * @param handler - The route handler to protect
 * @returns Protected handler that validates CSRF tokens
 */
export function withCsrfProtection(
  handler: (req: Request, context?: unknown) => Promise<Response>
): (req: Request, context?: unknown) => Promise<Response> {
  return async (req: Request, context?: unknown) => {
    // Skip CSRF for safe methods
    if (req.method === "GET" || req.method === "HEAD" || req.method === "OPTIONS") {
      return handler(req, context);
    }

    // Validate CSRF token
    const isValid = await validateCsrfToken(req);
    if (!isValid) {
      return new Response(
        JSON.stringify({ ok: false, error: "Invalid or missing CSRF token" }),
        {
          status: 403,
          headers: { "Content-Type": "application/json" },
        }
      );
    }

    return handler(req, context);
  };
}
