import { StorageBackend } from "./storage-abstraction";

/**
 * S3-compatible object storage backend.
 * Stores encrypted document ciphertext in S3, MinIO, or other compatible services.
 *
 * Supports AWS S3, Cloudflare R2, MinIO, DigitalOcean Spaces, etc.
 */

// S3 client will be lazily loaded
let s3Client: any = null;
let s3Config: any = null;

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
   * Sanitize key for S3 (no path traversal, safe characters only).
   */
  private sanitizeKey(key: string): string {
    // Remove any path traversal attempts
    const sanitized = key.replace(/\.\./g, "").replace(/~/g, "");

    // Ensure key starts with documents/ prefix for organization
    if (!sanitized.startsWith("documents/")) {
      return `documents/${sanitized}`;
    }

    return sanitized;
  }

  async store(docId: string, data: Buffer): Promise<string> {
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
