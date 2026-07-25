import fs from "fs/promises";
import fsSync from "fs";
import path from "path";
import { StorageBackend } from "./storage-abstraction";

/**
 * Local filesystem storage backend.
 * Stores encrypted document ciphertext on the local disk.
 *
 * SECURITY: All path operations are validated to prevent path traversal attacks.
 * Uses async fs APIs to avoid blocking the event loop.
 */

export class LocalStorageBackend implements StorageBackend {
  private basePath: string;

  constructor(basePath: string) {
    this.basePath = path.resolve(basePath);
    // Constructor must be sync — use sync for initial directory creation only
    if (!fsSync.existsSync(this.basePath)) {
      fsSync.mkdirSync(this.basePath, { recursive: true });
    }
  }

  /**
   * Validate that a path resolves within the storage directory.
   * Throws if path traversal is detected.
   */
  private validatePath(key: string): string {
    if (!/^[a-zA-Z0-9/_\-\.]+$/.test(key)) {
      throw new Error(`Invalid storage key: ${key}`);
    }

    if (key.includes("..") || key.includes("~")) {
      throw new Error(`Invalid path characters: ${key}`);
    }

    const absPath = path.resolve(this.basePath, key);

    if (!absPath.startsWith(this.basePath + path.sep) && absPath !== this.basePath) {
      throw new Error(`Path traversal detected: ${key}`);
    }

    return absPath;
  }

  async store(docId: string, data: Buffer): Promise<string> {
    if (!/^[a-f0-9-]+$/i.test(docId)) {
      throw new Error(`Invalid document ID: ${docId}`);
    }

    const key = `${docId}.bin`;
    const absPath = this.validatePath(key);

    const dir = path.dirname(absPath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(absPath, data);

    return key;
  }

  async read(key: string): Promise<Buffer> {
    const absPath = this.validatePath(key);

    try {
      return await fs.readFile(absPath);
    } catch (err: any) {
      if (err.code === "ENOENT") {
        throw new Error(`File not found: ${key}`);
      }
      throw err;
    }
  }

  async delete(key: string): Promise<void> {
    const absPath = this.validatePath(key);

    try {
      await fs.unlink(absPath);
    } catch (err: any) {
      if (err.code !== "ENOENT") throw err;
    }
  }

  async exists(key: string): Promise<boolean> {
    try {
      const absPath = this.validatePath(key);
      await fs.access(absPath);
      return true;
    } catch {
      return false;
    }
  }

  getBackendType(): string {
    return "local";
  }
}
