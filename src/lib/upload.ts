import { Readable } from "stream";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * Streaming file upload handler.
 *
 * Processes file uploads using Node.js streams for constant memory usage,
 * regardless of file size. This prevents memory exhaustion attacks.
 *
 * Features:
 *   - True streaming (constant memory usage ~1MB buffer)
 *   - Checksum calculation during upload (incremental SHA-256)
 *   - File size validation with early abort
 *   - Temporary file cleanup on success and error
 *   - Symlink detection in temp cleanup
 */

const TEMP_DIR = path.join(process.cwd(), "db", "temp");
const MAX_FILE_SIZE = 100 * 1024 * 1024; // 100MB

/**
 * Ensure temp directory exists with secure permissions.
 */
function ensureTempDir(): void {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Process a file upload with true streaming.
 *
 * Uses Readable.fromWeb() + pipeline() to stream the file to disk
 * without ever loading the full content into memory. The SHA-256
 * checksum is computed incrementally during the stream.
 *
 * @param file - The File object from FormData
 * @param onProgress - Optional progress callback (called with bytes processed)
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

  // Validate file size before streaming
  if (file.size > MAX_FILE_SIZE) {
    throw new Error(`File too large: ${file.size} bytes (max: ${MAX_FILE_SIZE})`);
  }

  let totalBytesWritten = 0;
  let bytesSinceLastProgress = 0;
  const hash = crypto.createHash("sha256");

  try {
    // Get a Web ReadableStream and convert to Node.js Readable
    const webStream = file.stream();
    const nodeStream = Readable.fromWeb(webStream as any);

    const writeStream = createWriteStream(tempPath);

    // Track bytes for size validation and progress
    nodeStream.on("data", (chunk: Buffer) => {
      totalBytesWritten += chunk.length;
      bytesSinceLastProgress += chunk.length;

      // Enforce size limit during streaming (abort early)
      if (totalBytesWritten > MAX_FILE_SIZE) {
        nodeStream.destroy(new Error(`File exceeds size limit of ${MAX_FILE_SIZE} bytes`));
        return;
      }

      // Update incremental hash
      hash.update(chunk);

      // Report progress every ~1MB to avoid callback flooding
      if (bytesSinceLastProgress >= 1024 * 1024 || totalBytesWritten === file.size) {
        onProgress?.(totalBytesWritten, file.size);
        bytesSinceLastProgress = 0;
      }
    });

    // Pipeline handles cleanup on error (closes streams, removes partial file)
    await pipeline(nodeStream, writeStream);

    // Final size check (belt-and-suspenders)
    if (totalBytesWritten > MAX_FILE_SIZE) {
      fs.unlinkSync(tempPath);
      throw new Error(`File exceeds size limit of ${MAX_FILE_SIZE} bytes`);
    }

    // Final progress report
    onProgress?.(totalBytesWritten, totalBytesWritten);

    return {
      tempPath,
      checksum: hash.digest("hex"),
      size: totalBytesWritten,
    };
  } catch (err) {
    // Cleanup temp file on error
    if (fs.existsSync(tempPath)) {
      try { fs.unlinkSync(tempPath); } catch { /* best effort */ }
    }
    throw err;
  }
}

/**
 * Move a temp file to its final location.
 * Validates that tempPath is actually in the temp directory.
 *
 * @param tempPath - Path to the temp file
 * @param finalPath - Final destination path
 */
export function finalizeUpload(tempPath: string, finalPath: string): void {
  // Validate tempPath is in the expected temp directory
  const resolvedTemp = path.resolve(tempPath);
  const resolvedTempDir = path.resolve(TEMP_DIR);
  if (!resolvedTemp.startsWith(resolvedTempDir + path.sep)) {
    throw new Error("Invalid temp file path: path traversal detected");
  }

  const dir = path.dirname(finalPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.renameSync(tempPath, finalPath);
}

/**
 * Cleanup a temp file. Validates path before deletion.
 */
export function cleanupTemp(tempPath: string): void {
  // Validate path is in temp directory
  const resolvedTemp = path.resolve(tempPath);
  const resolvedTempDir = path.resolve(TEMP_DIR);
  if (!resolvedTemp.startsWith(resolvedTempDir + path.sep)) {
    throw new Error("Invalid temp file path: path traversal detected");
  }

  if (fs.existsSync(resolvedTemp)) {
    fs.unlinkSync(resolvedTemp);
  }
}

/**
 * Cleanup all temp files older than the specified age.
 * Detects and skips symlinks to prevent symlink-based attacks.
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

    try {
      // Use lstat to detect symlinks — never follow them
      const stat = fs.lstatSync(filePath);

      // Skip symlinks entirely (potential symlink attack)
      if (stat.isSymbolicLink()) {
        console.warn(`[upload] Skipping symlink in temp directory: ${file}`);
        continue;
      }

      if (now - stat.mtimeMs > maxAgeMs) {
        fs.unlinkSync(filePath);
        cleaned++;
      }
    } catch {
      // Skip files we can't stat/delete
    }
  }

  return cleaned;
}
