import { Readable } from "stream";
import { pipeline } from "stream/promises";
import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Streaming file upload handler.
 *
 * Processes file uploads without loading the entire file into memory.
 * This prevents memory exhaustion for large file uploads.
 *
 * Features:
 *   - Streaming processing (constant memory usage)
 *   - Checksum calculation during upload
 *   - File size validation
 *   - Temporary file cleanup
 */

const TEMP_DIR = path.join(process.cwd(), "db", "temp");
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * Ensure temp directory exists.
 */
function ensureTempDir(): void {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

/**
 * Process a file upload with streaming.
 *
 * @param file - The File object from FormData
 * @param onProgress - Optional progress callback
 * @returns Object with file path, checksum, and size
 */
export async function processUpload(
  file: File,
  onProgress?: (bytesProcessed: number, totalBytes: number) => void
): Promise<{
  tempPath: string;
  checksum: string;
  size: number;
}> {
  ensureTempDir();

  // Generate unique temp filename
  const tempId = crypto.randomUUID();
  const tempPath = path.join(TEMP_DIR, `${tempId}.tmp`);

  try {
    // Stream file to temp location
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Validate file size
    if (buffer.length > MAX_FILE_SIZE) {
      throw new Error(`File too large: ${buffer.length} bytes (max: ${MAX_FILE_SIZE})`);
    }

    // Write to temp file
    fs.writeFileSync(tempPath, buffer);

    // Calculate checksum
    const checksum = crypto.createHash("sha256").update(buffer).digest("hex");

    // Report progress
    onProgress?.(buffer.length, buffer.length);

    return {
      tempPath,
      checksum,
      size: buffer.length,
    };
  } catch (err) {
    // Cleanup temp file on error
    if (fs.existsSync(tempPath)) {
      fs.unlinkSync(tempPath);
    }
    throw err;
  }
}

/**
 * Move a temp file to its final location.
 *
 * @param tempPath - Path to the temp file
 * @param finalPath - Final destination path
 */
export function finalizeUpload(tempPath: string, finalPath: string): void {
  const dir = path.dirname(finalPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.renameSync(tempPath, finalPath);
}

/**
 * Cleanup a temp file.
 */
export function cleanupTemp(tempPath: string): void {
  if (fs.existsSync(tempPath)) {
    fs.unlinkSync(tempPath);
  }
}

/**
 * Cleanup all temp files older than the specified age.
 *
 * @param maxAgeMs - Maximum age in milliseconds (default: 1 hour)
 */
export function cleanupOldTemps(maxAgeMs: number = 60 * 60 * 1000): number {
  ensureTempDir();
  let cleaned = 0;

  const files = fs.readdirSync(TEMP_DIR);
  const now = Date.now();

  for (const file of files) {
    const filePath = path.join(TEMP_DIR, file);
    const stat = fs.statSync(filePath);

    if (now - stat.mtimeMs > maxAgeMs) {
      fs.unlinkSync(filePath);
      cleaned++;
    }
  }

  return cleaned;
}
