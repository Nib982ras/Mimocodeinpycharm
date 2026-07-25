import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Database backup utility.
 *
 * Creates timestamped backups of the SQLite database and vault directory.
 * Backups are stored in db/backups/ with the following structure:
 *   db/backups/
 *     backup-YYYY-MM-DD-HH-MM-SS/
 *       custom.db           — SQLite database copy
 *       vault/              — Encrypted document blobs
 *       manifest.json       — Backup metadata + checksums
 *
 * Usage:
 *   import { createBackup, listBackups, restoreBackup } from "@/lib/backup";
 *
 *   // Create a backup
 *   const backup = await createBackup();
 *
 *   // List available backups
 *   const backups = await listBackups();
 *
 *   // Restore from backup
 *   await restoreBackup(backup.id);
 */

const DB_DIR = path.join(process.cwd(), "db");
const DB_PATH = path.join(DB_DIR, "custom.db");
const VAULT_DIR = path.join(DB_DIR, "vault");
const BACKUP_DIR = path.join(DB_DIR, "backups");

interface BackupManifest {
  id: string;
  timestamp: string;
  databaseChecksum: string;
  vaultFiles: Array<{
    path: string;
    checksum: string;
    size: number;
  }>;
  totalSize: number;
}

/**
 * Calculate SHA-256 checksum of a file.
 */
function calculateChecksum(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Create a backup of the database and vault.
 */
export async function createBackup(): Promise<BackupManifest> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupId = `backup-${timestamp}`;
  const backupPath = path.join(BACKUP_DIR, backupId);

  // Ensure backup directory exists
  fs.mkdirSync(backupPath, { recursive: true });
  fs.mkdirSync(path.join(backupPath, "vault"), { recursive: true });

  // Copy database
  const dbChecksum = calculateChecksum(DB_PATH);
  fs.copyFileSync(DB_PATH, path.join(backupPath, "custom.db"));

  // Copy vault files
  const vaultFiles: BackupManifest["vaultFiles"] = [];
  if (fs.existsSync(VAULT_DIR)) {
    const files = fs.readdirSync(VAULT_DIR);
    for (const file of files) {
      const srcPath = path.join(VAULT_DIR, file);
      const destPath = path.join(backupPath, "vault", file);

      if (fs.statSync(srcPath).isFile()) {
        fs.copyFileSync(srcPath, destPath);
        vaultFiles.push({
          path: `vault/${file}`,
          checksum: calculateChecksum(destPath),
          size: fs.statSync(destPath).size,
        });
      }
    }
  }

  // Calculate total size
  let totalSize = fs.statSync(path.join(backupPath, "custom.db")).size;
  for (const file of vaultFiles) {
    totalSize += file.size;
  }

  // Write manifest
  const manifest: BackupManifest = {
    id: backupId,
    timestamp: new Date().toISOString(),
    databaseChecksum: dbChecksum,
    vaultFiles,
    totalSize,
  };

  fs.writeFileSync(
    path.join(backupPath, "manifest.json"),
    JSON.stringify(manifest, null, 2)
  );

  return manifest;
}

/**
 * List available backups.
 */
export async function listBackups(): Promise<BackupManifest[]> {
  if (!fs.existsSync(BACKUP_DIR)) {
    return [];
  }

  const backups: BackupManifest[] = [];
  const entries = fs.readdirSync(BACKUP_DIR);

  for (const entry of entries) {
    const manifestPath = path.join(BACKUP_DIR, entry, "manifest.json");
    if (fs.existsSync(manifestPath)) {
      try {
        const manifest = JSON.parse(
          fs.readFileSync(manifestPath, "utf8")
        ) as BackupManifest;
        backups.push(manifest);
      } catch {
        // Skip corrupted backups
      }
    }
  }

  return backups.sort(
    (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
  );
}

/**
 * Restore from a backup.
 *
 * WARNING: This will overwrite the current database and vault.
 * The current state is backed up before restore.
 */
export async function restoreBackup(backupId: string): Promise<void> {
  const backupPath = path.join(BACKUP_DIR, backupId);

  if (!fs.existsSync(backupPath)) {
    throw new Error(`Backup not found: ${backupId}`);
  }

  // Verify manifest
  const manifestPath = path.join(backupPath, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`Backup manifest not found: ${backupId}`);
  }

  const manifest = JSON.parse(
    fs.readFileSync(manifestPath, "utf8")
  ) as BackupManifest;

  // Verify database checksum
  const currentChecksum = calculateChecksum(
    path.join(backupPath, "custom.db")
  );
  if (currentChecksum !== manifest.databaseChecksum) {
    throw new Error("Backup database checksum mismatch — backup may be corrupted");
  }

  // Create a safety backup of current state before restore
  console.log("[backup] Creating safety backup before restore...");
  await createBackup();

  // Restore database
  fs.copyFileSync(path.join(backupPath, "custom.db"), DB_PATH);

  // Restore vault files
  for (const file of manifest.vaultFiles) {
    const srcPath = path.join(backupPath, file.path);
    const destPath = path.join(DB_DIR, file.path);

    if (fs.existsSync(srcPath)) {
      fs.mkdirSync(path.dirname(destPath), { recursive: true });
      fs.copyFileSync(srcPath, destPath);
    }
  }

  console.log(`[backup] Restored from backup: ${backupId}`);
}

/**
 * Clean up old backups, keeping only the most recent N.
 */
export async function cleanupBackups(keepCount: number = 7): Promise<number> {
  const backups = await listBackups();
  let removed = 0;

  if (backups.length > keepCount) {
    const toRemove = backups.slice(keepCount);
    for (const backup of toRemove) {
      const backupPath = path.join(BACKUP_DIR, backup.id);
      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath, { recursive: true, force: true });
        removed++;
      }
    }
  }

  return removed;
}
