import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Security headers middleware with request tracing.
 *
 * Adds:
 *   - Security headers (CSP, HSTS, etc.)
 *   - Request ID for tracing
 *   - Cache control for API routes
 *   - CORS headers (whitelisted origins only)
 */

// Allowed origins for CORS — configure via ALLOWED_ORIGINS env var (comma-separated).
// Falls back to the application's own origin in production.
function getAllowedOrigins(): string[] {
  const env = process.env.ALLOWED_ORIGINS;
  if (env) return env.split(",").map((s) => s.trim()).filter(Boolean);
  // Default: no cross-origin allowed in production
  return [];
}

function isOriginAllowed(origin: string | null): boolean {
  if (!origin) return false;
  const allowed = getAllowedOrigins();
  if (allowed.length === 0) return false;
  return allowed.includes(origin);
}

export function middleware(request: NextRequest) {
  const response = NextResponse.next();

  // Generate or propagate request ID
  const requestId =
    request.headers.get("x-request-id") ||
    request.headers.get("x-amzn-trace-id") ||
    crypto.randomUUID();
  response.headers.set("X-Request-Id", requestId);

  // Strict Transport Security — enforce HTTPS for 1 year
  response.headers.set(
    "Strict-Transport-Security",
    "max-age=31536000; includeSubDomains; preload"
  );

  // Content Security Policy — restrict resource loading
  // PRODUCTION: Never use 'unsafe-eval' or 'unsafe-inline'.
  // Development: allow 'unsafe-eval' and 'unsafe-inline' for Next.js HMR.
  const isProd = process.env.NODE_ENV === "production";
  const scriptSrc = isProd
    ? "'self'"
    : "'self' 'unsafe-eval' 'unsafe-inline'";
  const styleSrc = isProd ? "'self'" : "'self' 'unsafe-inline'";

  response.headers.set(
    "Content-Security-Policy",
    [
      "default-src 'self'",
      `script-src ${scriptSrc}`,
      `style-src ${styleSrc}`,
      "img-src 'self' data: blob:",
      "font-src 'self'",
      "connect-src 'self' ws: wss:",
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join("; ")
  );

  // X-Content-Type-Options — prevent MIME sniffing
  response.headers.set("X-Content-Type-Options", "nosniff");

  // X-Frame-Options — prevent clickjacking
  response.headers.set("X-Frame-Options", "DENY");

  // X-XSS-Protection — legacy XSS filter
  response.headers.set("X-XSS-Protection", "1; mode=block");

  // Referrer Policy — limit referrer information
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  // Permissions Policy — restrict browser features
  response.headers.set(
    "Permissions-Policy",
    "camera=(), microphone=(), geolocation=(), payment=()"
  );

  // Remove server identification
  response.headers.delete("X-Powered-By");
  response.headers.delete("Server");

  // Cache-Control for API routes — prevent caching sensitive data
  if (request.nextUrl.pathname.startsWith("/api/")) {
    response.headers.set(
      "Cache-Control",
      "no-store, no-cache, must-revalidate, proxy-revalidate"
    );
    response.headers.set("Pragma", "no-cache");
    response.headers.set("Expires", "0");
    response.headers.set("Surrogate-Control", "no-store");
  }

  // CORS — whitelist-only, no wildcard fallback
  if (request.nextUrl.pathname.startsWith("/api/")) {
    const origin = request.headers.get("origin");
    if (isOriginAllowed(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin!);
    }
    response.headers.set("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    response.headers.set("Access-Control-Allow-Headers", "Content-Type, Authorization, X-CSRF-Token, X-Request-Id");
    response.headers.set("Access-Control-Allow-Credentials", "true");
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico (favicon)
     * - public folder
     */
    "/((?!_next/static|_next/image|favicon.ico|public/).*)",
  ],
};
