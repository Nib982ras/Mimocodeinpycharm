/**
 * API route configuration.
 *
 * Centralizes route-specific settings like body size limits,
 * rate limits, and authentication requirements.
 */

export const API_CONFIG = {
  // Body size limits per route prefix
  bodySizeLimits: {
    "/api/documents": 100 * 1024 * 1024, // 100MB for document uploads
    "/api/auth/login": 1 * 1024 * 1024,   // 1MB for login
    "/api/seed": 1 * 1024 * 1024,         // 1MB for seed
    "/api/reset": 1 * 1024 * 1024,        // 1MB for reset
    "default": 1 * 1024 * 1024,           // 1MB default
  },

  // Rate limits per route
  rateLimits: {
    "/api/auth/login": {
      maxAttempts: 5,
      windowMs: 15 * 60 * 1000, // 15 minutes
      blockMs: 30 * 60 * 1000,  // 30 minutes block
    },
    "/api/2fa/verify": {
      maxAttempts: 3,
      windowMs: 15 * 60 * 1000,
      blockMs: 60 * 60 * 1000, // 1 hour block
    },
    "default": {
      maxAttempts: 100,
      windowMs: 60 * 1000, // 1 minute
      blockMs: 5 * 60 * 1000,
    },
  },

  // Authentication requirements
  auth: {
    // Routes that require no authentication
    public: ["/api/health", "/api/csrf", "/api/auth/login"],
    // Routes that require OWNER role
    ownerOnly: ["/api/seed", "/api/reset", "/api/backup", "/api/keys/*/revoke"],
    // Routes that require SECURITY_ADMIN+ role
    securityAdmin: ["/api/users", "/api/branches", "/api/keys", "/api/devices", "/api/licenses"],
  },
};

/**
 * Get body size limit for a given path.
 */
export function getBodySizeLimit(pathname: string): number {
  for (const [prefix, limit] of Object.entries(API_CONFIG.bodySizeLimits)) {
    if (prefix !== "default" && pathname.startsWith(prefix)) {
      return limit;
    }
  }
  return API_CONFIG.bodySizeLimits.default;
}

/**
 * Get rate limit config for a given path.
 */
export function getRateLimitConfig(pathname: string) {
  for (const [prefix, config] of Object.entries(API_CONFIG.rateLimits)) {
    if (prefix !== "default" && pathname.startsWith(prefix)) {
      return config;
    }
  }
  return API_CONFIG.rateLimits.default;
}
