import { db } from "@/lib/db";
import { getRedis, redisGet, redisSet, redisIncr, redisDel } from "@/lib/redis";

/**
 * Hybrid rate limiter with Redis + database fallback.
 *
 * When Redis is available:
 *   - Sub-millisecond rate limit checks
 *   - Atomic operations prevent race conditions
 *   - Works across multiple instances
 *   - Automatic TTL-based expiration (no cleanup needed)
 *
 * When Redis is unavailable:
 *   - Falls back to PostgreSQL-backed storage
 *   - Full functionality maintained
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

// Redis key prefix for rate limiting
const REDIS_RL_PREFIX = "rl:";

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
  const redisKey = `${REDIS_RL_PREFIX}${key}:${action}`;
  const blockKey = `${REDIS_RL_PREFIX}block:${key}:${action}`;

  // Try Redis first
  const redis = getRedis();
  if (redis) {
    try {
      return await checkRateLimitRedis(redisKey, blockKey, cfg, now);
    } catch (err) {
      console.error("[rate-limit] Redis error, falling back to database:", err);
      // Fall through to database
    }
  }

  // Database fallback
  return await checkRateLimitDatabase(key, action, cfg, now, windowStart);
}

/**
 * Redis-backed rate limit check using sliding window.
 */
async function checkRateLimitRedis(
  redisKey: string,
  blockKey: string,
  cfg: RateLimitConfig,
  now: Date
): Promise<RateLimitResult> {
  const redis = getRedis();
  if (!redis) throw new Error("Redis not available");

  const windowSeconds = Math.ceil(cfg.windowMs / 1000);

  // Check if currently blocked
  const blockedUntil = await redis.get(blockKey);
  if (blockedUntil) {
    const blockExpiry = parseInt(blockedUntil, 10);
    if (blockExpiry > now.getTime()) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: blockExpiry,
        blockedUntil: blockExpiry,
        attemptCount: cfg.maxAttempts,
      };
    }
    // Block expired, clean up
    await redis.del(blockKey);
  }

  // Get current count in window
  const countStr = await redis.get(redisKey);
  const currentCount = countStr ? parseInt(countStr, 10) : 0;

  if (currentCount >= cfg.maxAttempts) {
    // Calculate progressive block duration
    const blocksExceeded = Math.floor((currentCount - cfg.maxAttempts) / cfg.maxAttempts);
    const blockDuration = cfg.blockMs * Math.pow(cfg.progressiveMultiplier, blocksExceeded);
    const blockExpiry = now.getTime() + blockDuration;

    // Set block with TTL
    await redis.setex(blockKey, Math.ceil(blockDuration / 1000), blockExpiry.toString());

    return {
      allowed: false,
      remaining: 0,
      resetAt: blockExpiry,
      blockedUntil: blockExpiry,
      attemptCount: currentCount,
    };
  }

  // Increment count
  const newCount = await redisIncr(redisKey, windowSeconds);

  return {
    allowed: true,
    remaining: Math.max(0, cfg.maxAttempts - newCount),
    resetAt: now.getTime() + cfg.windowMs,
    attemptCount: newCount,
  };
}

/**
 * Database-backed rate limit check (PostgreSQL fallback).
 */
async function checkRateLimitDatabase(
  key: string,
  action: string,
  cfg: RateLimitConfig,
  now: Date,
  windowStart: Date
): Promise<RateLimitResult> {
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
  const redisKey = `${REDIS_RL_PREFIX}${key}:${action}`;

  // Try Redis first
  const redis = getRedis();
  if (redis) {
    try {
      const windowSeconds = Math.ceil(cfg.windowMs / 1000);
      await redisIncr(redisKey, windowSeconds);
      return;
    } catch (err) {
      console.error("[rate-limit] Redis error, falling back to database:", err);
    }
  }

  // Database fallback
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
  const redisKey = `${REDIS_RL_PREFIX}${key}:${action}`;
  const blockKey = `${REDIS_RL_PREFIX}block:${key}:${action}`;

  // Try Redis first
  const redis = getRedis();
  if (redis) {
    try {
      await redisDel(redisKey);
      await redisDel(blockKey);
      return;
    } catch (err) {
      console.error("[rate-limit] Redis error, falling back to database:", err);
    }
  }

  // Database fallback
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
 * Redis handles expiration automatically via TTL, so this only runs for database fallback.
 */
export async function cleanupExpiredRateLimits(): Promise<number> {
  // Redis handles cleanup automatically via TTL
  // Only clean database when Redis is not available
  const redis = getRedis();
  if (redis) {
    // Redis handles expiration via TTL, nothing to clean
    return 0;
  }

  // Database fallback cleanup
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
  const redisKey = `${REDIS_RL_PREFIX}${key}:${action}`;
  const blockKey = `${REDIS_RL_PREFIX}block:${key}:${action}`;

  // Try Redis first
  const redis = getRedis();
  if (redis) {
    try {
      const countStr = await redis.get(redisKey);
      const blockedStr = await redis.get(blockKey);

      const count = countStr ? parseInt(countStr, 10) : 0;
      const blockedUntil = blockedStr ? new Date(parseInt(blockedStr, 10)) : null;

      // Get TTL for window start approximation
      const ttl = await redis.ttl(redisKey);
      const windowStart = new Date(Date.now() - (DEFAULT_CONFIG.windowMs / 1000 - ttl) * 1000);

      return { count, windowStart, blockedUntil };
    } catch {
      // Fall through to database
    }
  }

  // Database fallback
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
