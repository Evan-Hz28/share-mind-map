import { createHash } from "node:crypto";
import { PassThrough, Readable, Transform } from "node:stream";

import { Client as MinioClient, type ItemBucketMetadata } from "minio";

export interface ObjectStorageConfig {
  endpoint: URL;
  accessKey: string;
  secretKey: string;
  bucket: string;
  useSsl: boolean;
}

export interface StoredObjectMetadata {
  objectKey: string;
  byteSize: number;
  sha256: string;
  mediaType: string;
}

export interface ObjectStorage {
  putStream(input: {
    objectKey: string;
    stream: NodeJS.ReadableStream;
    mediaType: string;
    maxBytes?: number;
  }): Promise<StoredObjectMetadata>;
  getStream(objectKey: string): Promise<Readable>;
  stat(objectKey: string): Promise<ItemBucketMetadata>;
  remove(objectKey: string): Promise<void>;
  copy(sourceKey: string, targetKey: string, mediaType?: string): Promise<void>;
}

export class ObjectTooLargeError extends Error {
  public constructor(public readonly maxBytes: number) {
    super(`Object exceeds the ${String(maxBytes)}-byte limit.`);
    this.name = "ObjectTooLargeError";
  }
}

export class MinioObjectStorage implements ObjectStorage {
  public readonly client: MinioClient;

  public constructor(private readonly config: ObjectStorageConfig) {
    this.client = new MinioClient({
      endPoint: config.endpoint.hostname,
      port: config.endpoint.port === "" ? (config.useSsl ? 443 : 80) : Number(config.endpoint.port),
      useSSL: config.useSsl,
      accessKey: config.accessKey,
      secretKey: config.secretKey,
    });
  }

  public async putStream(input: {
    objectKey: string;
    stream: NodeJS.ReadableStream;
    mediaType: string;
    maxBytes?: number;
  }): Promise<StoredObjectMetadata> {
    const maxBytes = input.maxBytes ?? Number.MAX_SAFE_INTEGER;
    let byteSize = 0;
    const hash = createHash("sha256");
    const guarded = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        byteSize += chunk.byteLength;
        if (byteSize > maxBytes) {
          callback(new ObjectTooLargeError(maxBytes));
          return;
        }
        hash.update(chunk);
        callback(null, chunk);
      },
    });
    const source = Readable.from(input.stream);
    source.on("error", (error) => guarded.destroy(error));
    source.pipe(guarded);
    try {
      await this.client.putObject(this.config.bucket, input.objectKey, guarded, undefined, {
        "Content-Type": input.mediaType,
      });
    } catch (error) {
      guarded.destroy();
      throw error;
    }
    return {
      objectKey: input.objectKey,
      byteSize,
      sha256: hash.digest("hex"),
      mediaType: input.mediaType,
    };
  }

  public getStream(objectKey: string): Promise<Readable> {
    return this.client.getObject(this.config.bucket, objectKey);
  }

  public stat(objectKey: string): Promise<ItemBucketMetadata> {
    return this.client.statObject(this.config.bucket, objectKey);
  }

  public remove(objectKey: string): Promise<void> {
    return this.client.removeObject(this.config.bucket, objectKey);
  }

  public async copy(sourceKey: string, targetKey: string): Promise<void> {
    await this.client.copyObject(
      this.config.bucket,
      targetKey,
      `/${this.config.bucket}/${sourceKey}`,
    );
  }
}

export function createMemoryReadable(bytes: Buffer): Readable {
  const stream = new PassThrough();
  stream.end(bytes);
  return stream;
}
