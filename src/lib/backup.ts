import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Database backup utility.
 *
 * Creates encrypted, integrity-verified backups of the database and vault.
 * Backups are stored in db/backups/ with the following structure:
 *   db/backups/
 *     backup-YYYY-MM-DD-HH-MM-SS/
 *       custom.db.enc       — AES-256-GCM encrypted database
 *       manifest.json       — Backup metadata + checksums
 *       vault/              — Encrypted document blobs (already encrypted at app level)
 *
 * Security properties:
 *   - Database is encrypted at rest in backups (AES-256-GCM)
 *   - All file paths are validated to prevent traversal attacks
 *   - Vault file checksums are verified during restore
 *   - Backup encryption key derived from MASTER_KEY via HKDF
 */

const DB_DIR = path.join(process.cwd(), "db");
const DB_PATH = path.join(DB_DIR, "custom.db");
const VAULT_DIR = path.join(DB_DIR, "vault");
const BACKUP_DIR = path.join(DB_DIR, "backups");
const BACKUP_DB_NAME = "custom.db.enc";

interface BackupManifest {
  id: string;
  timestamp: string;
  databaseChecksum: string;       // checksum of original (unencrypted) DB
  encryptedDatabaseIv?: string;   // IV used for database encryption
  encryptedDatabaseTag?: string;  // auth tag for database encryption
  vaultFiles: Array<{
    path: string;
    checksum: string;
    size: number;
  }>;
  totalSize: number;
}

// ---------- Encryption helpers ----------

/**
 * Derive a backup encryption key from the master key using HKDF.
 * Separate from the key used for document encryption to prevent key reuse.
 */
function deriveBackupKey(): Buffer {
  const masterKeyEnv = process.env.MASTER_KEY;
  if (!masterKeyEnv) {
    throw new Error("MASTER_KEY required for encrypted backups");
  }
  const masterKey = Buffer.from(masterKeyEnv.trim(), "hex");
  const derived = crypto.hkdfSync("sha256", masterKey, Buffer.alloc(16), "secure-exchange-backup/v1", 32);
  return Buffer.from(derived);
}

/**
 * Encrypt a file with AES-256-GCM.
 */
function encryptFile(data: Buffer, key: Buffer): { ciphertext: Buffer; iv: Buffer; tag: Buffer } {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(data), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag() };
}

/**
 * Decrypt a file with AES-256-GCM.
 */
function decryptFile(ciphertext: Buffer, key: Buffer, iv: Buffer, tag: Buffer): Buffer {
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}

// ---------- Path traversal protection ----------

/**
 * Validate that a resolved path stays within the expected base directory.
 * Prevents path traversal attacks via crafted manifest entries.
 */
function validatePathWithinBase(filePath: string, baseDir: string): string {
  const resolved = path.resolve(baseDir, filePath);
  const normalizedBase = path.resolve(baseDir);
  if (!resolved.startsWith(normalizedBase + path.sep) && resolved !== normalizedBase) {
    throw new Error(`Path traversal detected: ${filePath} resolves outside ${baseDir}`);
  }
  return resolved;
}

/**
 * Calculate SHA-256 checksum of a file.
 */
function calculateChecksum(filePath: string): string {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

/**
 * Create an encrypted backup of the database and vault.
 */
export async function createBackup(): Promise<BackupManifest> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupId = `backup-${timestamp}`;
  const backupPath = path.join(BACKUP_DIR, backupId);

  // Ensure backup directory exists
  fs.mkdirSync(backupPath, { recursive: true });
  fs.mkdirSync(path.join(backupPath, "vault"), { recursive: true });

  // Encrypt and copy database
  const dbData = fs.readFileSync(DB_PATH);
  const dbChecksum = crypto.createHash("sha256").update(dbData).digest("hex");

  let encryptedDbPath: string;
  let manifest: BackupManifest;

  if (process.env.MASTER_KEY) {
    // Encrypt database before writing to backup
    const backupKey = deriveBackupKey();
    const { ciphertext, iv, tag } = encryptFile(dbData, backupKey);
    encryptedDbPath = path.join(backupPath, BACKUP_DB_NAME);
    fs.writeFileSync(encryptedDbPath, ciphertext);

    manifest = {
      id: backupId,
      timestamp: new Date().toISOString(),
      databaseChecksum: dbChecksum,
      encryptedDatabaseIv: iv.toString("base64"),
      encryptedDatabaseTag: tag.toString("base64"),
      vaultFiles: [],
      totalSize: ciphertext.length,
    };
  } else {
    // Dev fallback: unencrypted (warned in crypto.ts)
    encryptedDbPath = path.join(backupPath, "custom.db");
    fs.writeFileSync(encryptedDbPath, dbData);

    manifest = {
      id: backupId,
      timestamp: new Date().toISOString(),
      databaseChecksum: dbChecksum,
      vaultFiles: [],
      totalSize: dbData.length,
    };
  }

  // Copy vault files (already encrypted at application level)
  if (fs.existsSync(VAULT_DIR)) {
    const files = fs.readdirSync(VAULT_DIR);
    for (const file of files) {
      const srcPath = path.join(VAULT_DIR, file);
      const destPath = path.join(backupPath, "vault", file);

      if (fs.statSync(srcPath).isFile()) {
        fs.copyFileSync(srcPath, destPath);
        const fileChecksum = calculateChecksum(destPath);
        const fileSize = fs.statSync(destPath).size;
        manifest.vaultFiles.push({
          path: `vault/${file}`,
          checksum: fileChecksum,
          size: fileSize,
        });
        manifest.totalSize += fileSize;
      }
    }
  }

  // Write manifest
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
 * Security checks:
 *   - Path traversal protection on all manifest paths
 *   - Database checksum verification
 *   - Vault file checksum verification
 *   - Encrypted database decryption with master key
 */
export async function restoreBackup(backupId: string): Promise<void> {
  // Validate backupId contains no path traversal
  if (backupId.includes("..") || backupId.includes("/") || backupId.includes("\\")) {
    throw new Error(`Invalid backup ID: ${backupId}`);
  }

  const backupPath = path.join(BACKUP_DIR, backupId);
  validatePathWithinBase(backupPath, BACKUP_DIR);

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

  // Determine database source path (encrypted or legacy unencrypted)
  const encryptedDbPath = path.join(backupPath, BACKUP_DB_NAME);
  const legacyDbPath = path.join(backupPath, "custom.db");
  const dbSourcePath = fs.existsSync(encryptedDbPath) ? encryptedDbPath : legacyDbPath;

  if (!fs.existsSync(dbSourcePath)) {
    throw new Error("Backup database file not found");
  }

  // Verify and restore database
  if (manifest.encryptedDatabaseIv && manifest.encryptedDatabaseTag && process.env.MASTER_KEY) {
    // Encrypted backup: decrypt and verify checksum
    const backupKey = deriveBackupKey();
    const iv = Buffer.from(manifest.encryptedDatabaseIv, "base64");
    const tag = Buffer.from(manifest.encryptedDatabaseTag, "base64");
    const ciphertext = fs.readFileSync(dbSourcePath);

    let dbData: Buffer;
    try {
      dbData = decryptFile(ciphertext, backupKey, iv, tag);
    } catch {
      throw new Error("Backup database decryption failed — key mismatch or corrupted backup");
    }

    // Verify checksum of decrypted data
    const dataChecksum = crypto.createHash("sha256").update(dbData).digest("hex");
    if (dataChecksum !== manifest.databaseChecksum) {
      throw new Error("Backup database checksum mismatch after decryption — backup may be corrupted");
    }

    // Create safety backup of current state before restore
    console.log("[backup] Creating safety backup before restore...");
    await createBackup();

    // Restore
    fs.writeFileSync(DB_PATH, dbData);
  } else {
    // Unencrypted backup: verify checksum directly
    const currentChecksum = calculateChecksum(dbSourcePath);
    if (currentChecksum !== manifest.databaseChecksum) {
      throw new Error("Backup database checksum mismatch — backup may be corrupted");
    }

    console.log("[backup] Creating safety backup before restore...");
    await createBackup();

    fs.copyFileSync(dbSourcePath, DB_PATH);
  }

  // Restore vault files WITH path traversal protection AND checksum verification
  for (const file of manifest.vaultFiles) {
    // Validate path stays within backup directory
    const validatedSrcPath = validatePathWithinBase(
      path.join(backupPath, file.path),
      backupPath
    );

    // Validate destination stays within DB_DIR
    const validatedDestPath = validatePathWithinBase(
      path.join(DB_DIR, file.path),
      DB_DIR
    );

    if (fs.existsSync(validatedSrcPath)) {
      // Verify vault file checksum before restore
      const fileChecksum = calculateChecksum(validatedSrcPath);
      if (fileChecksum !== file.checksum) {
        console.warn(`[backup] WARNING: Vault file checksum mismatch: ${file.path} — skipping`);
        continue;
      }

      fs.mkdirSync(path.dirname(validatedDestPath), { recursive: true });
      fs.copyFileSync(validatedSrcPath, validatedDestPath);
    } else {
      console.warn(`[backup] WARNING: Vault file missing in backup: ${file.path}`);
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
      // Validate path before deletion
      validatePathWithinBase(backupPath, BACKUP_DIR);
      if (fs.existsSync(backupPath)) {
        fs.rmSync(backupPath, { recursive: true, force: true });
        removed++;
      }
    }
  }

  return removed;
}
