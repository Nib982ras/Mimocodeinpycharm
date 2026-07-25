import { db } from "@/lib/db";

/**
 * Database-backed rate limiter for API endpoints.
 *
 * Uses the RateLimitAttempt model for persistent storage that:
 *   - Survives process restarts
 *   - Works across multiple instances (with PostgreSQL)
 *   - Tracks both per-IP and per-username attempts
 *   - Supports progressive lockout with exponential backoff
 *
 * For high-traffic production with PostgreSQL, consider replacing
 * with Redis-backed rate limiting for sub-millisecond checks.
 */

// ---------- Configuration ----------

interface RateLimitConfig {
  /** Maximum attempts allowed in the window */
  maxAttempts: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Block duration in milliseconds after exceeding limit */
  blockMs: number;
  /** Progressive block multiplier (doubles each consecutive block) */
  progressiveMultiplier: number;
}

/** Default config: 5 attempts per 15 min, 30 min block, progressive doubling */
const DEFAULT_CONFIG: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  blockMs: 30 * 60 * 1000,
  progressiveMultiplier: 2,
};

/** Login-specific config: stricter for authentication endpoints */
const LOGIN_CONFIG: RateLimitConfig = {
  maxAttempts: 5,
  windowMs: 15 * 60 * 1000,
  blockMs: 30 * 60 * 1000,
  progressiveMultiplier: 2,
};

// ---------- Core rate limiter ----------

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetAt: number;
  blockedUntil?: number;
  attemptCount: number;
}

/**
 * Check rate limit for a given key and action.
 * Returns whether the request is allowed, remaining attempts, and reset time.
 *
 * @param key - The rate limit key (e.g., "ip:192.168.1.1" or "user:admin")
 * @param action - The action being rate limited (e.g., "LOGIN", "API")
 * @param config - Rate limit configuration (uses defaults if not specified)
 */
export async function checkRateLimit(
  key: string,
  action: string,
  config: Partial<RateLimitConfig> = {}
): Promise<RateLimitResult> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const now = new Date();
  const windowStart = new Date(now.getTime() - cfg.windowMs);

  try {
    // Find or create the rate limit record
    const existing = await db.rateLimitAttempt.findUnique({
      where: { key_action: { key, action } },
    });

    // If blocked, check if block has expired
    if (existing?.blockedUntil && existing.blockedUntil > now) {
      const remaining = 0;
      return {
        allowed: false,
        remaining,
        resetAt: existing.blockedUntil.getTime(),
        blockedUntil: existing.blockedUntil.getTime(),
        attemptCount: existing.count,
      };
    }

    // If window expired or no record, start fresh
    if (!existing || existing.windowStart < windowStart) {
      const record = await db.rateLimitAttempt.upsert({
        where: { key_action: { key, action } },
        create: {
          key,
          action,
          count: 1,
          windowStart: now,
          blockedUntil: null,
        },
        update: {
          count: 1,
          windowStart: now,
          blockedUntil: null,
        },
      });

      return {
        allowed: true,
        remaining: cfg.maxAttempts - 1,
        resetAt: record.windowStart.getTime() + cfg.windowMs,
        attemptCount: 1,
      };
    }

    // Within window — increment count
    const newCount = existing.count + 1;

    if (newCount > cfg.maxAttempts) {
      // Calculate progressive block duration
      const blocksExceeded = Math.floor((newCount - cfg.maxAttempts) / cfg.maxAttempts);
      const blockDuration = cfg.blockMs * Math.pow(cfg.progressiveMultiplier, blocksExceeded);
      const blockedUntil = new Date(now.getTime() + blockDuration);

      await db.rateLimitAttempt.update({
        where: { key_action: { key, action } },
        data: {
          count: newCount,
          blockedUntil,
        },
      });

      return {
        allowed: false,
        remaining: 0,
        resetAt: blockedUntil.getTime(),
        blockedUntil: blockedUntil.getTime(),
        attemptCount: newCount,
      };
    }

    await db.rateLimitAttempt.update({
      where: { key_action: { key, action } },
      data: { count: newCount },
    });

    return {
      allowed: true,
      remaining: cfg.maxAttempts - newCount,
      resetAt: existing.windowStart.getTime() + cfg.windowMs,
      attemptCount: newCount,
    };
  } catch (err) {
    // Database error — fail open for availability (log but don't block)
    console.error("[rate-limit] Database error, failing open:", err);
    return {
      allowed: true,
      remaining: cfg.maxAttempts,
      resetAt: Date.now() + cfg.windowMs,
      attemptCount: 0,
    };
  }
}

/**
 * Record a failed attempt (increments counter).
 * Use this when counting failures separately from the check.
 */
export async function recordFailure(
  key: string,
  action: string,
  config: Partial<RateLimitConfig> = {}
): Promise<void> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const now = new Date();
  const windowStart = new Date(now.getTime() - cfg.windowMs);

  try {
    const existing = await db.rateLimitAttempt.findUnique({
      where: { key_action: { key, action } },
    });

    if (!existing || existing.windowStart < windowStart) {
      await db.rateLimitAttempt.upsert({
        where: { key_action: { key, action } },
        create: { key, action, count: 1, windowStart: now },
        update: { count: 1, windowStart: now, blockedUntil: null },
      });
    } else {
      await db.rateLimitAttempt.update({
        where: { key_action: { key, action } },
        data: { count: existing.count + 1 },
      });
    }
  } catch (err) {
    console.error("[rate-limit] Failed to record failure:", err);
  }
}

/**
 * Reset rate limit for a key (e.g., after successful login).
 */
export async function resetRateLimit(key: string, action: string): Promise<void> {
  try {
    await db.rateLimitAttempt.deleteMany({
      where: { key, action },
    });
  } catch (err) {
    console.error("[rate-limit] Failed to reset:", err);
  }
}

/**
 * Clean up expired rate limit records.
 * Call periodically (e.g., every hour) to prevent table bloat.
 */
export async function cleanupExpiredRateLimits(): Promise<number> {
  try {
    const result = await db.rateLimitAttempt.deleteMany({
      where: {
        windowStart: {
          lt: new Date(Date.now() - 24 * 60 * 60 * 1000), // older than 24 hours
        },
      },
    });
    return result.count;
  } catch (err) {
    console.error("[rate-limit] Cleanup failed:", err);
    return 0;
  }
}

// ---------- Convenience wrappers ----------

/**
 * Check login rate limit for an IP address.
 * Tracks both IP and username to prevent distributed brute force.
 */
export async function checkLoginRateLimit(
  ip: string,
  username: string
): Promise<{ allowed: boolean; blockedBy: "ip" | "username" | null; retryAfter?: number }> {
  // Check IP-based rate limit
  const ipResult = await checkRateLimit(`ip:${ip}`, "LOGIN", LOGIN_CONFIG);
  if (!ipResult.allowed) {
    return {
      allowed: false,
      blockedBy: "ip",
      retryAfter: ipResult.blockedUntil ? Math.ceil((ipResult.blockedUntil - Date.now()) / 1000) : undefined,
    };
  }

  // Check username-based rate limit (prevents distributed brute force)
  const userResult = await checkRateLimit(`user:${username.toLowerCase()}`, "LOGIN", LOGIN_CONFIG);
  if (!userResult.allowed) {
    return {
      allowed: false,
      blockedBy: "username",
      retryAfter: userResult.blockedUntil ? Math.ceil((userResult.blockedUntil - Date.now()) / 1000) : undefined,
    };
  }

  return { allowed: true, blockedBy: null };
}

/**
 * Record a failed login attempt for both IP and username.
 */
export async function recordLoginFailure(ip: string, username: string): Promise<void> {
  await recordFailure(`ip:${ip}`, "LOGIN", LOGIN_CONFIG);
  await recordFailure(`user:${username.toLowerCase()}`, "LOGIN", LOGIN_CONFIG);
}

/**
 * Reset login rate limits on successful authentication.
 */
export async function resetLoginRateLimit(ip: string, username: string): Promise<void> {
  await resetRateLimit(`ip:${ip}`, "LOGIN");
  await resetRateLimit(`user:${username.toLowerCase()}`, "LOGIN");
}

/**
 * Get rate limit status for a key (for display/debugging).
 */
export async function getRateLimitStatus(
  key: string,
  action: string
): Promise<{ count: number; windowStart: Date; blockedUntil: Date | null } | null> {
  try {
    const record = await db.rateLimitAttempt.findUnique({
      where: { key_action: { key, action } },
    });
    return record
      ? { count: record.count, windowStart: record.windowStart, blockedUntil: record.blockedUntil }
      : null;
  } catch {
    return null;
  }
}

/**
 * Extract client IP from request headers.
 */
export function getClientIp(req: Request): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}
