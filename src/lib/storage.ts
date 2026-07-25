/**
 * Document ciphertext storage with pluggable backends.
 *
 * Supports:
 *   - Local filesystem (default, development)
 *   - S3-compatible object storage (production)
 *
 * Configure via environment variables:
 *   - STORAGE_BACKEND: "local" (default) or "s3"
 *   - S3_BUCKET, S3_REGION, etc. for S3 configuration
 *
 * SECURITY: All storage operations validate paths to prevent traversal attacks.
 */

import { getStorageBackend } from "./storage-abstraction";

/**
 * Ensure the storage directory exists (local backend only).
 * No-op for S3 backend.
 */
export function ensureStorageDir(): void {
  const backend = getStorageBackend();
  if (backend.getBackendType() === "local") {
    // Local backend handles directory creation internally
  }
}

/** Persist an encrypted ciphertext blob and return its storage key. */
export async function storeCiphertext(docId: string, ciphertext: Buffer): Promise<string> {
  const backend = getStorageBackend();
  return backend.store(docId, ciphertext);
}

/** Read a ciphertext blob from storage. */
export async function readCiphertext(key: string): Promise<Buffer> {
  const backend = getStorageBackend();
  return backend.read(key);
}

/** Delete a ciphertext blob (used on document deletion). */
export async function deleteCiphertext(key: string): Promise<void> {
  const backend = getStorageBackend();
  return backend.delete(key);
}

/**
 * Synchronous versions for backward compatibility.
 * These are deprecated - use async versions instead.
 *
 * @deprecated Use storeCiphertext, readCiphertext, deleteCiphertext instead
 */
import fs from "fs";
import path from "path";

const STORAGE_DIR = path.resolve(process.cwd(), "db", "vault");

function ensureStorageDirSync(): void {
  if (!fs.existsSync(STORAGE_DIR)) {
    fs.mkdirSync(STORAGE_DIR, { recursive: true });
  }
}

function validatePathSync(relPath: string): string {
  const absPath = path.resolve(process.cwd(), "db", relPath);
  const vaultDir = path.resolve(STORAGE_DIR);

  if (!absPath.startsWith(vaultDir + path.sep) && absPath !== vaultDir) {
    throw new Error(`Path traversal detected: ${relPath}`);
  }

  if (relPath.includes("..") || relPath.includes("~")) {
    throw new Error(`Invalid path characters: ${relPath}`);
  }

  return absPath;
}

/** @deprecated Use async storeCiphertext instead */
export function storeCiphertextSync(docId: string, ciphertext: Buffer): string {
  ensureStorageDirSync();

  if (!/^[a-f0-9-]+$/i.test(docId)) {
    throw new Error(`Invalid document ID: ${docId}`);
  }

  const relPath = path.join("vault", `${docId}.bin`);
  const absPath = path.join(STORAGE_DIR, `${docId}.bin`);
  fs.writeFileSync(absPath, ciphertext);
  return relPath;
}

/** @deprecated Use async readCiphertext instead */
export function readCiphertextSync(relPath: string): Buffer {
  const absPath = validatePathSync(relPath);
  return fs.readFileSync(absPath);
}

/** @deprecated Use async deleteCiphertext instead */
export function deleteCiphertextSync(relPath: string): void {
  const absPath = validatePathSync(relPath);
  if (fs.existsSync(absPath)) {
    fs.unlinkSync(absPath);
  }
}
