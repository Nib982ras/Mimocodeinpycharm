import { StorageBackend } from "./storage-abstraction";

/**
 * S3-compatible object storage backend.
 * Stores encrypted document ciphertext in S3, MinIO, or other compatible services.
 *
 * Supports AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, etc.
 */

// S3 client will be lazily loaded
let s3Client: any = null;
let s3Config: S3StorageConfig | null = null;

// Maximum upload size: 100MB (matches upload.ts MAX_FILE_SIZE)
const MAX_S3_UPLOAD_SIZE = 100 * 1024 * 1024;

interface S3StorageConfig {
  bucket: string;
  region: string;
  endpoint?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle?: boolean;
}

async function getS3Client(config: S3StorageConfig) {
  if (s3Client) return s3Client;

  // Dynamic import to avoid loading AWS SDK when not needed
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = await import("@aws-sdk/client-s3");

  const clientConfig: any = {
    region: config.region,
  };

  // Custom endpoint (for MinIO, etc.)
  if (config.endpoint) {
    clientConfig.endpoint = config.endpoint;
    clientConfig.forcePathStyle = config.forcePathStyle ?? true;
  }

  // Credentials (from env or IAM role)
  if (config.accessKeyId && config.secretAccessKey) {
    clientConfig.credentials = {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    };
  }

  s3Client = new S3Client(clientConfig);
  s3Config = config;

  return s3Client;
}

export class S3StorageBackend implements StorageBackend {
  private config: S3StorageConfig;

  constructor(config: S3StorageConfig) {
    this.config = config;

    if (!config.bucket) {
      throw new Error("S3_BUCKET is required");
    }
  }

  /**
   * Sanitize key for S3 — allowlist validation, no path traversal.
   * Only alphanumeric, hyphens, underscores, forward slashes, and dots are allowed.
   */
  private sanitizeKey(key: string): string {
    // Allowlist validation: reject anything outside safe characters
    if (!/^[a-zA-Z0-9/_\-\.]+$/.test(key)) {
      throw new Error(`Invalid S3 key: contains disallowed characters`);
    }

    // Reject path traversal
    if (key.includes("..") || key.includes("~")) {
      throw new Error(`Invalid S3 key: path traversal detected`);
    }

    // Ensure key starts with documents/ prefix for organization
    if (!key.startsWith("documents/")) {
      return `documents/${key}`;
    }

    return key;
  }

  async store(docId: string, data: Buffer): Promise<string> {
    // Enforce size limit
    if (data.length > MAX_S3_UPLOAD_SIZE) {
      throw new Error(`Data too large: ${data.length} bytes (max: ${MAX_S3_UPLOAD_SIZE})`);
    }

    const client = await getS3Client(this.config);
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");

    const key = this.sanitizeKey(`${docId}.bin`);

    const command = new PutObjectCommand({
      Bucket: this.config.bucket,
      Key: key,
      Body: data,
      ContentType: "application/octet-stream",
      // Enable server-side encryption
      ServerSideEncryption: "AES256",
      // Metadata for tracking
      Metadata: {
        "doc-id": docId,
        "stored-at": new Date().toISOString(),
      },
    });

    await client.send(command);
    return key;
  }

  async read(key: string): Promise<Buffer> {
    const client = await getS3Client(this.config);
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");

    const sanitizedKey = this.sanitizeKey(key);

    const command = new GetObjectCommand({
      Bucket: this.config.bucket,
      Key: sanitizedKey,
    });

    const response = await client.send(command);

    // Convert stream to buffer
    const chunks: Uint8Array[] = [];
    const reader = response.Body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    return Buffer.concat(chunks);
  }

  async delete(key: string): Promise<void> {
    const client = await getS3Client(this.config);
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");

    const sanitizedKey = this.sanitizeKey(key);

    const command = new DeleteObjectCommand({
      Bucket: this.config.bucket,
      Key: sanitizedKey,
    });

    await client.send(command);
  }

  async exists(key: string): Promise<boolean> {
    try {
      const client = await getS3Client(this.config);
      const { HeadObjectCommand } = await import("@aws-sdk/client-s3");

      const sanitizedKey = this.sanitizeKey(key);

      const command = new HeadObjectCommand({
        Bucket: this.config.bucket,
        Key: sanitizedKey,
      });

      await client.send(command);
      return true;
    } catch (error: any) {
      // 404 = not found
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        return false;
      }
      throw error;
    }
  }

  getBackendType(): string {
    return "s3";
  }
}
