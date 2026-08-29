import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
} from 'node:fs';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { Transform } from 'node:stream';
import type { Request } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import { InitiateUploadDto } from './dto/initiate-upload.dto';
import { ObjectStorageService } from './object-storage.service';

const PART_SIZE = 8 * 1024 * 1024;
const UPLOAD_ROOT =
  process.env.UPLOAD_DIR || join(process.cwd(), '.data', 'uploads');
const MAX_FILE_COUNT_PER_USER = positiveLimit(
  process.env.UPLOAD_MAX_FILES,
  100,
);
const MAX_TOTAL_BYTES_PER_USER = positiveLimit(
  process.env.UPLOAD_MAX_BYTES,
  2 * 1024 * 1024 * 1024,
);
const ALLOWED_MIME_TYPES = new Set([
  'application/zip',
  'application/x-zip-compressed',
  'application/pdf',
  'application/json',
  'image/png',
  'image/jpeg',
  'image/webp',
]);

@Injectable()
export class UploadsService implements OnModuleInit, OnModuleDestroy {
  private cleanupTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly objectStorage?: ObjectStorageService,
  ) {
    if (!existsSync(UPLOAD_ROOT)) mkdirSync(UPLOAD_ROOT, { recursive: true });
  }

  async onModuleInit() {
    await this.cleanupExpired();
    this.cleanupTimer = setInterval(
      () => void this.cleanupExpired(),
      60 * 60 * 1000,
    );
    this.cleanupTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearInterval(this.cleanupTimer);
  }

  async initiate(userId: number, data: InitiateUploadDto) {
    if (!ALLOWED_MIME_TYPES.has(data.mime.toLowerCase())) {
      throw new BadRequestException('Unsupported upload MIME type');
    }
    if (data.sha256) {
      const existing = await this.prisma.fileObject.findUnique({
        where: { ownerId_sha256: { ownerId: userId, sha256: data.sha256 } },
      });
      if (existing?.verifiedAt) {
        return {
          fileObjectId: existing.id,
          objectKey: existing.objectKey,
          partSize: PART_SIZE,
          deduplicated: true,
        };
      }
    }
    const [fileCount, fileBytes, activeSessions] = await Promise.all([
      this.prisma.fileObject.count({ where: { ownerId: userId } }),
      this.prisma.fileObject.aggregate({
        where: { ownerId: userId },
        _sum: { size: true },
      }),
      this.prisma.uploadSession.aggregate({
        where: {
          userId,
          status: { in: ['CREATED', 'UPLOADING', 'UPLOADED', 'VERIFYING'] },
        },
        _count: { _all: true },
        _sum: { size: true },
      }),
    ]);
    const reservedFileCount = fileCount + (activeSessions._count._all ?? 0);
    const reservedBytes =
      (fileBytes._sum.size ?? 0) + (activeSessions._sum.size ?? 0);
    if (
      reservedFileCount >= MAX_FILE_COUNT_PER_USER ||
      reservedBytes + data.size > MAX_TOTAL_BYTES_PER_USER
    ) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'UPLOAD_QUOTA_EXCEEDED',
          message: 'Upload quota exceeded for this user',
        },
      });
    }
    const objectKey = `${userId}/${randomUUID()}`;
    const storageBackend = this.objectStorage?.isEnabled()
      ? 's3'
      : 'filesystem';
    let multipart: { bucket: string; uploadId: string } | undefined;
    if (storageBackend === 's3') {
      multipart = await this.objectStorage!.createMultipart(
        objectKey,
        data.mime,
      );
    }
    const session = await this.prisma.uploadSession.create({
      data: {
        userId,
        objectKey,
        bucket: multipart?.bucket,
        uploadId: multipart?.uploadId,
        storageBackend,
        fileName: data.fileName,
        size: data.size,
        mime: data.mime,
        sha256: data.sha256,
        partSize: PART_SIZE,
        expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000),
      },
    });
    const presignedUrls =
      storageBackend === 's3' && multipart
        ? await Promise.all(
            Array.from(
              { length: Math.ceil(data.size / PART_SIZE) },
              (_, index) =>
                this.objectStorage!.presignPart(
                  objectKey,
                  multipart!.uploadId,
                  index + 1,
                ),
            ),
          )
        : undefined;
    return {
      sessionId: session.id,
      objectKey: session.objectKey,
      partSize: session.partSize,
      expiresAt: session.expiresAt,
      storageBackend,
      ...(multipart
        ? {
            bucket: multipart.bucket,
            uploadId: multipart.uploadId,
            presignedUrls,
          }
        : {}),
    };
  }

  private async ownedSession(userId: number, sessionId: string) {
    const session = await this.prisma.uploadSession.findFirst({
      where: { id: sessionId, userId },
      include: { parts: { orderBy: { partNumber: 'asc' } } },
    });
    if (!session) throw new NotFoundException('Upload session not found');
    if (session.expiresAt < new Date()) {
      await this.prisma.uploadSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' },
      });
      throw new BadRequestException('Upload session expired');
    }
    return session;
  }

  async savePart(
    userId: number,
    sessionId: string,
    partNumber: number,
    request: Request,
  ) {
    if (partNumber < 1) throw new BadRequestException('Invalid part number');
    const session = await this.ownedSession(userId, sessionId);
    const expectedPartCount = Math.ceil(session.size / session.partSize);
    if (partNumber > expectedPartCount)
      throw new BadRequestException('Invalid part number');
    const expectedPartSize =
      partNumber === expectedPartCount
        ? session.size - session.partSize * (expectedPartCount - 1)
        : session.partSize;
    const partPath = join(UPLOAD_ROOT, `${session.id}.${partNumber}.part`);
    let received = 0;
    await new Promise<void>((resolve, reject) => {
      const limiter = new Transform({
        transform(chunk, _encoding, callback) {
          received += chunk.length;
          if (received > expectedPartSize) {
            callback(new Error('PART_TOO_LARGE'));
            return;
          }
          callback(null, chunk);
        },
      });
      const output = createWriteStream(partPath, { flags: 'w' });
      request.pipe(limiter).pipe(output);
      output.on('finish', resolve);
      output.on('error', reject);
      limiter.on('error', reject);
      request.on('error', reject);
    }).catch(async (error) => {
      await fs.rm(partPath, { force: true });
      if (error instanceof Error && error.message === 'PART_TOO_LARGE') {
        throw new BadRequestException('Invalid part size');
      }
      throw error;
    });
    const stat = await fs.stat(partPath);
    if (stat.size !== expectedPartSize) {
      await fs.rm(partPath, { force: true });
      throw new BadRequestException('Invalid part size');
    }
    const etag = createHash('sha256')
      .update(await fs.readFile(partPath))
      .digest('hex');
    let storedEtag = etag;
    if (session.storageBackend === 's3') {
      if (!session.uploadId)
        throw new BadRequestException('Upload session is missing uploadId');
      storedEtag = await this.objectStorage!.uploadPartFromFile(
        session.objectKey,
        session.uploadId,
        partNumber,
        partPath,
        stat.size,
      );
    }
    await this.prisma.uploadPart.upsert({
      where: { sessionId_partNumber: { sessionId, partNumber } },
      create: { sessionId, partNumber, etag: storedEtag, size: stat.size },
      update: { etag: storedEtag, size: stat.size, uploadedAt: new Date() },
    });
    await this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: 'UPLOADING' },
    });
    if (session.storageBackend === 's3') await fs.rm(partPath, { force: true });
    return { partNumber, etag: storedEtag, size: stat.size };
  }

  async getStatus(userId: number, sessionId: string) {
    const session = await this.ownedSession(userId, sessionId);
    if (session.storageBackend === 's3' && session.uploadId) {
      const remoteParts = await this.objectStorage!.listParts(
        session.objectKey,
        session.uploadId,
      );
      for (const part of remoteParts) {
        if (!part.size) continue;
        await this.prisma.uploadPart.upsert({
          where: {
            sessionId_partNumber: {
              sessionId: session.id,
              partNumber: part.partNumber,
            },
          },
          create: {
            sessionId: session.id,
            partNumber: part.partNumber,
            etag: part.etag,
            size: part.size,
          },
          update: { etag: part.etag, size: part.size },
        });
      }
      session.parts = await this.prisma.uploadPart.findMany({
        where: { sessionId: session.id },
        orderBy: { partNumber: 'asc' },
      });
    }
    return {
      sessionId: session.id,
      status: session.status,
      partSize: session.partSize,
      uploadedParts: session.parts.map((part) => ({
        partNumber: part.partNumber,
        etag: part.etag,
        size: part.size,
      })),
    };
  }

  async presignPart(userId: number, sessionId: string, partNumber: number) {
    if (partNumber < 1) throw new BadRequestException('Invalid part number');
    const session = await this.ownedSession(userId, sessionId);
    const expectedPartCount = Math.ceil(session.size / session.partSize);
    if (partNumber > expectedPartCount)
      throw new BadRequestException('Invalid part number');
    if (session.storageBackend !== 's3' || !session.uploadId) {
      throw new BadRequestException(
        'Presigned URLs are available only for object storage uploads',
      );
    }
    return {
      sessionId: session.id,
      partNumber,
      uploadId: session.uploadId,
      expiresInSeconds: this.objectStorage!.getConfig().presignExpiresSeconds,
      url: await this.objectStorage!.presignPart(
        session.objectKey,
        session.uploadId,
        partNumber,
      ),
    };
  }

  async complete(userId: number, sessionId: string) {
    const session = await this.ownedSession(userId, sessionId);
    await this.prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'VERIFYING' },
    });
    const expectedParts = Math.ceil(session.size / session.partSize);
    const hasContinuousParts = session.parts.every(
      (part, index) => part.partNumber === index + 1,
    );
    const uploadedBytes = session.parts.reduce(
      (total, part) => total + part.size,
      0,
    );
    if (
      session.parts.length !== expectedParts ||
      !hasContinuousParts ||
      uploadedBytes !== session.size
    ) {
      await this.markFailed(session.id);
      throw new BadRequestException('Upload is missing parts');
    }
    const mergedPath = join(UPLOAD_ROOT, `${session.id}.complete`);
    if (session.storageBackend === 's3') {
      if (!session.uploadId)
        throw new BadRequestException('Upload session is missing uploadId');
      await this.objectStorage!.completeMultipart(
        session.objectKey,
        session.uploadId,
        session.parts.map((part) => ({
          partNumber: part.partNumber,
          etag: part.etag,
        })),
      );
      await this.objectStorage!.downloadToFile(session.objectKey, mergedPath);
    } else {
      const output = createWriteStream(mergedPath, { flags: 'w' });
      for (const part of session.parts) {
        await new Promise<void>((resolve, reject) => {
          const input = createReadStream(
            join(UPLOAD_ROOT, `${session.id}.${part.partNumber}.part`),
          );
          input.on('error', reject);
          input.on('end', resolve);
          input.pipe(output, { end: false });
        });
      }
      await new Promise<void>((resolve, reject) => {
        output.end(resolve);
        output.on('error', reject);
      });
    }
    const stat = await fs.stat(mergedPath);
    if (stat.size !== session.size) {
      await this.markFailed(session.id);
      throw new BadRequestException('Merged file size mismatch');
    }
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(mergedPath)) hash.update(chunk);
    const sha256 = hash.digest('hex');
    if (session.sha256 && session.sha256 !== sha256) {
      await this.markFailed(session.id);
      throw new BadRequestException('File SHA-256 mismatch');
    }
    try {
      await this.validateFileContent(mergedPath, session.mime);
    } catch (error) {
      await this.markFailed(session.id);
      throw error;
    }
    // 同一用户仍可在初始化阶段秒传；跨用户只在完成校验后由服务端复用物理对象，
    // 因此客户端不能通过 initiate 响应探测其他用户是否上传过某个 Hash。
    const ownedExisting = await this.prisma.fileObject.findUnique({
      where: { ownerId_sha256: { ownerId: userId, sha256 } },
    });
    const physicalSource =
      ownedExisting ??
      (await this.prisma.fileObject.findFirst({
        where: {
          sha256,
          size: stat.size,
          storageBackend: session.storageBackend,
          bucket: session.bucket,
          verifiedAt: { not: null },
        },
        orderBy: { id: 'asc' },
      }));
    const file =
      ownedExisting ??
      (await this.prisma.fileObject.create({
        data: {
          // FileObject 保留每个用户自己的所有权记录，但可指向同一份受控物理字节。
          objectKey: physicalSource?.objectKey ?? session.objectKey,
          bucket: physicalSource?.bucket ?? session.bucket,
          storageBackend:
            physicalSource?.storageBackend ?? session.storageBackend,
          ownerId: userId,
          sha256,
          size: stat.size,
          mime: session.mime,
          verifiedAt: new Date(),
          scanStatus: 'PENDING',
        },
      }));
    // 新上传的重复副本在元数据写入后删除；原始物理对象仍被至少一个 FileObject 引用。
    if (physicalSource && physicalSource.objectKey !== session.objectKey) {
      if (session.storageBackend === 's3') {
        await this.objectStorage
          ?.deleteObject(session.objectKey)
          .catch(() => undefined);
      } else {
        await fs.rm(mergedPath, { force: true });
      }
    }
    await this.prisma.uploadSession.update({
      where: { id: session.id },
      data: { status: 'COMPLETED' },
    });
    if (session.storageBackend === 's3') {
      await Promise.all(
        [
          mergedPath,
          ...session.parts.map((part) =>
            join(UPLOAD_ROOT, `${session.id}.${part.partNumber}.part`),
          ),
        ].map((path) => fs.rm(path, { force: true })),
      );
    }
    return file;
  }

  private markFailed(sessionId: string) {
    return this.prisma.uploadSession.update({
      where: { id: sessionId },
      data: { status: 'FAILED' },
    });
  }

  private async validateFileContent(filePath: string, declaredMime: string) {
    const handle = await fs.open(filePath, 'r');
    const sample = Buffer.alloc(512);
    let bytesRead = 0;
    try {
      ({ bytesRead } = await handle.read(sample, 0, sample.length, 0));
    } finally {
      await handle.close();
    }
    const detectedMime = detectMime(
      sample.subarray(0, bytesRead),
      declaredMime,
    );
    if (
      detectedMime !== declaredMime &&
      !(
        declaredMime === 'application/x-zip-compressed' &&
        detectedMime === 'application/zip'
      )
    ) {
      throw new BadRequestException(
        'File content does not match declared MIME type',
      );
    }
    if (detectedMime === 'application/zip') await validateZipStream(filePath);
  }

  private async cleanupExpired() {
    const expired = await this.prisma.uploadSession.findMany({
      where: { expiresAt: { lt: new Date() }, status: { not: 'COMPLETED' } },
      select: {
        id: true,
        objectKey: true,
        uploadId: true,
        storageBackend: true,
      },
    });
    if (!expired.length) return;
    await this.prisma.uploadSession.updateMany({
      where: { id: { in: expired.map(({ id }) => id) } },
      data: { status: 'EXPIRED' },
    });
    await Promise.all(
      expired
        .filter(
          ({ storageBackend, uploadId }) =>
            storageBackend === 's3' && Boolean(uploadId),
        )
        .map(({ objectKey, uploadId }) =>
          this.objectStorage!.abortMultipart(objectKey, uploadId!).catch(
            () => undefined,
          ),
        ),
    );
    const names = await fs.readdir(UPLOAD_ROOT).catch(() => [] as string[]);
    await Promise.all(
      names
        .filter((name) => expired.some(({ id }) => name.startsWith(`${id}.`)))
        .map((name) => fs.rm(join(UPLOAD_ROOT, name), { force: true })),
    );
  }
}

function positiveLimit(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function detectMime(buffer: Buffer, declaredMime: string) {
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])))
    return 'application/zip';
  if (buffer.subarray(0, 5).toString('ascii') === '%PDF-')
    return 'application/pdf';
  if (
    buffer
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  )
    return 'image/png';
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff])))
    return 'image/jpeg';
  if (
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  )
    return 'image/webp';
  if (declaredMime === 'application/json') {
    // 只检查 JSON 的首个非空白字符，完整语法由 ImportJob 读取全文件时校验，避免把大 JSON 一次性读入内存。
    const first = buffer.toString('utf8').trimStart()[0];
    if (first === '{' || first === '[') return 'application/json';
    return 'application/octet-stream';
  }
  return 'application/octet-stream';
}

async function validateZipStream(filePath: string) {
  const maxFiles = 1000;
  const maxUncompressed = 100 * 1024 * 1024;
  let buffer = Buffer.alloc(0);
  let pendingSkip = 0;
  let files = 0;
  let totalUncompressed = 0;
  let foundEntry = false;
  for await (const chunk of createReadStream(filePath, {
    highWaterMark: 64 * 1024,
  })) {
    buffer = Buffer.concat([buffer, chunk]);
    while (true) {
      if (pendingSkip > 0) {
        const consumed = Math.min(pendingSkip, buffer.length);
        buffer = buffer.subarray(consumed);
        pendingSkip -= consumed;
        if (pendingSkip > 0) break;
      }
      if (buffer.length < 30 || buffer.readUInt32LE(0) !== 0x04034b50) break;
      const flags = buffer.readUInt16LE(6);
      if (flags & 0x08)
        throw new BadRequestException('ZIP data descriptors are not supported');
      const compressedSize = buffer.readUInt32LE(18);
      const uncompressedSize = buffer.readUInt32LE(22);
      const nameLength = buffer.readUInt16LE(26);
      const extraLength = buffer.readUInt16LE(28);
      const headerSize = 30 + nameLength + extraLength;
      if (buffer.length < headerSize) break;
      const name = buffer.subarray(30, 30 + nameLength).toString('utf8');
      if (
        name.includes('..') ||
        name.startsWith('/') ||
        /^[A-Za-z]:[\\/]/.test(name)
      )
        throw new BadRequestException('ZIP contains an unsafe path');
      buffer = buffer.subarray(headerSize);
      pendingSkip = compressedSize;
      files += 1;
      totalUncompressed += uncompressedSize;
      if (files > maxFiles || totalUncompressed > maxUncompressed)
        throw new BadRequestException('ZIP exceeds safety limits');
      foundEntry = true;
    }
  }
  if (pendingSkip > 0) throw new BadRequestException('ZIP is truncated');
  if (!foundEntry)
    throw new BadRequestException('ZIP contains no readable entries');
}
