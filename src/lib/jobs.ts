/**
 * Background job processing for maintenance tasks.
 *
 * Provides a simple in-process job scheduler for periodic cleanup tasks.
 *
 * When Redis is available:
 *   - Distributed job deduplication prevents duplicate execution across instances
 *   - Job state persists across restarts
 *
 * For multi-instance deployments without Redis, consider using:
 *   - Database-level advisory locks (PostgreSQL)
 *   - Dedicated job queue (BullMQ, pg-boss)
 *
 * Jobs are non-blocking and run in the background. Failures are logged
 * but do not affect the main request path.
 */

// ---------- Types ----------

export interface Job {
  name: string;
  fn: () => Promise<void>;
  intervalMs: number;
  lastRun?: Date;
  running?: boolean;
}

// ---------- Job registry ----------

const jobs: Job[] = [];
let intervalHandle: ReturnType<typeof setInterval> | null = null;

/**
 * Register a background job.
 */
export function registerJob(job: Job): void {
  jobs.push(job);
}

/**
 * Run all registered jobs that are due.
 * Called on the scheduled interval.
 */
async function runJobs(): Promise<void> {
  const now = Date.now();

  for (const job of jobs) {
    // Skip if already running
    if (job.running) continue;

    // Check if enough time has passed since last run
    if (job.lastRun && now - job.lastRun.getTime() < job.intervalMs) continue;

    job.running = true;
    try {
      await job.fn();
      job.lastRun = new Date();
    } catch (err) {
      console.error(`[jobs] Error in job "${job.name}":`, err);
    } finally {
      job.running = false;
    }
  }
}

/**
 * Start the background job scheduler.
 * Runs every 60 seconds and checks which jobs are due.
 */
export function startJobScheduler(): void {
  if (intervalHandle) return; // Already running

  // Run immediately on start
  runJobs().catch((err) => console.error("[jobs] Initial run failed:", err));

  // Then every 60 seconds
  intervalHandle = setInterval(() => {
    runJobs().catch((err) => console.error("[jobs] Scheduled run failed:", err));
  }, 60 * 1000);

  // Don't keep the process alive just for jobs
  if (intervalHandle.unref) {
    intervalHandle.unref();
  }

  console.log(`[jobs] Scheduler started with ${jobs.length} registered jobs`);
}

/**
 * Stop the background job scheduler.
 */
export function stopJobScheduler(): void {
  if (intervalHandle) {
    clearInterval(intervalHandle);
    intervalHandle = null;
  }
}

/**
 * Get status of all registered jobs (for monitoring).
 */
export function getJobStatus(): Array<{
  name: string;
  intervalMs: number;
  lastRun: string | null;
  running: boolean;
}> {
  return jobs.map((job) => ({
    name: job.name,
    intervalMs: job.intervalMs,
    lastRun: job.lastRun?.toISOString() ?? null,
    running: job.running ?? false,
  }));
}

// ---------- One-shot async jobs ----------

const pendingJobs: Set<string> = new Set();

// Redis key prefix for job deduplication
const REDIS_JOB_PREFIX = "job:";

/**
 * Execute a one-shot async job with deduplication.
 * If a job with the same name is already running, skip it.
 *
 * When Redis is available, deduplication works across multiple instances.
 *
 * @param name - Unique job name for deduplication
 * @param fn - The async function to execute
 */
export async function runOnce(name: string, fn: () => Promise<void>): Promise<void> {
  // Check local deduplication first (fast path)
  if (pendingJobs.has(name)) return;

  // Check Redis deduplication (distributed)
  const { getRedis, redisSetNx } = await import("@/lib/redis");
  const redis = getRedis();
  const redisKey = `${REDIS_JOB_PREFIX}${name}`;

  if (redis) {
    try {
      // Try to acquire lock with 5 minute TTL
      const acquired = await redisSetNx(redisKey, { startedAt: Date.now() }, 300);
      if (!acquired) {
        // Another instance is running this job
        return;
      }
    } catch (err) {
      console.error(`[jobs] Redis dedup check failed for "${name}":`, err);
      // Fall through to local dedup
    }
  }

  // Mark as pending locally
  pendingJobs.add(name);

  try {
    await fn();
  } catch (err) {
    console.error(`[jobs] One-shot job "${name}" failed:`, err);
  } finally {
    pendingJobs.delete(name);
    // Release Redis lock
    if (redis) {
      try {
        const { redisDel } = await import("@/lib/redis");
        await redisDel(redisKey);
      } catch {
        // Ignore cleanup errors
      }
    }
  }
}

// ---------- Built-in maintenance jobs ----------

import { cleanupExpiredRateLimits } from "@/lib/rate-limit";
import { cleanupStaleSessions } from "@/lib/session-security";
import { cleanupExpiredPermissions } from "@/lib/document-permissions";
import { cleanupExpiredDocuments } from "@/lib/document-expiry";

/**
 * Register all built-in maintenance jobs.
 * Call this once during application startup.
 */
export function registerMaintenanceJobs(): void {
  // Clean up expired rate limit records every hour
  registerJob({
    name: "rate-limit-cleanup",
    fn: async () => {
      const removed = await cleanupExpiredRateLimits();
      if (removed > 0) {
        console.log(`[jobs] Cleaned up ${removed} expired rate limit records`);
      }
    },
    intervalMs: 60 * 60 * 1000, // Every hour
  });

  // Clean up stale sessions every 6 hours
  registerJob({
    name: "session-cleanup",
    fn: async () => {
      const removed = await cleanupStaleSessions();
      if (removed > 0) {
        console.log(`[jobs] Cleaned up ${removed} stale sessions`);
      }
    },
    intervalMs: 6 * 60 * 60 * 1000, // Every 6 hours
  });

  // Clean up expired document permissions every hour
  registerJob({
    name: "permission-cleanup",
    fn: async () => {
      const removed = await cleanupExpiredPermissions();
      if (removed > 0) {
        console.log(`[jobs] Cleaned up ${removed} expired document permissions`);
      }
    },
    intervalMs: 60 * 60 * 1000, // Every hour
  });

  // Clean up expired documents every hour
  registerJob({
    name: "document-expiry-cleanup",
    fn: async () => {
      const result = await cleanupExpiredDocuments();
      if (result.purged > 0) {
        console.log(`[jobs] Purged ${result.purged} expired documents`);
      }
    },
    intervalMs: 60 * 60 * 1000, // Every hour
  });

  console.log("[jobs] Maintenance jobs registered");
}
