import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { createHash } from 'node:crypto';
import { createServer, request as forwardRequest } from 'node:http';
import type { AddressInfo } from 'node:net';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import { PrismaService } from '../src/prisma/prisma.service';
import { ObjectStorageService } from '../src/uploads/object-storage.service';
import { UploadsService } from '../src/uploads/uploads.service';
import {
  ImportJobsService,
  PermanentImportError,
} from '../src/import-jobs/import-jobs.service';

process.env.STORAGE_DRIVER = 'minio';
process.env.S3_ENDPOINT ||= 'http://127.0.0.1:9000';
process.env.S3_ACCESS_KEY_ID ||= 'minioadmin';
process.env.S3_SECRET_ACCESS_KEY ||= 'minioadmin';
process.env.S3_BUCKET ||= `question-bank-e2e-${process.pid}`;
process.env.S3_FORCE_PATH_STYLE = 'true';

async function startOneShotDelayedProxy(target: string) {
  let delayedUploadPart = false;
  const server = createServer((incoming, response) => {
    const forward = () => {
      const upstream = forwardRequest(
        `${target}${incoming.url || '/'}`,
        {
          method: incoming.method,
          headers: incoming.headers,
        },
        (upstreamResponse) => {
          response.writeHead(
            upstreamResponse.statusCode || 502,
            upstreamResponse.headers,
          );
          upstreamResponse.pipe(response);
        },
      );
      upstream.on('error', () => {
        if (!response.headersSent) response.writeHead(502);
        response.end();
      });
      incoming.pipe(upstream);
    };
    const isFirstUploadPart =
      !delayedUploadPart &&
      incoming.method === 'PUT' &&
      (incoming.url || '').includes('uploadId=');
    if (isFirstUploadPart) {
      delayedUploadPart = true;
      setTimeout(forward, 250);
      return;
    }
    forward();
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address() as AddressInfo;
  return { server, endpoint: `http://127.0.0.1:${port}` };
}

function resetObjectStorageClient(service: ObjectStorageService) {
  // 测试切换到本地延迟代理后，释放 SDK 的旧 endpoint 连接池。
  (
    service as ObjectStorageService & { client?: { destroy(): void } }
  ).client?.destroy();
  (service as ObjectStorageService & { client?: undefined }).client = undefined;
}

describe('MinIO object storage upload (e2e)', () => {
  let app: INestApplication<App>;

  async function login(email: string) {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'correct-password-123' })
      .expect(201);
    return (
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'correct-password-123' })
        .expect(201)
    ).body.data.accessToken as string;
  }

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.get(PrismaService).importJob.deleteMany();
    await app.get(PrismaService).fileObject.deleteMany();
    await app.get(PrismaService).uploadPart.deleteMany();
    await app.get(PrismaService).uploadSession.deleteMany();
    await app.get(PrismaService).refreshSession.deleteMany();
    await app.get(PrismaService).user.deleteMany();
    await app.close();
  });

  it('creates Multipart, resumes remote parts, completes and isolates ownership', async () => {
    const token = await login(`minio-upload-${Date.now()}@example.test`);
    const otherToken = await login(`minio-other-${Date.now()}@example.test`);
    const prefix = Buffer.from('{"schemaVersion":1,"questions":[],"padding":"');
    const suffix = Buffer.from('"}');
    const content = Buffer.concat([
      prefix,
      Buffer.alloc(8 * 1024 * 1024 + 1 - prefix.length - suffix.length, 0x61),
      suffix,
    ]);
    const sha256 = createHash('sha256').update(content).digest('hex');

    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'minio-question-bank.json',
        size: content.length,
        mime: 'application/json',
        sha256,
      })
      .expect(201);
    expect(initiated.body.data.sessionId).toEqual(expect.any(String));
    expect(initiated.body.data.uploadId).toEqual(expect.any(String));
    expect(initiated.body.data.presignedUrls).toHaveLength(2);
    const sessionId = initiated.body.data.sessionId as string;

    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content.subarray(0, 8 * 1024 * 1024))
      .expect(201);
    const status = await request(app.getHttpServer())
      .get(`/uploads/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(status.body.data.uploadedParts).toHaveLength(1);
    const presigned = await request(app.getHttpServer())
      .get(`/uploads/${sessionId}/parts/2/presign`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(presigned.body.data.url).toContain('X-Amz-Algorithm');
    expect(presigned.body.data.expiresInSeconds).toBeLessThanOrEqual(900);

    await request(app.getHttpServer())
      .get(`/uploads/${sessionId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/2`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content.subarray(8 * 1024 * 1024))
      .expect(201);
    const completed = await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(completed.body.data.sha256).toBe(sha256);

    const fileObject = await app
      .get(PrismaService)
      .fileObject.findUniqueOrThrow({ where: { id: completed.body.data.id } });
    expect(fileObject.storageBackend).toBe('s3');
    expect(fileObject.bucket).toBe(process.env.S3_BUCKET);
    const head = await app
      .get(ObjectStorageService)
      .headObject(fileObject.objectKey);
    const wholeFileMd5 = createHash('md5').update(content).digest('hex');
    expect(head.ETag).toBeDefined();
    expect(head.ETag?.replaceAll('"', '')).not.toBe(wholeFileMd5);
    await expect(
      app.get(ObjectStorageService).objectExists(fileObject.objectKey),
    ).resolves.toBe(true);
    const streamProbeKey = `stream-probe/${Date.now()}.json`;
    const streamProbe = Buffer.from('{"schemaVersion":1,"questions":[]}');
    await app
      .get(ObjectStorageService)
      .putObject(streamProbeKey, streamProbe, 'application/json');
    const streamed = await app
      .get(ObjectStorageService)
      .readObjectWithSha256(streamProbeKey);
    expect(streamed.sha256).toBe(
      createHash('sha256').update(streamProbe).digest('hex'),
    );
    expect(streamed.content).toEqual(streamProbe);
    await app.get(ObjectStorageService).deleteObject(streamProbeKey);
    await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200)
      .expect((response) => {
        expect(response.body.data.dependencies.objectStorage).toBe('s3');
      });
  });

  it('reports object storage outage without claiming readiness', async () => {
    const unavailable = new ObjectStorageService();
    const previousEndpoint = process.env.S3_ENDPOINT;
    process.env.S3_ENDPOINT = 'http://127.0.0.1:65500';
    await expect(unavailable.health()).resolves.toMatchObject({
      status: 'unavailable',
    });
    process.env.S3_ENDPOINT = previousEndpoint;
    unavailable.onModuleDestroy();
  });

  it('reports invalid object storage credentials as unavailable', async () => {
    const unauthorized = new ObjectStorageService();
    const previousAccessKey = process.env.S3_ACCESS_KEY_ID;
    const previousSecret = process.env.S3_SECRET_ACCESS_KEY;
    process.env.S3_ACCESS_KEY_ID = 'invalid-access-key';
    process.env.S3_SECRET_ACCESS_KEY = 'invalid-secret-key';
    await expect(unauthorized.health()).resolves.toMatchObject({
      status: 'unavailable',
    });
    process.env.S3_ACCESS_KEY_ID = previousAccessKey;
    process.env.S3_SECRET_ACCESS_KEY = previousSecret;
    unauthorized.onModuleDestroy();
  });

  it('times out one MinIO part request, then accepts the retry and completes', async () => {
    const storage = app.get(ObjectStorageService);
    const originalEndpoint = process.env.S3_ENDPOINT;
    const originalTimeout = process.env.S3_TIMEOUT_MS;
    const { server, endpoint } = await startOneShotDelayedProxy(
      originalEndpoint as string,
    );
    process.env.S3_ENDPOINT = endpoint;
    process.env.S3_TIMEOUT_MS = '50';
    resetObjectStorageClient(storage);
    try {
      const token = await login(`minio-timeout-${Date.now()}@example.test`);
      const content = Buffer.from('{"schemaVersion":1,"questions":[]}');
      const initiated = await request(app.getHttpServer())
        .post('/uploads/initiate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileName: 'retry-after-timeout.json',
          size: content.length,
          mime: 'application/json',
          sha256: createHash('sha256').update(content).digest('hex'),
        })
        .expect(201);
      const sessionId = initiated.body.data.sessionId as string;
      await request(app.getHttpServer())
        .post(`/uploads/${sessionId}/parts/1`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/octet-stream')
        .send(content)
        .expect(500);
      await request(app.getHttpServer())
        .get(`/uploads/${sessionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200)
        .expect((response) => {
          expect(response.body.data.uploadedParts).toHaveLength(0);
        });
      await request(app.getHttpServer())
        .post(`/uploads/${sessionId}/parts/1`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/octet-stream')
        .send(content)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/uploads/${sessionId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201)
        .expect((response) => {
          expect(response.body.data.sha256).toBe(
            createHash('sha256').update(content).digest('hex'),
          );
        });
    } finally {
      process.env.S3_ENDPOINT = originalEndpoint;
      if (originalTimeout === undefined) delete process.env.S3_TIMEOUT_MS;
      else process.env.S3_TIMEOUT_MS = originalTimeout;
      resetObjectStorageClient(storage);
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });

  it('expires sessions and aborts unfinished Multipart uploads', async () => {
    const token = await login(`minio-expired-${Date.now()}@example.test`);
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'expired.json',
        size: 1,
        mime: 'application/json',
      })
      .expect(201);
    const prisma = app.get(PrismaService);
    await prisma.uploadSession.update({
      where: { id: initiated.body.data.sessionId },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    await (
      app.get(UploadsService) as UploadsService & {
        cleanupExpired(): Promise<void>;
      }
    ).cleanupExpired();
    const expired = await prisma.uploadSession.findUniqueOrThrow({
      where: { id: initiated.body.data.sessionId },
    });
    expect(expired.status).toBe('EXPIRED');
    await expect(
      app
        .get(ObjectStorageService)
        .listParts(expired.objectKey, expired.uploadId as string),
    ).rejects.toBeDefined();
  });

  it('lets the import pipeline hash and parse an object-storage response stream', async () => {
    const prisma = app.get(PrismaService);
    const user = await prisma.user.create({
      data: {
        email: `minio-worker-${Date.now()}@example.test`,
        passwordHash: 'test-only',
        role: 'EDITOR',
      },
    });
    const content = Buffer.from(
      '{"schemaVersion":1,"questions":[],"source":"minio-stream"}',
    );
    const sha256 = createHash('sha256').update(content).digest('hex');
    const objectKey = `worker/${Date.now()}.json`;
    await app
      .get(ObjectStorageService)
      .putObject(objectKey, content, 'application/json');
    const fileObject = await prisma.fileObject.create({
      data: {
        objectKey,
        bucket: process.env.S3_BUCKET,
        storageBackend: 's3',
        ownerId: user.id,
        sha256,
        size: content.length,
        mime: 'application/json',
        verifiedAt: new Date(),
      },
    });
    await prisma.uploadSession.create({
      data: {
        userId: user.id,
        objectKey,
        bucket: process.env.S3_BUCKET,
        uploadId: 'completed-object',
        storageBackend: 's3',
        fileName: 'worker.json',
        size: content.length,
        mime: 'application/json',
        sha256,
        status: 'COMPLETED',
        partSize: 8 * 1024 * 1024,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const job = await prisma.importJob.create({
      data: {
        userId: user.id,
        fileObjectId: fileObject.id,
        idempotencyKey: `worker-stream-${Date.now()}`,
      },
    });
    await app.get(ImportJobsService).processJob(job.id);
    const completed = await prisma.importJob.findUniqueOrThrow({
      where: { id: job.id },
    });
    expect(completed.status).toBe('SUCCEEDED');
    expect(completed.totalItems).toBe(0);
    await app.get(ObjectStorageService).deleteObject(objectKey);

    const mismatchKey = `worker/${Date.now()}-mismatch.json`;
    await app
      .get(ObjectStorageService)
      .putObject(mismatchKey, content, 'application/json');
    const mismatchFile = await prisma.fileObject.create({
      data: {
        objectKey: mismatchKey,
        bucket: process.env.S3_BUCKET,
        storageBackend: 's3',
        ownerId: user.id,
        sha256: '0'.repeat(64),
        size: content.length,
        mime: 'application/json',
        verifiedAt: new Date(),
      },
    });
    await prisma.uploadSession.create({
      data: {
        userId: user.id,
        objectKey: mismatchKey,
        bucket: process.env.S3_BUCKET,
        uploadId: 'completed-object-mismatch',
        storageBackend: 's3',
        fileName: 'mismatch.json',
        size: content.length,
        mime: 'application/json',
        sha256: '0'.repeat(64),
        status: 'COMPLETED',
        partSize: 8 * 1024 * 1024,
        expiresAt: new Date(Date.now() + 60_000),
      },
    });
    const mismatchJob = await prisma.importJob.create({
      data: {
        userId: user.id,
        fileObjectId: mismatchFile.id,
        idempotencyKey: `worker-stream-mismatch-${Date.now()}`,
      },
    });
    await expect(
      app.get(ImportJobsService).processJob(mismatchJob.id),
    ).rejects.toBeInstanceOf(PermanentImportError);
    await app.get(ObjectStorageService).deleteObject(mismatchKey);
  });
});
