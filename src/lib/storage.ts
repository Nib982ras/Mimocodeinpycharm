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
