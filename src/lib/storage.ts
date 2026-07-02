import fs from "fs";
import path from "path";

/**
 * On-disk storage for encrypted document ciphertext blobs.
 * Each document's ciphertext is persisted as a file; metadata lives in the DB.
 */

const STORAGE_DIR = path.join(process.cwd(), "db", "vault");

export function ensureStorageDir(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

/** Persist an encrypted ciphertext blob and return its relative storage path. */
export function storeCiphertext(docId: string, ciphertext: Buffer): string {
  ensureStorageDir();
  const relPath = path.join("vault", `${docId}.bin`);
  const absPath = path.join(STORAGE_DIR, `${docId}.bin`);
  fs.writeFileSync(absPath, ciphertext);
  return relPath;
}

/** Read a ciphertext blob from disk. */
export function readCiphertext(relPath: string): Buffer {
  const absPath = path.join(process.cwd(), "db", relPath);
  return fs.readFileSync(absPath);
}

/** Delete a ciphertext blob (used on document deletion). */
export function deleteCiphertext(relPath: string): void {
  const absPath = path.join(process.cwd(), "db", relPath);
  if (fs.existsSync(absPath)) {
    fs.unlinkSync(absPath);
  }
}
