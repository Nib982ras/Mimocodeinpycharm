import Redis from "ioredis";

/**
 * Redis client with connection pooling and automatic reconnection.
 *
 * Provides distributed caching, rate limiting, and session management.
 * Falls back gracefully to database when Redis is unavailable.
 */

const globalForRedis = globalThis as unknown as {
  redis: Redis | undefined;
};

// ---------- Configuration ----------

interface RedisConfig {
  url: string;
  password?: string;
  keyPrefix: string;
  maxRetriesPerRequest: number;
  retryStrategy(times: number): number | null;
}

function getRedisConfig(): RedisConfig {
  const url = process.env.REDIS_URL || "redis://localhost:6379";
  const password = process.env.REDIS_PASSWORD;
  const keyPrefix = process.env.REDIS_KEY_PREFIX || "secure_exchange:";

  return {
    url,
    password,
    keyPrefix,
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      // Exponential backoff: 100ms, 200ms, 400ms, 800ms, 1600ms, 3200ms
      const delay = Math.min(times * 100, 3200);
      // Stop retrying after 10 attempts
      if (times > 10) {
        console.error("[redis] Max reconnection attempts reached");
        return null;
      }
      return delay;
    },
  };
}

// ---------- Client singleton ----------

function createRedisClient(): Redis {
  const config = getRedisConfig();

  const client = new Redis(config.url, {
    password: config.password,
    keyPrefix: config.keyPrefix,
    maxRetriesPerRequest: config.maxRetriesPerRequest,
    retryStrategy: config.retryStrategy,
    // Enable lazy connect to avoid blocking startup
    lazyConnect: true,
    // Keep alive every 30 seconds
    keepAlive: 30000,
    // Connection timeout
    connectTimeout: 5000,
  });

  // Event handlers
  client.on("connect", () => {
    console.log("[redis] Connected to Redis server");
  });

  client.on("ready", () => {
    console.log("[redis] Redis client ready");
  });

  client.on("error", (err) => {
    console.error("[redis] Connection error:", err.message);
  });

  client.on("close", () => {
    console.log("[redis] Connection closed");
  });

  client.on("reconnecting", (delay: number) => {
    console.log(`[redis] Reconnecting in ${delay}ms...`);
  });

  return client;
}

/**
 * Get or create Redis client singleton.
 * Returns undefined if Redis is not configured or unavailable.
 */
export function getRedis(): Redis | undefined {
  // Skip Redis in browser
  if (typeof window !== "undefined") return undefined;

  // Check if Redis is configured
  if (!process.env.REDIS_URL) {
    return undefined;
  }

  // Return existing client or create new one
  if (!globalForRedis.redis) {
    globalForRedis.redis = createRedisClient();
  }

  return globalForRedis.redis;
}

/**
 * Check if Redis is available and connected.
 */
export async function isRedisAvailable(): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  try {
    await redis.ping();
    return true;
  } catch {
    return false;
  }
}

/**
 * Gracefully disconnect Redis.
 */
export async function disconnectRedis(): Promise<void> {
  if (globalForRedis.redis) {
    await globalForRedis.redis.quit();
    globalForRedis.redis = undefined;
  }
}

// ---------- Helper functions ----------

/**
 * Get a value from Redis with JSON parsing.
 */
export async function redisGet<T>(key: string): Promise<T | null> {
  const redis = getRedis();
  if (!redis) return null;

  try {
    const value = await redis.get(key);
    if (!value) return null;
    return JSON.parse(value) as T;
  } catch {
    return null;
  }
}

/**
 * Set a value in Redis with optional TTL.
 */
export async function redisSet(
  key: string,
  value: unknown,
  ttlSeconds?: number
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  try {
    const serialized = JSON.stringify(value);
    if (ttlSeconds) {
      await redis.setex(key, ttlSeconds, serialized);
    } else {
      await redis.set(key, serialized);
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Delete a key from Redis.
 */
export async function redisDel(key: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  try {
    await redis.del(key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Increment a counter in Redis with optional TTL.
 */
export async function redisIncr(
  key: string,
  ttlSeconds?: number
): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  try {
    const count = await redis.incr(key);
    if (ttlSeconds && count === 1) {
      await redis.expire(key, ttlSeconds);
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Check if a key exists in Redis.
 */
export async function redisExists(key: string): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  try {
    const exists = await redis.exists(key);
    return exists === 1;
  } catch {
    return false;
  }
}

/**
 * Set a key with NX (only if not exists) and TTL.
 * Returns true if the key was set.
 */
export async function redisSetNx(
  key: string,
  value: unknown,
  ttlSeconds: number
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  try {
    const serialized = JSON.stringify(value);
    const result = await redis.setnx(key, serialized);
    if (result === 1) {
      await redis.expire(key, ttlSeconds);
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

/**
 * Get all keys matching a pattern.
 */
export async function redisKeys(pattern: string): Promise<string[]> {
  const redis = getRedis();
  if (!redis) return [];

  try {
    // Remove key prefix for pattern matching
    const prefix = process.env.REDIS_KEY_PREFIX || "secure_exchange:";
    const fullPattern = prefix + pattern;
    const keys = await redis.keys(fullPattern);
    // Remove prefix from results
    return keys.map((key) => key.slice(prefix.length));
  } catch {
    return [];
  }
}

/**
 * Delete all keys matching a pattern.
 */
export async function redisDelPattern(pattern: string): Promise<number> {
  const redis = getRedis();
  if (!redis) return 0;

  try {
    const prefix = process.env.REDIS_KEY_PREFIX || "secure_exchange:";
    const fullPattern = prefix + pattern;
    const keys = await redis.keys(fullPattern);
    if (keys.length === 0) return 0;

    const pipeline = redis.pipeline();
    keys.forEach((key) => pipeline.del(key));
    await pipeline.exec();
    return keys.length;
  } catch {
    return 0;
  }
}

/**
 * Publish a message to a Redis channel.
 */
export async function redisPublish(
  channel: string,
  message: unknown
): Promise<boolean> {
  const redis = getRedis();
  if (!redis) return false;

  try {
    const serialized = JSON.stringify(message);
    await redis.publish(channel, serialized);
    return true;
  } catch {
    return false;
  }
}

/**
 * Subscribe to a Redis channel.
 */
export function redisSubscribe(
  channel: string,
  callback: (message: unknown) => void
): () => void {
  const redis = getRedis();
  if (!redis) return () => {};

  const subscriber = redis.duplicate();
  subscriber.subscribe(channel);

  const handler = (ch: string, message: string) => {
    if (ch === channel) {
      try {
        callback(JSON.parse(message));
      } catch {
        // Ignore parse errors
      }
    }
  };

  subscriber.on("message", handler);

  return () => {
    subscriber.unsubscribe(channel);
    subscriber.removeListener("message", handler);
    subscriber.quit();
  };
}

// Graceful shutdown
if (typeof window === "undefined") {
  process.on("SIGINT", async () => {
    await disconnectRedis();
  });

  process.on("SIGTERM", async () => {
    await disconnectRedis();
  });
}
