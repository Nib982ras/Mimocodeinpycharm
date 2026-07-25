import fs from "fs";
import path from "path";
import { StorageBackend } from "./storage-abstraction";

/**
 * Local filesystem storage backend.
 * Stores encrypted document ciphertext on the local disk.
 *
 * SECURITY: All path operations are validated to prevent path traversal attacks.
 */

export class LocalStorageBackend implements StorageBackend {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
    this.ensureDirectory();
  }

  /**
   * Ensure the storage directory exists.
   */
  private ensureDirectory(): void {
    if (!fs.existsSync(this.basePath)) {
      fs.mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Validate that a path resolves within the storage directory.
   * Throws if path traversal is detected.
   */
  private validatePath(key: string): string {
    // Sanitize key - only allow alphanumeric, hyphens, underscores, forward slashes
    if (!/^[a-zA-Z0-9/_-]+$/.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }

    // No directory traversal
    if (key.includes("..") || key.includes("~")) {
      throw new Error(`Invalid path characters: ${key}`);
    }

    const absPath = path.resolve(this.basePath, key);

    // Ensure the resolved path is within basePath
    if (!absPath.startsWith(this.basePath + path.sep) && absPath !== this.basePath) {
      throw new Error(`Path traversal detected: ${key}`);
    }

    return absPath;
  }

  async store(docId: string, data: Buffer): Promise<string> {
    // Validate docId is a safe filename
    if (!/^[a-f0-9-]+$/i.test(docId)) {
      throw new Error(`Invalid document ID: ${docId}`);
    }

    const key = `${docId}.bin`;
    const absPath = this.validatePath(key);

    // Ensure parent directory exists
    const dir = path.dirname(absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    fs.writeFileSync(absPath, data);
    return key;
  }

  async read(key: string): Promise<Buffer> {
    const absPath = this.validatePath(key);

    if (!fs.existsSync(absPath)) {
      throw new Error(`File not found: ${key}`);
    }

    return fs.readFileSync(absPath);
  }

  async delete(key: string): Promise<void> {
    const absPath = this.validatePath(key);

    if (fs.existsSync(absPath)) {
      fs.unlinkSync(absPath);
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const absPath = this.validatePath(key);
      return fs.existsSync(absPath);
    } catch {
      return false;
    }
  }

  getBackendType(): string {
    return "local";
  }
}
