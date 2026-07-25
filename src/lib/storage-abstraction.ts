/**
 * Storage abstraction layer for document ciphertext.
 *
 * Supports:
 *   - Local filesystem (default, development)
 *   - S3-compatible object storage (production)
 *
 * The storage backend is determined by the STORAGE_BACKEND environment variable:
 *   - "local" (default): Uses local filesystem
 *   - "s3": Uses S3-compatible object storage
 */

// ---------- Types ----------

export interface StorageBackend {
  /** Store a ciphertext blob and return its key/path */
  store(docId: string, data: Buffer): Promise<string>;

  /** Read a ciphertext blob by key */
  read(key: string): Promise<Buffer>;

  /** Delete a ciphertext blob by key */
  delete(key: string): Promise<void>;

  /** Check if a key exists */
  exists(key: string): Promise<boolean>;

  /** Get the backend type for logging */
  getBackendType(): string;
}

export interface StorageConfig {
  backend: "local" | "s3";
  local?: {
    basePath: string;
  };
  s3?: {
    bucket: string;
    region: string;
    endpoint?: string;
    accessKeyId?: string;
    secretAccessKey?: string;
    forcePathStyle?: boolean;
  };
}

// ---------- Configuration ----------

function getStorageConfig(): StorageConfig {
  const backend = (process.env.STORAGE_BACKEND || "local") as "local" | "s3";

  return {
    backend,
    local: {
      basePath: process.env.STORAGE_LOCAL_PATH || "db/vault",
    },
    s3: {
      bucket: process.env.S3_BUCKET || "",
      region: process.env.S3_REGION || "us-east-1",
      endpoint: process.env.S3_ENDPOINT,
      accessKeyId: process.env.S3_ACCESS_KEY_ID,
      secretAccessKey: process.env.S3_SECRET_ACCESS_KEY,
      forcePathStyle: process.env.S3_FORCE_PATH_STYLE === "true",
    },
  };
}

// ---------- Singleton ----------

let storageInstance: StorageBackend | null = null;

/**
 * Get or create the storage backend singleton.
 * Uses dynamic import() for type-safe lazy loading.
 */
export async function getStorageBackendAsync(): Promise<StorageBackend> {
  if (storageInstance) return storageInstance;

  const config = getStorageConfig();

  switch (config.backend) {
    case "s3": {
      const { S3StorageBackend } = await import("./storage-s3");
      storageInstance = new S3StorageBackend(config.s3!);
      break;
    }

    case "local":
    default: {
      const { LocalStorageBackend } = await import("./storage-local");
      storageInstance = new LocalStorageBackend(config.local!.basePath);
      break;
    }
  }

  return storageInstance!;
}

/**
 * Get or create the storage backend singleton (sync fallback for backward compat).
 * @deprecated Use getStorageBackendAsync() instead
 */
export function getStorageBackend(): StorageBackend {
  if (storageInstance) return storageInstance;

  const config = getStorageConfig();

  // Synchronous fallback — triggers require() but only for backward compat
  switch (config.backend) {
    case "s3": {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { S3StorageBackend } = require("./storage-s3");
      storageInstance = new S3StorageBackend(config.s3!);
      break;
    }

    case "local":
    default: {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { LocalStorageBackend } = require("./storage-local");
      storageInstance = new LocalStorageBackend(config.local!.basePath);
      break;
    }
  }

  return storageInstance!;
}

/**
 * Reset the storage backend (for testing or reconfiguration).
 */
export function resetStorageBackend(): void {
  storageInstance = null;
}
