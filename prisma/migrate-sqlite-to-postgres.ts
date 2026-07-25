/**
 * SQLite to PostgreSQL Migration Script
 *
 * This script migrates data from an existing SQLite database to PostgreSQL.
 * Run after setting up PostgreSQL and updating DATABASE_URL in .env.
 *
 * Usage:
 *   npx tsx prisma/migrate-sqlite-to-postgres.ts
 *
 * Prerequisites:
 *   1. PostgreSQL running and accessible
 *   2. DATABASE_URL in .env points to PostgreSQL
 *   3. SQLite database exists at prisma/db/custom.db
 */

import { PrismaClient } from '@prisma/client'
import { readFileSync, existsSync } from 'fs'
import { join } from 'path'

// SQLite connection for reading source data
const sqlitePrisma = new PrismaClient({
  datasources: {
    db: {
      url: 'file:./db/custom.db',
    },
  },
})

// PostgreSQL connection for writing target data
const postgresPrisma = new PrismaClient()

interface MigrationStats {
  tables: number
  rows: number
  errors: string[]
}

async function migrateTable<T extends Record<string, any>>(
  name: string,
  findMany: () => Promise<T[]>,
  createMany: (data: T[]) => Promise<any>,
  transform?: (item: T) => T
): Promise<number> {
  console.log(`  Migrating ${name}...`)
  try {
    const items = await findMany()
    const transformed = transform ? items.map(transform) : items

    if (transformed.length === 0) {
      console.log(`    → 0 rows (empty)`)
      return 0
    }

    // Batch insert in chunks of 1000
    const chunkSize = 1000
    for (let i = 0; i < transformed.length; i += chunkSize) {
      const chunk = transformed.slice(i, i + chunkSize)
      await createMany(chunk)
    }

    console.log(`    → ${transformed.length} rows migrated`)
    return transformed.length
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    console.error(`    ✗ Error migrating ${name}: ${msg}`)
    return 0
  }
}

async function migrate(): Promise<MigrationStats> {
  const stats: MigrationStats = { tables: 0, rows: 0, errors: [] }

  console.log('Starting SQLite → PostgreSQL migration...\n')

  // Check if SQLite database exists
  const sqlitePath = join(__dirname, 'db', 'custom.db')
  if (!existsSync(sqlitePath)) {
    console.error('SQLite database not found at:', sqlitePath)
    console.error('Nothing to migrate.')
    process.exit(0)
  }

  // Disable foreign key checks during migration
  await postgresPrisma.$executeRawUnsafe('SET session_replication_role = replica;')

  try {
    // Migrate in dependency order (respecting foreign keys)

    // 1. SystemState (singleton)
    stats.rows += await migrateTable(
      'SystemState',
      () => sqlitePrisma.systemState.findMany(),
      (data) => postgresPrisma.systemState.createMany({ data })
    )
    stats.tables++

    // 2. Branches (no dependencies)
    stats.rows += await migrateTable(
      'Branch',
      () => sqlitePrisma.branch.findMany(),
      (data) => postgresPrisma.branch.createMany({ data })
    )
    stats.tables++

    // 3. Users (depends on Branch)
    stats.rows += await migrateTable(
      'User',
      () => sqlitePrisma.user.findMany(),
      (data) => postgresPrisma.user.createMany({ data })
    )
    stats.tables++

    // 4. TwoFactor (depends on User)
    stats.rows += await migrateTable(
      'TwoFactor',
      () => sqlitePrisma.twoFactor.findMany(),
      (data) => postgresPrisma.twoFactor.createMany({ data })
    )
    stats.tables++

    // 5. Sessions (depends on User)
    stats.rows += await migrateTable(
      'Session',
      () => sqlitePrisma.session.findMany(),
      (data) => postgresPrisma.session.createMany({ data })
    )
    stats.tables++

    // 6. Devices (depends on User)
    stats.rows += await migrateTable(
      'Device',
      () => sqlitePrisma.device.findMany(),
      (data) => postgresPrisma.device.createMany({ data })
    )
    stats.tables++

    // 7. Licenses (depends on Device)
    stats.rows += await migrateTable(
      'License',
      () => sqlitePrisma.license.findMany(),
      (data) => postgresPrisma.license.createMany({ data })
    )
    stats.tables++

    // 8. Keys (depends on Branch)
    stats.rows += await migrateTable(
      'Key',
      () => sqlitePrisma.key.findMany(),
      (data) => postgresPrisma.key.createMany({ data })
    )
    stats.tables++

    // 9. Documents (depends on Branch, Key)
    stats.rows += await migrateTable(
      'Document',
      () => sqlitePrisma.document.findMany(),
      (data) => postgresPrisma.document.createMany({ data })
    )
    stats.tables++

    // 10. AuditLogs (depends on User, Branch, Document)
    stats.rows += await migrateTable(
      'AuditLog',
      () => sqlitePrisma.auditLog.findMany(),
      (data) => postgresPrisma.auditLog.createMany({ data })
    )
    stats.tables++

    // 11. Messages (depends on User, Branch)
    stats.rows += await migrateTable(
      'Message',
      () => sqlitePrisma.message.findMany(),
      (data) => postgresPrisma.message.createMany({ data })
    )
    stats.tables++

    // 12. RateLimitAttempts (no dependencies)
    stats.rows += await migrateTable(
      'RateLimitAttempt',
      () => sqlitePrisma.rateLimitAttempt.findMany(),
      (data) => postgresPrisma.rateLimitAttempt.createMany({ data })
    )
    stats.tables++

  } finally {
    // Re-enable foreign key checks
    await postgresPrisma.$executeRawUnsafe('SET session_replication_role = DEFAULT;')
  }

  return stats
}

async function main() {
  try {
    const stats = await migrate()

    console.log('\n' + '='.repeat(50))
    console.log('Migration complete!')
    console.log(`  Tables: ${stats.tables}`)
    console.log(`  Total rows: ${stats.rows}`)

    if (stats.errors.length > 0) {
      console.log(`\n  Errors: ${stats.errors.length}`)
      stats.errors.forEach((e) => console.log(`    - ${e}`))
    }

    console.log('='.repeat(50))
  } catch (error) {
    console.error('\nMigration failed:', error)
    process.exit(1)
  } finally {
    await sqlitePrisma.$disconnect()
    await postgresPrisma.$disconnect()
  }
}

main()
