/**
 * In-memory caching layer with TTL support.
 *
 * Production note: For multi-instance deployments, replace with Redis.
 * This implementation is suitable for single-instance deployments.
 *
 * Features:
 *   - TTL-based expiration
 *   - LRU eviction (configurable max size)
 *   - Cache statistics
 *   - Pattern-based invalidation
 *   - Cache warming support
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  createdAt: number;
  hits: number;
}

interface CacheStats {
  hits: number;
  misses: number;
  sets: number;
  deletes: number;
  evictions: number;
  size: number;
}

export class Cache<T = unknown> {
  private store = new Map<string, CacheEntry<T>>();
  private stats: CacheStats = {
    hits: 0,
    misses: 0,
    sets: 0,
    deletes: 0,
    evictions: 0,
    size: 0,
  };

  constructor(
    private maxSize: number = 1000,
    private defaultTtlMs: number = 5 * 60 * 1000 // 5 minutes
  ) {
    // Cleanup expired entries every minute
    setInterval(() => this.cleanup(), 60 * 1000);
  }

  /**
   * Get a value from cache.
   * Returns undefined if not found or expired.
   */
  get(key: string): T | undefined {
    const entry = this.store.get(key);

    if (!entry) {
      this.stats.misses++;
      return undefined;
    }

    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      this.stats.misses++;
      this.stats.size--;
      return undefined;
    }

    entry.hits++;
    this.stats.hits++;
    return entry.value;
  }

  /**
   * Set a value in cache with optional TTL.
   */
  set(key: string, value: T, ttlMs?: number): void {
    // Evict if at capacity
    if (this.store.size >= this.maxSize && !this.store.has(key)) {
      this.evict();
    }

    const ttl = ttlMs ?? this.defaultTtlMs;
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttl,
      createdAt: Date.now(),
      hits: 0,
    });

    this.stats.sets++;
    this.stats.size = this.store.size;
  }

  /**
   * Delete a key from cache.
   */
  delete(key: string): boolean {
    const existed = this.store.delete(key);
    if (existed) {
      this.stats.deletes++;
      this.stats.size--;
    }
    return existed;
  }

  /**
   * Delete all keys matching a pattern.
   */
  invalidatePattern(pattern: string): number {
    let count = 0;
    const regex = new RegExp(pattern);

    for (const key of this.store.keys()) {
      if (regex.test(key)) {
        this.store.delete(key);
        count++;
      }
    }

    this.stats.deletes += count;
    this.stats.size = this.store.size;
    return count;
  }

  /**
   * Check if a key exists and is not expired.
   */
  has(key: string): boolean {
    return this.get(key) !== undefined;
  }

  /**
   * Get cache statistics.
   */
  getStats(): CacheStats & { hitRate: number } {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? this.stats.hits / total : 0,
    };
  }

  /**
   * Clear all entries.
   */
  clear(): void {
    this.store.clear();
    this.stats.size = 0;
  }

  /**
   * Evict least recently used entry.
   */
  private evict(): void {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;

    for (const [key, entry] of this.store) {
      if (entry.createdAt < oldestTime) {
        oldestTime = entry.createdAt;
        oldestKey = key;
      }
    }

    if (oldestKey) {
      this.store.delete(oldestKey);
      this.stats.evictions++;
      this.stats.size--;
    }
  }

  /**
   * Remove expired entries.
   */
  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now > entry.expiresAt) {
        this.store.delete(key);
        this.stats.size--;
      }
    }
  }
}

// ============================================================================
// Application-specific caches
// ============================================================================

/** System state cache (30 second TTL) */
export const systemStateCache = new Cache<{
  active: boolean;
  lockdown: boolean;
  lockdownReason: string | null;
}>(10, 30 * 1000);

/** User session cache (1 minute TTL) */
export const sessionCache = new Cache<{
  userId: string;
  role: string;
  branchId: string | null;
}>(500, 60 * 1000);

/** Branch list cache (5 minute TTL) */
export const branchCache = new Cache<Array<{
  id: string;
  code: string;
  name: string;
  type: string;
}>>(50, 5 * 60 * 1000);

/** Dashboard stats cache (1 minute TTL) */
export const dashboardCache = new Cache<unknown>(10, 60 * 1000);

/**
 * Cache key builder for consistent key generation.
 */
export function cacheKey(...parts: (string | number | undefined | null)[]): string {
  return parts.filter(Boolean).join(":");
}

/**
 * Get-or-set pattern for cache.
 * Returns cached value if available, otherwise calls the factory and caches the result.
 */
export async function getOrSet<T>(
  cache: Cache<T>,
  key: string,
  factory: () => Promise<T>,
  ttlMs?: number
): Promise<T> {
  const cached = cache.get(key);
  if (cached !== undefined) {
    return cached;
  }

  const value = await factory();
  cache.set(key, value, ttlMs);
  return value;
}
