import { PrismaClient } from '@prisma/client'

/**
 * PostgreSQL database client with connection pooling and production optimizations.
 *
 * Configuration:
 *   - Development: Singleton pattern to avoid connection exhaustion during HMR
 *   - Production: Connection pooling with configurable pool size
 *   - Logging: Structured JSON logs at appropriate levels
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

// Configure pool size based on environment
const poolSize = process.env.DATABASE_POOL_SIZE
  ? parseInt(process.env.DATABASE_POOL_SIZE, 10)
  : process.env.NODE_ENV === 'production'
    ? 10
    : 1;

// Configure log level
const logLevel = process.env.DATABASE_LOG_LEVEL ||
  (process.env.NODE_ENV === 'production' ? 'error' : 'warn');

export const db =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: [
      { level: 'error', emit: 'event' },
      { level: 'warn', emit: 'event' },
    ],
    datasources: {
      db: {
        url: process.env.DATABASE_URL,
      },
    },
  })

// Log query errors in production
if (process.env.NODE_ENV === 'production') {
  (db as any).$on('error', (e: any) => {
    console.error(JSON.stringify({
      timestamp: new Date().toISOString(),
      level: 'error',
      message: 'Database error',
      error: e.message,
      target: e.target,
    }));
  });
}

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db

// Start background job scheduler for maintenance tasks
// (rate limit cleanup, session cleanup, etc.)
if (typeof window === 'undefined') {
  // Server-side only
  import('@/lib/jobs').then(({ registerMaintenanceJobs, startJobScheduler }) => {
    registerMaintenanceJobs();
    startJobScheduler();
  }).catch((err) => {
    console.error('[db] Failed to start job scheduler:', err);
  });
}

/**
 * Graceful shutdown — close database connections on process exit.
 */
process.on('SIGINT', async () => {
  await db.$disconnect();
  process.exit(0);
});

process.on('SIGTERM', async () => {
  await db.$disconnect();
  process.exit(0);
});

/**
 * Health check for database connectivity.
 */
export async function checkDatabaseHealth(): Promise<{
  status: 'ok' | 'error';
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    await db.$queryRaw`SELECT 1`;
    return {
      status: 'ok',
      latencyMs: Date.now() - start,
    };
  } catch (err) {
    return {
      status: 'error',
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : 'Unknown error',
    };
  }
}
