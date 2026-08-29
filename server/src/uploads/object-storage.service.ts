import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CopyObjectCommand,
  CreateBucketCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  UploadPartCommand,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';

export type ObjectStoragePart = {
  partNumber: number;
  etag: string;
  size?: number;
};

export type ObjectStorageConfig = {
  endpoint: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  forcePathStyle: boolean;
  timeoutMs: number;
  presignExpiresSeconds: number;
};

/**
 * 上传业务只依赖这个适配器。默认是本地文件系统，显式设置 STORAGE_DRIVER=minio/s3 才连接对象存储。
 * 这样测试和开发不会因为缺少 MinIO 凭据而偷偷改写真实数据，也不会把本地目录冒充生产对象存储。
 */
@Injectable()
export class ObjectStorageService implements OnModuleDestroy {
  private client?: S3Client;

  isEnabled() {
    return ['minio', 's3'].includes(
      (process.env.STORAGE_DRIVER || 'filesystem').trim().toLowerCase(),
    );
  }

  getConfig(): ObjectStorageConfig {
    const endpoint =
      process.env.S3_ENDPOINT?.trim() || process.env.MINIO_ENDPOINT?.trim();
    const accessKeyId =
      process.env.S3_ACCESS_KEY_ID?.trim() ||
      process.env.MINIO_ROOT_USER?.trim();
    const secretAccessKey =
      process.env.S3_SECRET_ACCESS_KEY?.trim() ||
      process.env.MINIO_ROOT_PASSWORD?.trim();
    if (!endpoint || !accessKeyId || !secretAccessKey) {
      throw new Error(
        'S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY are required when object storage is enabled',
      );
    }
    return {
      endpoint,
      region: process.env.S3_REGION?.trim() || 'us-east-1',
      accessKeyId,
      secretAccessKey,
      bucket: process.env.S3_BUCKET?.trim() || 'question-bank-private',
      forcePathStyle:
        (process.env.S3_FORCE_PATH_STYLE || 'true').toLowerCase() !== 'false',
      timeoutMs: positiveInteger(process.env.S3_TIMEOUT_MS, 10_000),
      presignExpiresSeconds: Math.min(
        positiveInteger(process.env.S3_PRESIGN_EXPIRES_SECONDS, 900),
        7 * 24 * 60 * 60,
      ),
    };
  }

  async ensureBucket() {
    const config = this.getConfig();
    try {
      await this.send(new HeadBucketCommand({ Bucket: config.bucket }));
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status !== 404) throw error;
      await this.send(new CreateBucketCommand({ Bucket: config.bucket }));
    }
    return config.bucket;
  }

  async createMultipart(objectKey: string, contentType: string) {
    const config = await this.configWithBucket();
    const result = (await this.send(
      new CreateMultipartUploadCommand({
        Bucket: config.bucket,
        Key: objectKey,
        ContentType: contentType,
        Metadata: { storage: 'knowledge-navigator' },
      }),
    )) as { UploadId?: string };
    if (!result.UploadId)
      throw new Error('Object storage did not return uploadId');
    return { bucket: config.bucket, uploadId: result.UploadId };
  }

  async presignPart(
    objectKey: string,
    uploadId: string,
    partNumber: number,
    expiresIn = this.getConfig().presignExpiresSeconds,
  ) {
    const config = await this.configWithBucket();
    return getSignedUrl(
      this.getClient(),
      new UploadPartCommand({
        Bucket: config.bucket,
        Key: objectKey,
        UploadId: uploadId,
        PartNumber: partNumber,
      }),
      { expiresIn },
    );
  }

  async uploadPartFromFile(
    objectKey: string,
    uploadId: string,
    partNumber: number,
    filePath: string,
    contentLength: number,
  ) {
    const config = await this.configWithBucket();
    const result = (await this.send(
      new UploadPartCommand({
        Bucket: config.bucket,
        Key: objectKey,
        UploadId: uploadId,
        PartNumber: partNumber,
        Body: createReadStream(filePath),
        ContentLength: contentLength,
      }),
    )) as { ETag?: string };
    if (!result.ETag)
      throw new Error('Object storage did not return part ETag');
    return result.ETag;
  }

  async listParts(objectKey: string, uploadId: string) {
    const config = await this.configWithBucket();
    const result = (await this.send(
      new ListPartsCommand({
        Bucket: config.bucket,
        Key: objectKey,
        UploadId: uploadId,
      }),
    )) as {
      Parts?: Array<{ PartNumber?: number; ETag?: string; Size?: number }>;
    };
    return (result.Parts || []).flatMap((part) =>
      part.PartNumber && part.ETag
        ? [
            {
              partNumber: part.PartNumber,
              etag: part.ETag,
              size: part.Size,
            },
          ]
        : [],
    );
  }

  async completeMultipart(
    objectKey: string,
    uploadId: string,
    parts: ObjectStoragePart[],
  ) {
    const config = await this.configWithBucket();
    return this.send(
      new CompleteMultipartUploadCommand({
        Bucket: config.bucket,
        Key: objectKey,
        UploadId: uploadId,
        MultipartUpload: {
          Parts: parts
            .sort((a, b) => a.partNumber - b.partNumber)
            .map(({ partNumber, etag }) => ({
              PartNumber: partNumber,
              ETag: etag,
            })),
        },
      }),
    );
  }

  async abortMultipart(objectKey: string, uploadId: string) {
    const config = await this.configWithBucket();
    await this.send(
      new AbortMultipartUploadCommand({
        Bucket: config.bucket,
        Key: objectKey,
        UploadId: uploadId,
      }),
    );
  }

  async headObject(objectKey: string) {
    const config = await this.configWithBucket();
    return this.send(
      new HeadObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    );
  }

  async readObject(objectKey: string) {
    const config = await this.configWithBucket();
    const result = (await this.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    )) as { Body?: { transformToByteArray(): Promise<Uint8Array> } };
    if (!result.Body) throw new Error('Object storage returned an empty body');
    return Buffer.from(await result.Body.transformToByteArray());
  }

  /**
   * Worker 直接消费对象存储响应流，避免为校验摘要额外落地一份临时文件。
   * 内容仍由调用方决定是否缓存，摘要计算本身始终按流增量执行。
   */
  async readObjectWithSha256(objectKey: string) {
    const config = await this.configWithBucket();
    const result = (await this.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    )) as { Body?: NodeJS.ReadableStream & AsyncIterable<Uint8Array> };
    if (!result.Body) throw new Error('Object storage returned an empty body');
    const hash = createHash('sha256');
    const chunks: Buffer[] = [];
    for await (const chunk of result.Body) {
      const buffer = Buffer.from(chunk);
      hash.update(buffer);
      chunks.push(buffer);
    }
    return { content: Buffer.concat(chunks), sha256: hash.digest('hex') };
  }

  async downloadToFile(objectKey: string, filePath: string) {
    const config = await this.configWithBucket();
    const result = (await this.send(
      new GetObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    )) as { Body?: NodeJS.ReadableStream };
    if (!result.Body) throw new Error('Object storage returned an empty body');
    await pipeline(
      result.Body as NodeJS.ReadableStream,
      createWriteStream(filePath),
    );
  }

  async copyObject(sourceKey: string, targetKey: string) {
    const config = await this.configWithBucket();
    await this.send(
      new CopyObjectCommand({
        Bucket: config.bucket,
        Key: targetKey,
        CopySource: `${config.bucket}/${encodeURIComponent(sourceKey)}`,
      }),
    );
  }

  async objectExists(objectKey: string) {
    try {
      await this.headObject(objectKey);
      return true;
    } catch (error) {
      const status = (error as { $metadata?: { httpStatusCode?: number } })
        .$metadata?.httpStatusCode;
      if (status === 404) return false;
      throw error;
    }
  }

  async putObject(objectKey: string, body: Buffer, contentType: string) {
    const config = await this.configWithBucket();
    await this.send(
      new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectKey,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async deleteObject(objectKey: string) {
    const config = await this.configWithBucket();
    await this.send(
      new DeleteObjectCommand({ Bucket: config.bucket, Key: objectKey }),
    );
  }

  async health() {
    if (!this.isEnabled()) return { status: 'not-configured' as const };
    try {
      await this.ensureBucket();
      return { status: 'ok' as const, bucket: this.getConfig().bucket };
    } catch (error) {
      return {
        status: 'unavailable' as const,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  onModuleDestroy() {
    this.client?.destroy();
  }

  private async configWithBucket() {
    const config = this.getConfig();
    await this.ensureBucket();
    return config;
  }

  private getClient() {
    if (this.client) return this.client;
    const config = this.getConfig();
    this.client = new S3Client({
      endpoint: config.endpoint,
      region: config.region,
      forcePathStyle: config.forcePathStyle,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
    return this.client;
  }

  private async send(command: object): Promise<unknown> {
    const controller = new AbortController();
    const timer = setTimeout(
      () => controller.abort(new Error('Object storage request timed out')),
      this.getConfig().timeoutMs,
    );
    try {
      return await this.getClient().send(command as never, {
        abortSignal: controller.signal,
      });
    } finally {
      clearTimeout(timer);
    }
  }
}

function positiveInteger(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
