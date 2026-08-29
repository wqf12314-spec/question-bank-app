import { afterEach, beforeEach, describe, expect, it } from '@jest/globals';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { configureApp } from './../src/configure-app';
import { PrismaService } from './../src/prisma/prisma.service';
import * as bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { ReadinessAlertService } from './../src/observability/readiness-alert.service';
import { ImportJobsService } from './../src/import-jobs/import-jobs.service';
import PDFDocument from 'pdfkit';
import { createCanvas } from '@napi-rs/canvas';

function createPdfFixture(text: string) {
  return new Promise<Buffer>((resolve, reject) => {
    const document = new PDFDocument();
    const chunks: Buffer[] = [];
    document.on('data', (chunk: Buffer) => chunks.push(chunk));
    document.on('end', () => resolve(Buffer.concat(chunks)));
    document.on('error', reject);
    document.text(text);
    document.end();
  });
}

describe('AppController (e2e)', () => {
  let app: INestApplication<App>;

  async function loginAsEditor(email: string) {
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email,
        password: 'correct-password-123',
      })
      .expect(201);
    const user = await app.get(PrismaService).user.findUniqueOrThrow({
      where: { email },
    });
    await app.get(PrismaService).user.update({
      where: { id: user.id },
      data: { role: 'EDITOR' },
    });

    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email,
        password: 'correct-password-123',
      })
      .expect(201);

    return login.body.data.accessToken as string;
  }

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    // 显式监听一次，避免并发 Supertest 请求各自触发 listen/close 导致连接被重置。
    await app.listen(0);
  });

  afterEach(async () => {
    // 每个用例结束后清理测试数据，避免下次运行被上次结果影响。
    await app.get(ImportJobsService).waitForIdle();
    await app.get(PrismaService).importJob.deleteMany();
    await app.get(PrismaService).fileObject.deleteMany();
    await app.get(PrismaService).uploadPart.deleteMany();
    await app.get(PrismaService).uploadSession.deleteMany();
    await app.get(PrismaService).refreshSession.deleteMany();
    await app.get(PrismaService).user.deleteMany();
    await app.get(PrismaService).question.deleteMany();
    await app.close();
  });

  it('/ (GET)', () => {
    return request(app.getHttpServer())
      .get('/')
      .expect(200)
      .expect({ success: true, data: 'Hello World!' });
  });

  it('health/live 与 health/ready 区分进程存活和数据库就绪', async () => {
    const live = await request(app.getHttpServer())
      .get('/health/live')
      .expect(200);
    expect(live.body.data.status).toBe('ok');
    const ready = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(ready.body.data.dependencies).toEqual({
      postgres: 'ok',
      redis: 'not-configured',
      objectStorage: 'local-filesystem',
    });
    const metrics = await request(app.getHttpServer())
      .get('/health/metrics')
      .expect(200);
    expect(metrics.body.data.requests.total).toBeGreaterThanOrEqual(2);
    expect(metrics.body.data.requests).toHaveProperty('p95DurationMs');
    expect(metrics.body.data.importJobs).toMatchObject({
      completed: 0,
      failures: 0,
      failureRate: 0,
    });
  });

  it('health/ready 在本地对象目录不可用时返回 503', async () => {
    const previousUploadDir = process.env.UPLOAD_DIR;
    process.env.UPLOAD_DIR = `__missing-health-storage-${Date.now()}`;
    try {
      await request(app.getHttpServer())
        .get('/health/ready')
        .expect(503)
        .expect((response) => {
          expect(response.body.error.code).toBe('OBJECT_STORAGE_NOT_READY');
        });
    } finally {
      if (previousUploadDir === undefined) delete process.env.UPLOAD_DIR;
      else process.env.UPLOAD_DIR = previousUploadDir;
    }
  });

  it('health/ready 在 PostgreSQL 不可用时返回 503 并记录本地告警', async () => {
    const prisma = app.get(PrismaService);
    const originalQueryRaw = prisma.$queryRaw;
    (
      prisma as PrismaService & { $queryRaw: typeof prisma.$queryRaw }
    ).$queryRaw = async () => {
      throw new Error('simulated postgres outage');
    };
    try {
      await request(app.getHttpServer())
        .get('/health/ready')
        .expect(503)
        .expect((response) => {
          expect(response.body.error.code).toBe('POSTGRES_NOT_READY');
        });
      expect(app.get(ReadinessAlertService).snapshot()).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            dependency: 'postgres',
            message: 'simulated postgres outage',
          }),
        ]),
      );
    } finally {
      (
        prisma as PrismaService & { $queryRaw: typeof prisma.$queryRaw }
      ).$queryRaw = originalQueryRaw;
    }
  });

  it('Helmet 安全响应头和 CORS 白名单同时生效', async () => {
    const allowed = await request(app.getHttpServer())
      .get('/health/live')
      .set('Origin', 'http://localhost:5173')
      .expect(200);
    expect(allowed.headers['access-control-allow-origin']).toBe(
      'http://localhost:5173',
    );
    expect(allowed.headers['x-content-type-options']).toBe('nosniff');
    expect(allowed.headers['x-frame-options']).toBe('SAMEORIGIN');

    const rejected = await request(app.getHttpServer())
      .get('/health/live')
      .set('Origin', 'https://untrusted.example')
      .expect(200);
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('登录入口超过进程内限额后返回 429', async () => {
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await request(app.getHttpServer())
        .post('/auth/login')
        .send({
          email: `rate-limit-${attempt}@example.test`,
          password: 'wrong-password',
        })
        .expect(401);
    }
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'rate-limit-final@example.test',
        password: 'wrong-password',
      })
      .expect(429)
      .expect((response) => {
        expect(response.body.error.code).toBe('RATE_LIMITED');
        expect(response.headers['retry-after']).toBe('60');
      });
  });

  it('GET/questions返回测试库中的题目列表', () => {
    return request(app.getHttpServer())
      .get('/questions')
      .expect(200)
      .expect({ success: true, data: [] });
  });

  it('Questions API 支持服务端分页、关键词、分类和标签筛选', async () => {
    const prisma = app.get(PrismaService);
    await prisma.question.createMany({
      data: [
        {
          title: '__e2e_query_vue__',
          normalizedTitle: '__e2e_query_vue__',
          category: '前端',
          tags: '["Vue"]',
        },
        {
          title: '__e2e_query_react__',
          normalizedTitle: '__e2e_query_react__',
          category: '前端',
          tags: '["React"]',
        },
        {
          title: '__e2e_query_sql__',
          normalizedTitle: '__e2e_query_sql__',
          category: '后端',
          tags: '["SQL"]',
        },
      ],
    });
    const page = await request(app.getHttpServer())
      .get('/questions?page=2&pageSize=1')
      .expect(200);
    expect(page.body.data).toHaveLength(1);
    expect(page.body.data[0].title).toBe('__e2e_query_react__');

    const filtered = await request(app.getHttpServer())
      .get('/questions?keyword=sql&category=后端&tag=SQL')
      .expect(200);
    expect(filtered.body.data).toHaveLength(1);
    expect(filtered.body.data[0].title).toBe('__e2e_query_sql__');
  });

  it('本地分片上传按用户隔离并在合并时校验 SHA-256', async () => {
    async function registerAndLogin(email: string) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'correct-password-123' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'correct-password-123' })
        .expect(201);
      return login.body.data.accessToken as string;
    }

    const tokenA = await registerAndLogin('upload-a-e2e@example.test');
    const tokenB = await registerAndLogin('upload-b-e2e@example.test');
    // 使用带本地文件头的最小合法 ZIP，验证真实 MIME 检测不会接受随机伪 ZIP。
    const firstPart = Buffer.alloc(8 * 1024 * 1024, 'a');
    const secondPart = Buffer.from('finish');
    const zipHeader = Buffer.alloc(30);
    zipHeader.writeUInt32LE(0x04034b50, 0);
    zipHeader.writeUInt16LE(20, 4);
    zipHeader.writeUInt32LE(firstPart.length + secondPart.length, 18);
    zipHeader.writeUInt32LE(firstPart.length + secondPart.length, 22);
    const completeFile = Buffer.concat([zipHeader, firstPart, secondPart]);
    const firstZipPart = completeFile.subarray(0, 8 * 1024 * 1024);
    const secondZipPart = completeFile.subarray(8 * 1024 * 1024);
    const sha256 = createHash('sha256').update(completeFile).digest('hex');

    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${tokenA}`)
      .send({
        fileName: 'interview-screenshots.zip',
        size: completeFile.length,
        mime: 'application/zip',
        sha256,
      })
      .expect(201);
    const sessionId = initiated.body.data.sessionId as string;

    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/1`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Content-Type', 'application/octet-stream')
      .send(firstZipPart)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/2`)
      .set('Authorization', `Bearer ${tokenA}`)
      .set('Content-Type', 'application/octet-stream')
      .send(secondZipPart)
      .expect(201);

    const status = await request(app.getHttpServer())
      .get(`/uploads/${sessionId}`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(200);
    expect(status.body.data.uploadedParts).toHaveLength(2);

    await request(app.getHttpServer())
      .get(`/uploads/${sessionId}`)
      .set('Authorization', `Bearer ${tokenB}`)
      .expect(404);

    const completed = await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/complete`)
      .set('Authorization', `Bearer ${tokenA}`)
      .expect(201);
    expect(completed.body.data.sha256).toBe(sha256);
    expect(completed.body.data.size).toBe(completeFile.length);
  });

  it('上传时立即拒绝短分片和越界编号，同时接受合法尾片', async () => {
    const token = await loginAsEditor('upload-part-boundary-e2e@example.test');
    const prefix = Buffer.from('{"schemaVersion":1,"questions":[],"padding":"');
    const suffix = Buffer.from('"}');
    const expectedPartSize = 8 * 1024 * 1024;
    const content = Buffer.concat([
      prefix,
      Buffer.alloc(expectedPartSize + 3 - prefix.length - suffix.length, 0x61),
      suffix,
    ]);
    const sha256 = createHash('sha256').update(content).digest('hex');
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'part-boundary.json',
        size: content.length,
        mime: 'application/json',
        sha256,
      })
      .expect(201);
    const sessionId = initiated.body.data.sessionId as string;
    const partSize = initiated.body.data.partSize as number;
    expect(partSize).toBe(expectedPartSize);

    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content.subarray(0, partSize - 1))
      .expect(400)
      .expect((response) => {
        expect(response.body.error.message).toBe('Invalid part size');
      });
    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/3`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(Buffer.from('x'))
      .expect(400)
      .expect((response) => {
        expect(response.body.error.message).toBe('Invalid part number');
      });

    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content.subarray(0, partSize))
      .expect(201);
    const tail = await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/2`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content.subarray(partSize))
      .expect(201);
    expect(tail.body.data.size).toBe(3);

    const completed = await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(completed.body.data.sha256).toBe(sha256);
  });

  it('真实上传 100 MiB 文件并通过服务端流式 SHA-256 校验', async () => {
    const token = await loginAsEditor('upload-100m-e2e@example.test');
    const totalSize = 100 * 1024 * 1024;
    const prefix = Buffer.from('{"schemaVersion":1,"questions":[],"padding":"');
    const suffix = Buffer.from('"}');
    const content = Buffer.concat([
      prefix,
      Buffer.alloc(totalSize - prefix.length - suffix.length, 0x61),
      suffix,
    ]);
    const sha256 = createHash('sha256').update(content).digest('hex');
    let sessionId: string | undefined;
    try {
      const initiated = await request(app.getHttpServer())
        .post('/uploads/initiate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileName: 'large-question-bank.json',
          size: content.length,
          mime: 'application/json',
          sha256,
        })
        .expect(201);
      sessionId = initiated.body.data.sessionId as string;
      const partSize = initiated.body.data.partSize as number;
      const partCount = Math.ceil(content.length / partSize);
      expect(partCount).toBe(13);
      for (let index = 0; index < partCount; index += 1) {
        await request(app.getHttpServer())
          .post(`/uploads/${sessionId}/parts/${index + 1}`)
          .set('Authorization', `Bearer ${token}`)
          .set('Content-Type', 'application/octet-stream')
          .send(content.subarray(index * partSize, (index + 1) * partSize))
          .expect(201);
      }
      const completed = await request(app.getHttpServer())
        .post(`/uploads/${sessionId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      expect(completed.body.data.sha256).toBe(sha256);
      expect(completed.body.data.size).toBe(totalSize);
    } finally {
      if (sessionId) {
        const uploadRoot = join(process.cwd(), '.data', 'uploads');
        const names = await fs.readdir(uploadRoot).catch(() => [] as string[]);
        await Promise.all(
          names
            .filter((name) => name.startsWith(`${sessionId}.`))
            .map((name) => fs.rm(join(uploadRoot, name), { force: true })),
        );
      }
    }
  }, 60000);

  it('上传完成后创建本地 ImportJob，重复提交返回同一个任务', async () => {
    const token = await loginAsEditor('import-job-e2e@example.test');
    const content = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        questions: [
          {
            title: '异步导入测试题',
            category: 'E2E',
            answer: '答案',
            tags: ['任务'],
          },
        ],
      }),
    );
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'question-bank.json',
        size: content.length,
        mime: 'application/json',
      })
      .expect(201);
    const sessionId = initiated.body.data.sessionId as string;
    const uploaded = await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(201);
    expect(uploaded.body.data.partNumber).toBe(1);
    const file = await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const fileObjectId = file.body.data.id as number;

    const first = await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileObjectId, idempotencyKey: 'import-job-e2e-key' })
      .expect(201);
    expect(first.body.data.requestId).toBe(first.headers['x-request-id']);
    const second = await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileObjectId, idempotencyKey: 'import-job-e2e-key' })
      .expect(201);
    expect(second.body.data.id).toBe(first.body.data.id);

    const events = await request(app.getHttpServer())
      .get(`/import-jobs/${first.body.data.id}/events`)
      .set('Authorization', `Bearer ${token}`)
      .set('Last-Event-ID', '0')
      .expect(200);
    expect(events.headers['content-type']).toMatch(/text\/event-stream/);
    expect(events.text).toContain('event: snapshot');

    const otherToken = await loginAsEditor('import-job-other-e2e@example.test');
    await request(app.getHttpServer())
      .get(`/import-jobs/${first.body.data.id}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({ fileObjectId, idempotencyKey: 'cross-user-job' })
      .expect(404);

    let status = first.body.data.status;
    for (
      let attempt = 0;
      attempt < 20 && !['SUCCEEDED', 'FAILED'].includes(status);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      const current = await request(app.getHttpServer())
        .get(`/import-jobs/${first.body.data.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      status = current.body.data.status;
    }
    expect(status).toBe('SUCCEEDED');
    const completedJob = await request(app.getHttpServer())
      .get(`/import-jobs/${first.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(completedJob.body.data).toMatchObject({
      totalItems: 1,
      importedItems: 1,
      skippedItems: 0,
      failedItems: 0,
    });
    expect(completedJob.body.data.parsingDurationMs).toEqual(
      expect.any(Number),
    );
    expect(completedJob.body.data.validatingDurationMs).toEqual(
      expect.any(Number),
    );
    await request(app.getHttpServer())
      .get(`/questions?keyword=${encodeURIComponent('异步导入测试题')}`)
      .expect(200)
      .expect((response) => expect(response.body.data).toHaveLength(1));
  });

  it('并发创建同一 ImportJob 由数据库唯一约束仲裁，不需要 Redis 业务锁', async () => {
    const token = await loginAsEditor('redis-lock-boundary-e2e@example.test');
    const content = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        questions: [{ title: '__e2e_redis_lock_boundary__', category: 'E2E' }],
      }),
    );
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'redis-lock-boundary.json',
        size: content.length,
        mime: 'application/json',
      })
      .expect(201);
    const sessionId = initiated.body.data.sessionId as string;
    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(201);
    const file = await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const fileObjectId = file.body.data.id as number;
    const idempotencyKey = 'redis-lock-boundary-key';

    const responses = await Promise.all(
      Array.from({ length: 12 }, () =>
        request(app.getHttpServer())
          .post('/import-jobs')
          .set('Authorization', `Bearer ${token}`)
          .send({ fileObjectId, idempotencyKey })
          .expect(201),
      ),
    );

    const jobIds = new Set(responses.map((response) => response.body.data.id));
    expect(jobIds.size).toBe(1);
    expect(
      await app.get(PrismaService).importJob.count({
        where: { idempotencyKey },
      }),
    ).toBe(1);
  });

  it('PDF 仅能进入审核管线，并以 Draft 和真实提取指标等待人工发布', async () => {
    const token = await loginAsEditor('pdf-review-e2e@example.test');
    const content = await createPdfFixture('PDF draft extraction proof');
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'review-proof.pdf',
        size: content.length,
        mime: 'application/pdf',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/uploads/${initiated.body.data.sessionId}/parts/1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(201);
    const file = await request(app.getHttpServer())
      .post(`/uploads/${initiated.body.data.sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);

    await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileObjectId: file.body.data.id, pipelineVersion: 'v1' })
      .expect(400);

    const created = await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileObjectId: file.body.data.id,
        pipelineVersion: 'review-v1',
        idempotencyKey: 'pdf-review-draft-job',
      })
      .expect(201);
    let current = created.body.data;
    for (
      let attempt = 0;
      attempt < 50 && current.status !== 'WAITING_REVIEW';
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current = (
        await request(app.getHttpServer())
          .get(`/import-jobs/${created.body.data.id}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body.data;
    }
    expect(current.status).toBe('WAITING_REVIEW');
    expect(JSON.parse(current.extractionMetrics)).toMatchObject({
      provider: 'pdf-parse',
      language: null,
      cost: 0,
    });
    const draft = await app.get(PrismaService).question.findFirstOrThrow({
      where: { importJobId: current.id },
    });
    expect(draft.status).toBe('DRAFT');
    expect(draft.answer).toContain('PDF draft extraction proof');
  }, 30_000);

  it('无文字层的 PDF 审核导入会失败并留下提取失败指标', async () => {
    const token = await loginAsEditor('pdf-empty-e2e@example.test');
    const content = await createPdfFixture('');
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'empty-text-layer.pdf',
        size: content.length,
        mime: 'application/pdf',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/uploads/${initiated.body.data.sessionId}/parts/1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(201);
    const file = await request(app.getHttpServer())
      .post(`/uploads/${initiated.body.data.sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const created = await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileObjectId: file.body.data.id,
        pipelineVersion: 'review-v1',
        idempotencyKey: 'pdf-empty-job',
      })
      .expect(201);
    let current = created.body.data;
    for (
      let attempt = 0;
      attempt < 50 && current.status !== 'FAILED';
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current = (
        await request(app.getHttpServer())
          .get(`/import-jobs/${created.body.data.id}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body.data;
    }
    expect(current.status).toBe('FAILED');
    expect(JSON.parse(current.extractionMetrics)).toMatchObject({
      provider: 'pdf-parse',
      language: null,
      cost: 0,
      failure: expect.stringContaining('PDF has no extractable text layer'),
    });
  }, 30_000);

  it('真实 PNG OCR 只生成 Draft，并在审核任务中保存本地识别指标', async () => {
    const token = await loginAsEditor('ocr-review-e2e@example.test');
    const canvas = createCanvas(900, 180);
    const context = canvas.getContext('2d');
    context.fillStyle = 'white';
    context.fillRect(0, 0, 900, 180);
    context.fillStyle = 'black';
    context.font = 'bold 64px sans-serif';
    context.fillText('OCR DRAFT PROOF', 40, 110);
    const content = canvas.toBuffer('image/png');
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'ocr-review-proof.png',
        size: content.length,
        mime: 'image/png',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/uploads/${initiated.body.data.sessionId}/parts/1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(201);
    const file = await request(app.getHttpServer())
      .post(`/uploads/${initiated.body.data.sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const created = await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileObjectId: file.body.data.id,
        pipelineVersion: 'review-v1',
        idempotencyKey: 'ocr-review-draft-job',
      })
      .expect(201);
    let current = created.body.data;
    for (
      let attempt = 0;
      attempt < 100 && current.status !== 'WAITING_REVIEW';
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 30));
      current = (
        await request(app.getHttpServer())
          .get(`/import-jobs/${created.body.data.id}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body.data;
    }
    expect(current.status).toBe('WAITING_REVIEW');
    expect(JSON.parse(current.extractionMetrics)).toMatchObject({
      provider: 'tesseract.js',
      language: 'eng',
      cost: 0,
    });
    const draft = await app.get(PrismaService).question.findFirstOrThrow({
      where: { importJobId: current.id },
    });
    expect(draft.status).toBe('DRAFT');
    expect(draft.answer.toUpperCase()).toContain('OCR');
  }, 60_000);

  it('LEARNER 绕过页面直接创建 ImportJob 仍返回 403', async () => {
    const email = 'import-job-learner-e2e@example.test';
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'correct-password-123' })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'correct-password-123' })
      .expect(201);

    await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${login.body.data.accessToken}`)
      .send({ fileObjectId: 1, idempotencyKey: 'learner-bypass' })
      .expect(403);
  });

  it('未显式提供幂等键时按文件 SHA-256 和 pipelineVersion 复用任务', async () => {
    const token = await loginAsEditor(
      'import-job-generated-key-e2e@example.test',
    );
    const content = Buffer.from(
      JSON.stringify({ schemaVersion: 1, questions: [] }),
    );
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'generated-key.json',
        size: content.length,
        mime: 'application/json',
      })
      .expect(201);
    const sessionId = initiated.body.data.sessionId as string;
    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(201);
    const file = await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const body = { fileObjectId: file.body.data.id, pipelineVersion: 'v1' };
    const first = await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    const third = await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(third.body.data.id).toBe(first.body.data.id);
  });

  it('ImportJob 遇到非法 JSON 时进入 FAILED 并保留失败原因', async () => {
    const token = await loginAsEditor('import-job-failed-e2e@example.test');
    const content = Buffer.from(
      JSON.stringify({ schemaVersion: 2, questions: [] }),
    );
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'invalid.json',
        size: content.length,
        mime: 'application/json',
      })
      .expect(201);
    const sessionId = initiated.body.data.sessionId as string;
    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(201);
    const file = await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const created = await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileObjectId: file.body.data.id,
        idempotencyKey: 'invalid-json-job',
      })
      .expect(201);

    let current = created.body.data;
    for (
      let attempt = 0;
      attempt < 20 && !['SUCCEEDED', 'FAILED'].includes(current.status);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current = (
        await request(app.getHttpServer())
          .get(`/import-jobs/${current.id}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body.data;
    }
    expect(current.status).toBe('FAILED');
    expect(current.errorMessage).toContain('Invalid question bank schema');
    expect(JSON.parse(current.failureReport)).toEqual([
      { index: 0, reason: 'Invalid question bank schema' },
    ]);
  });

  it('ImportJob 部分题目非法时进入 PARTIAL 并返回逐项失败报告', async () => {
    const token = await loginAsEditor('import-job-report-e2e@example.test');
    const content = Buffer.from(
      JSON.stringify({
        schemaVersion: 1,
        questions: [
          { title: '__e2e_report_valid__', category: 'E2E测试' },
          { title: 123, category: 'E2E测试' },
        ],
      }),
    );
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'partial-report.json',
        size: content.length,
        mime: 'application/json',
      })
      .expect(201);
    const sessionId = initiated.body.data.sessionId as string;
    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(201);
    const file = await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    const created = await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileObjectId: file.body.data.id,
        idempotencyKey: 'partial-report-job',
      })
      .expect(201);

    let current = created.body.data;
    for (
      let attempt = 0;
      attempt < 20 &&
      !['SUCCEEDED', 'PARTIAL', 'FAILED'].includes(current.status);
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      current = (
        await request(app.getHttpServer())
          .get(`/import-jobs/${current.id}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body.data;
    }
    expect(current.status).toBe('PARTIAL');
    expect(current.totalItems).toBe(2);
    expect(current.importedItems).toBe(1);
    expect(current.failedItems).toBe(1);
    expect(JSON.parse(current.failureReport)).toEqual([
      { index: 2, reason: '题目必须是包含字符串 title 的对象' },
    ]);
  });

  it('ImportJob 支持取消和失败后重试', async () => {
    const token = await loginAsEditor('import-job-actions-e2e@example.test');
    async function createJob(idempotencyKey: string) {
      const content = Buffer.from(
        JSON.stringify({ schemaVersion: 2, questions: [] }),
      );
      const initiated = await request(app.getHttpServer())
        .post('/uploads/initiate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileName: `${idempotencyKey}.json`,
          size: content.length,
          mime: 'application/json',
        })
        .expect(201);
      const sessionId = initiated.body.data.sessionId as string;
      await request(app.getHttpServer())
        .post(`/uploads/${sessionId}/parts/1`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/octet-stream')
        .send(content)
        .expect(201);
      const file = await request(app.getHttpServer())
        .post(`/uploads/${sessionId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
      return request(app.getHttpServer())
        .post('/import-jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({ fileObjectId: file.body.data.id, idempotencyKey })
        .expect(201);
    }

    const cancellable = await createJob('cancel-action');
    const cancelled = await request(app.getHttpServer())
      .post(`/import-jobs/${cancellable.body.data.id}/cancel`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(cancelled.body.data.status).toBe('CANCELLED');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const cancelledAfterWorkerSettled = await request(app.getHttpServer())
      .get(`/import-jobs/${cancellable.body.data.id}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(cancelledAfterWorkerSettled.body.data.status).toBe('CANCELLED');

    const retryable = await createJob('retry-action');
    let failed = retryable.body.data;
    for (
      let attempt = 0;
      attempt < 20 && failed.status !== 'FAILED';
      attempt += 1
    ) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      failed = (
        await request(app.getHttpServer())
          .get(`/import-jobs/${failed.id}`)
          .set('Authorization', `Bearer ${token}`)
          .expect(200)
      ).body.data;
    }
    expect(failed.status).toBe('FAILED');
    const retried = await request(app.getHttpServer())
      .post(`/import-jobs/${failed.id}/retry`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    expect(retried.body.data.status).toBe('QUEUED');
  });

  it('分片合并时 Hash 不匹配会失败并标记会话 FAILED', async () => {
    const token = await loginAsEditor('upload-hash-failure-e2e@example.test');
    const content = Buffer.from('tampered-content');
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'wrong-hash.json',
        size: content.length,
        mime: 'application/json',
        sha256: '0'.repeat(64),
      })
      .expect(201);
    const sessionId = initiated.body.data.sessionId as string;

    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    const status = await request(app.getHttpServer())
      .get(`/uploads/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(status.body.data.status).toBe('FAILED');
  });

  it('越界分片会立即拒绝且上传会话不能完成', async () => {
    const token = await loginAsEditor('upload-missing-part-e2e@example.test');
    const content = Buffer.from('{"schemaVersion":1,"questions":[]}');
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'missing-part.json',
        size: content.length + 1,
        mime: 'application/json',
      })
      .expect(201);
    const sessionId = initiated.body.data.sessionId as string;

    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/2`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(400);

    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);

    const status = await request(app.getHttpServer())
      .get(`/uploads/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(status.body.data.status).toBe('FAILED');
  });

  it('上传初始化拒绝不在业务白名单中的 MIME 类型', async () => {
    const token = await loginAsEditor('upload-mime-e2e@example.test');
    await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'payload.exe',
        size: 10,
        mime: 'application/x-msdownload',
      })
      .expect(400);
  });

  it('上传初始化拒绝超出用户累计字节配额的文件', async () => {
    const email = 'upload-quota-e2e@example.test';
    const token = await loginAsEditor(email);
    const user = await app
      .get(PrismaService)
      .user.findUniqueOrThrow({ where: { email } });
    await app.get(PrismaService).fileObject.create({
      data: {
        objectKey: `quota/${user.id}/reserved`,
        ownerId: user.id,
        sha256: 'f'.repeat(64),
        size: 2 * 1024 * 1024 * 1024 - 1024,
        mime: 'application/json',
        verifiedAt: new Date(),
      },
    });

    await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'over-quota.json',
        size: 2048,
        mime: 'application/json',
      })
      .expect(400)
      .expect((response) => {
        expect(response.body.error.code).toBe('UPLOAD_QUOTA_EXCEEDED');
      });
  });

  it('同一用户秒传、跨用户物理去重且不泄露对象键', async () => {
    const token = await loginAsEditor('upload-dedupe-e2e@example.test');
    const content = Buffer.from('{"schemaVersion":1,"questions":[]}');
    async function completeUpload() {
      const initiated = await request(app.getHttpServer())
        .post('/uploads/initiate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileName: 'same.json',
          size: content.length,
          mime: 'application/json',
          sha256: createHash('sha256').update(content).digest('hex'),
        })
        .expect(201);
      if (initiated.body.data.fileObjectId) {
        return {
          body: {
            data: {
              id: initiated.body.data.fileObjectId,
              sha256: createHash('sha256').update(content).digest('hex'),
            },
          },
        };
      }
      const sessionId = initiated.body.data.sessionId as string;
      await request(app.getHttpServer())
        .post(`/uploads/${sessionId}/parts/1`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/octet-stream')
        .send(content)
        .expect(201);
      return request(app.getHttpServer())
        .post(`/uploads/${sessionId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(201);
    }
    const first = await completeUpload();
    const second = await completeUpload();
    const third = await completeUpload();
    expect(second.body.data.id).toBe(first.body.data.id);
    expect(third.body.data.id).toBe(first.body.data.id);
    expect(
      await app
        .get(PrismaService)
        .fileObject.count({ where: { sha256: first.body.data.sha256 } }),
    ).toBe(1);

    const otherToken = await loginAsEditor(
      'upload-dedupe-other-e2e@example.test',
    );
    const otherInitiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${otherToken}`)
      .send({
        fileName: 'same.json',
        size: content.length,
        mime: 'application/json',
        sha256: createHash('sha256').update(content).digest('hex'),
      })
      .expect(201);
    expect(otherInitiated.body.data.fileObjectId).toBeUndefined();
    expect(otherInitiated.body.data.sessionId).toEqual(expect.any(String));
    await request(app.getHttpServer())
      .get(`/uploads/${otherInitiated.body.data.sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(404);
    const otherSessionId = otherInitiated.body.data.sessionId as string;
    await request(app.getHttpServer())
      .post(`/uploads/${otherSessionId}/parts/1`)
      .set('Authorization', `Bearer ${otherToken}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(201);
    const otherCompleted = await request(app.getHttpServer())
      .post(`/uploads/${otherSessionId}/complete`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(201);
    expect(otherCompleted.body.data).not.toHaveProperty('objectKey');
    expect(otherCompleted.body.data).not.toHaveProperty('ownerId');
    expect(
      await app.get(PrismaService).fileObject.count({
        where: { sha256: first.body.data.sha256 },
      }),
    ).toBe(2);
    const [firstFile, secondFile] = await app
      .get(PrismaService)
      .fileObject.findMany({
        where: { sha256: first.body.data.sha256 },
        orderBy: { ownerId: 'asc' },
      });
    expect(secondFile.ownerId).not.toBe(firstFile.ownerId);
    expect(secondFile.objectKey).toBe(firstFile.objectKey);
    const physicalSession = await app
      .get(PrismaService)
      .uploadSession.findFirstOrThrow({
        where: { objectKey: firstFile.objectKey, status: 'COMPLETED' },
      });
    const physicalPath = join(
      process.cwd(),
      '.data',
      'uploads',
      `${physicalSession.id}.complete`,
    );
    await expect(fs.access(physicalPath)).resolves.toBeUndefined();
    const sharedImport = await app.get(PrismaService).importJob.create({
      data: {
        userId: secondFile.ownerId,
        fileObjectId: secondFile.id,
        idempotencyKey: `cross-user-shared-${Date.now()}`,
      },
    });
    await app.get(ImportJobsService).processJob(sharedImport.id);
    await expect(
      app.get(PrismaService).importJob.findUniqueOrThrow({
        where: { id: sharedImport.id },
      }),
    ).resolves.toMatchObject({ status: 'SUCCEEDED' });
  });

  it('上传完成会拒绝 ZIP 路径穿越内容', async () => {
    const token = await loginAsEditor('upload-zip-safety-e2e@example.test');
    const name = Buffer.from('../escape.txt');
    const header = Buffer.alloc(30);
    header.writeUInt32LE(0x04034b50, 0);
    header.writeUInt16LE(name.length, 26);
    const content = Buffer.concat([header, name]);
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({
        fileName: 'unsafe.zip',
        size: content.length,
        mime: 'application/zip',
        sha256: createHash('sha256').update(content).digest('hex'),
      })
      .expect(201);
    const sessionId = initiated.body.data.sessionId as string;
    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/parts/1`)
      .set('Authorization', `Bearer ${token}`)
      .set('Content-Type', 'application/octet-stream')
      .send(content)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/uploads/${sessionId}/complete`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
    const status = await request(app.getHttpServer())
      .get(`/uploads/${sessionId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(status.body.data.status).toBe('FAILED');
  });

  it('上传完成会拒绝超过文件数或解压体积限制的 ZIP', async () => {
    const token = await loginAsEditor('upload-zip-limits-e2e@example.test');
    function localHeader(name: string, uncompressedSize = 0) {
      const nameBuffer = Buffer.from(name);
      const header = Buffer.alloc(30);
      header.writeUInt32LE(0x04034b50, 0);
      header.writeUInt16LE(nameBuffer.length, 26);
      header.writeUInt32LE(0, 18);
      header.writeUInt32LE(uncompressedSize, 22);
      return Buffer.concat([header, nameBuffer]);
    }
    const oversizedCount = Buffer.concat(
      Array.from({ length: 1001 }, (_, index) =>
        localHeader(`entry-${index}.txt`),
      ),
    );
    const oversizedVolume = localHeader('huge.txt', 100 * 1024 * 1024 + 1);
    for (const [fileName, content] of [
      ['too-many.zip', oversizedCount],
      ['too-large.zip', oversizedVolume],
    ] as const) {
      const initiated = await request(app.getHttpServer())
        .post('/uploads/initiate')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileName,
          size: content.length,
          mime: 'application/zip',
          sha256: createHash('sha256').update(content).digest('hex'),
        })
        .expect(201);
      const sessionId = initiated.body.data.sessionId as string;
      await request(app.getHttpServer())
        .post(`/uploads/${sessionId}/parts/1`)
        .set('Authorization', `Bearer ${token}`)
        .set('Content-Type', 'application/octet-stream')
        .send(content)
        .expect(201);
      await request(app.getHttpServer())
        .post(`/uploads/${sessionId}/complete`)
        .set('Authorization', `Bearer ${token}`)
        .expect(400);
      const status = await request(app.getHttpServer())
        .get(`/uploads/${sessionId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(status.body.data.status).toBe('FAILED');
    }
  });

  it('成功和错误响应都返回可追踪的 requestId', async () => {
    const success = await request(app.getHttpServer())
      .get('/questions')
      .expect(200);
    const successRequestId = success.headers['x-request-id'];
    expect(successRequestId).toEqual(expect.any(String));
    expect(successRequestId).toHaveLength(36);

    const failure = await request(app.getHttpServer())
      .get('/questions/999999999')
      .expect(404);
    expect(failure.headers['x-request-id']).toEqual(expect.any(String));
    expect(failure.headers['x-request-id']).not.toEqual(successRequestId);
    expect(failure.body.error.requestId).toEqual(
      failure.headers['x-request-id'],
    );
  });

  it('POST/questions/import导入题目', async () => {
    const accessToken = await loginAsEditor('normal-import-e2e@example.test');
    return request(app.getHttpServer())
      .post('/questions/import')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        schemaVersion: 1,
        questions: [
          {
            title: '__e2e_normal_import__',
            category: 'E2E测试',
            tags: ['integration'],
          },
        ],
      })
      .expect(201)
      .expect({
        success: true,
        data: {
          importedCount: 1,
          skippedCount: 0,
        },
      });
  });
  it('同一次批量导入会跳过规范化标题重复的题目', async () => {
    const accessToken = await loginAsEditor('batch-duplicate-e2e@example.test');
    const questions = [
      {
        title: '__e2e_batch_duplicate__',
        category: 'E2E测试',
      },
      {
        // 前后空格不同，但规范化后应该视为同一道题。
        title: '  __e2e_batch_duplicate__  ',
        category: 'E2E测试',
      },
    ];
    const response = await request(app.getHttpServer())
      .post('/questions/import')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        schemaVersion: 1,
        questions,
      })
      .expect(201);

    expect(response.body).toEqual({
      success: true,
      data: {
        importedCount: 1,
        skippedCount: 1,
      },
    });
    const savedCount = await app.get(PrismaService).question.count({
      where: {
        normalizedTitle: '__e2e_batch_duplicate__',
      },
    });

    // 响应统计和数据库真实结果必须一致。
    expect(savedCount).toBe(1);
  });
  it('再次导入数据库已有题目时会跳过', async () => {
    const accessToken = await loginAsEditor(
      'existing-duplicate-e2e@example.test',
    );
    const questions = [
      {
        title: '__e2e_existing_duplicate__',
        category: 'E2E测试',
      },
    ];
    const firstResponse = await request(app.getHttpServer())
      .post('/questions/import')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        schemaVersion: 1,
        questions,
      })
      .expect(201);

    expect(firstResponse.body.data).toEqual({
      importedCount: 1,
      skippedCount: 0,
    });
    const secondResponse = await request(app.getHttpServer())
      .post('/questions/import')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        schemaVersion: 1,
        questions,
      })
      .expect(201);

    expect(secondResponse.body.data).toEqual({
      importedCount: 0,
      skippedCount: 1,
    });
    const savedCount = await app.get(PrismaService).question.count({
      where: {
        normalizedTitle: '__e2e_existing_duplicate__',
      },
    });

    // 重复请求不能让数据库产生第二条记录。
    expect(savedCount).toBe(1);
  });
  it('并发导入相同标题时数据库最终只保存一条', async () => {
    const accessToken = await loginAsEditor(
      'concurrent-duplicate-e2e@example.test',
    );
    const payload = {
      schemaVersion: 1,
      questions: [
        {
          title: '__e2e_concurrent_duplicate__',
          category: 'E2E测试',
        },
      ],
    };
    const requests = Array.from({ length: 10 }, () =>
      request(app.getHttpServer())
        .post('/questions/import')
        .set('Authorization', `Bearer ${accessToken}`)
        .send(payload)
        .expect(201),
    );

    const responses = await Promise.all(requests);

    const importedTotal = responses.reduce(
      (total, response) => total + response.body.data.importedCount,
      0,
    );
    expect(importedTotal).toBe(1);

    const skippedTotal = responses.reduce(
      (total, response) => total + response.body.data.skippedCount,
      0,
    );
    expect(skippedTotal).toBe(9);
    const savedCount = await app.get(PrismaService).question.count({
      where: {
        normalizedTitle: '__e2e_concurrent_duplicate__',
      },
    });
    // 并发请求的最终数据库状态必须只有一条。
    expect(savedCount).toBe(1);
  });

  it('并发新增相同标题时一个成功，另一个返回明确重复错误', async () => {
    const accessToken = await loginAsEditor(
      'concurrent-single-create-e2e@example.test',
    );
    const payload = {
      title: '__e2e_concurrent_single_create__',
      category: 'E2E测试',
    };

    const responses = await Promise.all(
      Array.from({ length: 2 }, () =>
        request(app.getHttpServer())
          .post('/questions')
          .set('Authorization', `Bearer ${accessToken}`)
          .send(payload),
      ),
    );

    expect(responses.map((response) => response.status).sort()).toEqual([
      201, 409,
    ]);
    const conflict = responses.find((response) => response.status === 409);
    expect(conflict?.body.error.code).toBe('QUESTION_TITLE_DUPLICATE');
    expect(
      await app.get(PrismaService).question.count({
        where: { normalizedTitle: payload.title },
      }),
    ).toBe(1);
  });

  it('单题新增会由后端生成规范化标题', async () => {
    const accessToken = await loginAsEditor('single-create-e2e@example.test');
    const response = await request(app.getHttpServer())
      .post('/questions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: '  __e2e_single_create__  ',
        category: 'E2E测试',
      })
      .expect(201);
    expect(response.body.data.normalizedTitle).toBe('__e2e_single_create__');
    expect(response.body.data.status).toBe('DRAFT');

    const saved = await app.get(PrismaService).question.findFirst({
      where: { normalizedTitle: '__e2e_single_create__' },
    });

    expect(saved?.title).toBe('__e2e_single_create__');
  });
  it('单题修改会同步更新规范化标题', async () => {
    const accessToken = await loginAsEditor('single-update-e2e@example.test');

    const created = await request(app.getHttpServer())
      .post('/questions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: '__e2e_update_before__',
        category: 'E2E测试',
      })
      .expect(201);

    const updated = await request(app.getHttpServer())
      .patch(`/questions/${created.body.data.id}`)
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: '  __e2e_update_after__  ',
        category: 'E2E测试',
        version: created.body.data.version,
      })
      .expect(200);

    expect(updated.body.data.normalizedTitle).toBe('__e2e_update_after__');

    const saved = await app.get(PrismaService).question.findUnique({
      where: { id: created.body.data.id },
    });

    expect(saved?.title).toBe('__e2e_update_after__');
    expect(saved?.normalizedTitle).toBe('__e2e_update_after__');
    expect(saved?.version).toBe(2);
    const revision = await app.get(PrismaService).questionRevision.findFirst({
      where: { questionId: created.body.data.id },
    });
    expect(JSON.parse(revision!.beforeJson).version).toBe(1);
    expect(JSON.parse(revision!.afterJson).version).toBe(2);
    const audit = await app.get(PrismaService).auditLog.findFirst({
      where: { questionId: created.body.data.id, action: 'QUESTION_UPDATED' },
    });
    expect(audit?.entityType).toBe('Question');
  });

  it('并发修改同一题目时旧版本返回 409，不静默覆盖', async () => {
    const accessToken = await loginAsEditor(
      'question-version-conflict-e2e@example.test',
    );
    const created = await request(app.getHttpServer())
      .post('/questions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({ title: '__e2e_version_conflict__', category: 'E2E测试' })
      .expect(201);
    const payload = {
      category: 'E2E测试',
      version: created.body.data.version,
    };
    const [first, second] = await Promise.all([
      request(app.getHttpServer())
        .patch(`/questions/${created.body.data.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...payload, title: '__e2e_version_first__' }),
      request(app.getHttpServer())
        .patch(`/questions/${created.body.data.id}`)
        .set('Authorization', `Bearer ${accessToken}`)
        .send({ ...payload, title: '__e2e_version_second__' }),
    ]);
    expect([first.status, second.status].sort()).toEqual([200, 409]);
    const conflict = first.status === 409 ? first : second;
    expect(conflict.body.error.code).toBe('QUESTION_VERSION_CONFLICT');
    const saved = await app
      .get(PrismaService)
      .question.findUnique({ where: { id: created.body.data.id } });
    expect(saved?.version).toBe(2);
    expect(['__e2e_version_first__', '__e2e_version_second__']).toContain(
      saved?.title,
    );
    expect(
      await app.get(PrismaService).questionRevision.count({
        where: { questionId: created.body.data.id },
      }),
    ).toBe(1);
    expect(
      await app
        .get(PrismaService)
        .auditLog.count({ where: { questionId: created.body.data.id } }),
    ).toBe(1);
  });

  it('编辑者只能提交草稿，管理员才能审核发布并查询修订', async () => {
    const editorToken = await loginAsEditor(
      'question-status-editor-e2e@example.test',
    );
    const created = await request(app.getHttpServer())
      .post('/questions')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ title: '__e2e_status_transition__', category: 'E2E测试' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/questions/${created.body.data.id}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ status: 'PUBLISHED', version: created.body.data.version })
      .expect(400);

    const submitted = await request(app.getHttpServer())
      .post(`/questions/${created.body.data.id}/status`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ status: 'IN_REVIEW' })
      .expect(201);
    expect(submitted.body.data.status).toBe('IN_REVIEW');
    await request(app.getHttpServer())
      .post(`/questions/${created.body.data.id}/status`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ status: 'PUBLISHED' })
      .expect(403);

    const admin = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'question-status-admin-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    await app.get(PrismaService).user.update({
      where: { id: admin.body.data.id },
      data: { role: 'ADMIN' },
    });
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'question-status-admin-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    const published = await request(app.getHttpServer())
      .post(`/questions/${created.body.data.id}/status`)
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .send({ status: 'PUBLISHED' })
      .expect(201);
    expect(published.body.data.status).toBe('PUBLISHED');

    const revisions = await request(app.getHttpServer())
      .get(`/questions/${created.body.data.id}/revisions`)
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .expect(200);
    expect(revisions.body.data.length).toBe(2);
    expect(revisions.body.data[0].reason).toBe('STATUS_PUBLISHED');
    expect(
      await app
        .get(PrismaService)
        .auditLog.count({ where: { questionId: created.body.data.id } }),
    ).toBe(2);
  });

  it('管理员回滚历史修订需要当前版本，错误版本返回 409', async () => {
    const editorToken = await loginAsEditor(
      'question-rollback-editor-e2e@example.test',
    );
    const created = await request(app.getHttpServer())
      .post('/questions')
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ title: '__e2e_rollback_before__', category: 'E2E测试' })
      .expect(201);
    const updated = await request(app.getHttpServer())
      .patch(`/questions/${created.body.data.id}`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({
        title: '__e2e_rollback_after__',
        category: 'E2E测试',
        version: 1,
      })
      .expect(200);
    const admin = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'question-rollback-admin-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    await app.get(PrismaService).user.update({
      where: { id: admin.body.data.id },
      data: { role: 'ADMIN' },
    });
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'question-rollback-admin-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    const revisions = await request(app.getHttpServer())
      .get(`/questions/${created.body.data.id}/revisions`)
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .expect(200);
    const originalRevision = revisions.body.data.find(
      (revision: { afterJson: string }) =>
        JSON.parse(revision.afterJson).title === '__e2e_rollback_after__',
    );
    await request(app.getHttpServer())
      .post(
        `/questions/${created.body.data.id}/rollback/${originalRevision.id}`,
      )
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .send({ version: 999 })
      .expect(409);
    const rolledBack = await request(app.getHttpServer())
      .post(
        `/questions/${created.body.data.id}/rollback/${originalRevision.id}`,
      )
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .send({ version: updated.body.data.version })
      .expect(201);
    expect(rolledBack.body.data.title).toBe('__e2e_rollback_after__');
    expect(rolledBack.body.data.version).toBe(3);
  });

  it('只有管理员可以修改用户角色，并写入角色变更审计', async () => {
    const adminEmail = 'role-admin-e2e@example.test';
    const targetEmail = 'role-target-e2e@example.test';
    const editorToken = await loginAsEditor('role-editor-e2e@example.test');
    const target = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: targetEmail, password: 'correct-password-123' })
      .expect(201);
    const admin = await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email: adminEmail, password: 'correct-password-123' })
      .expect(201);
    await app.get(PrismaService).user.update({
      where: { id: admin.body.data.id },
      data: { role: 'ADMIN' },
    });
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: adminEmail, password: 'correct-password-123' })
      .expect(201);
    const targetId = target.body.data.id as number;

    await request(app.getHttpServer())
      .patch(`/users/${targetId}/role`)
      .set('Authorization', `Bearer ${editorToken}`)
      .send({ role: 'EDITOR' })
      .expect(403);
    await request(app.getHttpServer())
      .patch(`/users/${targetId}/role`)
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .send({ role: 'OWNER' })
      .expect(400);

    const changed = await request(app.getHttpServer())
      .patch(`/users/${targetId}/role`)
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .send({ role: 'EDITOR' })
      .expect(200);
    expect(changed.body.data.role).toBe('EDITOR');

    const audit = await request(app.getHttpServer())
      .get('/audit-logs?limit=10')
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .expect(200);
    const roleAudit = audit.body.data.find(
      (entry: { action: string; entityId: string }) =>
        entry.action === 'USER_ROLE_CHANGED' &&
        entry.entityId === String(targetId),
    );
    expect(roleAudit).toBeDefined();
    expect(JSON.parse(roleAudit.metadata).toRole).toBe('EDITOR');
  });

  it('拒绝非法 schemaVersion', async () => {
    const accessToken = await loginAsEditor('invalid-schema-e2e@example.test');
    const response = await request(app.getHttpServer())
      .post('/questions/import')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        schemaVersion: 2,
        questions: [
          {
            title: '__e2e_invalid_schema__',
            category: 'E2E测试',
          },
        ],
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('拒绝超长标题', async () => {
    const accessToken = await loginAsEditor('long-title-e2e@example.test');
    const response = await request(app.getHttpServer())
      .post('/questions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: 'a'.repeat(201),
        category: 'E2E测试',
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('拒绝错误 tags 类型', async () => {
    const accessToken = await loginAsEditor('invalid-tags-e2e@example.test');
    const response = await request(app.getHttpServer())
      .post('/questions')
      .set('Authorization', `Bearer ${accessToken}`)
      .send({
        title: '__e2e_invalid_tags__',
        category: 'E2E测试',
        tags: 'not-an-array',
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });
  it('注册用户默认是 LEARNER 且不返回密码', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'register-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);

    expect(response.body.data).toMatchObject({
      email: 'register-e2e@example.test',
      role: 'LEARNER',
    });

    expect(response.body.data.password).toBeUndefined();
    expect(response.body.data.passwordHash).toBeUndefined();

    const saved = await app.get(PrismaService).user.findUnique({
      where: { email: 'register-e2e@example.test' },
    });

    expect(saved?.passwordHash).toMatch(/^\$2[aby]\$/);
    expect(
      await bcrypt.compare('correct-password-123', saved!.passwordHash),
    ).toBe(true);
  });

  it('重复邮箱注册返回 409', async () => {
    const payload = {
      email: 'duplicate-e2e@example.test',
      password: 'correct-password-123',
    };

    await request(app.getHttpServer())
      .post('/auth/register')
      .send(payload)
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        ...payload,
        email: 'DUPLICATE-e2e@example.test',
      })
      .expect(409);

    expect(response.body.error.code).toBe('CONFLICT');
  });

  it('拒绝过短密码', async () => {
    const response = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'short-password@example.test',
        password: '1234567',
      })
      .expect(400);

    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('登录签发短期 Access Token 并创建 RefreshSession', async () => {
    await request(app.getHttpServer()).post('/auth/register').send({
      email: 'login-e2e@example.test',
      password: 'correct-password-123',
    });

    const previousNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    const response = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'LOGIN-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    process.env.NODE_ENV = previousNodeEnv;

    expect(response.body.data.user).toMatchObject({
      email: 'login-e2e@example.test',
      role: 'LEARNER',
    });
    expect(response.body.data.refreshToken).toBeUndefined();
    const loginCookie = response.headers['set-cookie'][0];
    expect(loginCookie).toMatch(/^refresh_token=/i);
    expect(loginCookie).toMatch(/HttpOnly/i);
    expect(loginCookie).toMatch(/Secure/i);
    expect(loginCookie).toMatch(/Path=\/auth/i);
    expect(loginCookie).toMatch(/SameSite=Lax/i);
    const payload = jwt.verify(
      response.body.data.accessToken,
      process.env.ACCESS_TOKEN_SECRET!,
      { issuer: 'question-bank-api', audience: 'question-bank-client' },
    ) as jwt.JwtPayload;
    expect(payload.sub).toEqual(expect.any(Number));
    expect(payload.exp! - payload.iat!).toBe(15 * 60);
    expect(await app.get(PrismaService).refreshSession.count()).toBe(1);
  });

  it('Refresh Token 轮换会撤销旧 Session，退出后不能再次刷新', async () => {
    await request(app.getHttpServer()).post('/auth/register').send({
      email: 'rotation-e2e@example.test',
      password: 'correct-password-123',
    });
    const browser = request.agent(app.getHttpServer());
    const login = await browser
      .post('/auth/login')
      .send({
        email: 'rotation-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    const oldCookie = login.headers['set-cookie'][0].split(';')[0];

    const refreshed = await browser.post('/auth/refresh').expect(201);
    expect(refreshed.body.data.refreshToken).toBeUndefined();
    expect(refreshed.headers['set-cookie'][0]).toMatch(/refresh_token=/i);
    expect(
      await app.get(PrismaService).refreshSession.count({
        where: { revokedAt: { not: null } },
      }),
    ).toBe(1);

    await request(app.getHttpServer())
      .post('/auth/refresh')
      .set('Cookie', oldCookie)
      .expect(401);

    await browser.post('/auth/logout').expect(201);
    await browser.post('/auth/refresh').expect(401);
  });

  it('错误密码和不存在账号都返回 401', async () => {
    await request(app.getHttpServer()).post('/auth/register').send({
      email: 'invalid-login-e2e@example.test',
      password: 'correct-password-123',
    });

    const wrongPassword = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'invalid-login-e2e@example.test',
        password: 'wrong-password-123',
      })
      .expect(401);
    expect(wrongPassword.body.error.message).toBe('Invalid email or password');

    const missingAccount = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'missing-login-e2e@example.test',
        password: 'wrong-password-123',
      })
      .expect(401);
    expect(missingAccount.body.error.message).toBe(
      wrongPassword.body.error.message,
    );
  });

  it('主动退出所有设备会撤销同一用户的全部 Session', async () => {
    await request(app.getHttpServer()).post('/auth/register').send({
      email: 'logout-all-e2e@example.test',
      password: 'correct-password-123',
    });

    const deviceA = request.agent(app.getHttpServer());
    const deviceB = request.agent(app.getHttpServer());
    await deviceA
      .post('/auth/login')
      .send({
        email: 'logout-all-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    await deviceB
      .post('/auth/login')
      .send({
        email: 'logout-all-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);

    expect(
      await app.get(PrismaService).refreshSession.count({
        where: { revokedAt: null },
      }),
    ).toBe(2);

    await deviceA.post('/auth/logout-all').expect(201);

    await deviceA.post('/auth/refresh').expect(401);
    await deviceB.post('/auth/refresh').expect(401);
    expect(
      await app.get(PrismaService).refreshSession.count({
        where: { revokedAt: { not: null } },
      }),
    ).toBe(2);
  });

  it('已撤销的 Refresh Token 不能再触发退出所有设备', async () => {
    await request(app.getHttpServer()).post('/auth/register').send({
      email: 'revoked-logout-all-e2e@example.test',
      password: 'correct-password-123',
    });
    const deviceA = request.agent(app.getHttpServer());
    const deviceB = request.agent(app.getHttpServer());
    const loginA = await deviceA
      .post('/auth/login')
      .send({
        email: 'revoked-logout-all-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    await deviceB
      .post('/auth/login')
      .send({
        email: 'revoked-logout-all-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    const revokedCookie = loginA.headers['set-cookie'][0].split(';')[0];

    await deviceA.post('/auth/logout').expect(201);
    await request(app.getHttpServer())
      .post('/auth/logout-all')
      .set('Cookie', revokedCookie)
      .expect(401);
    await deviceB.post('/auth/refresh').expect(201);
  });

  it('PracticeRecord 的 userId 必须指向真实用户', async () => {
    const prisma = app.get(PrismaService);
    const question = await prisma.question.create({
      data: {
        title: '__e2e_practice_user_foreign_key__',
        normalizedTitle: '__e2e_practice_user_foreign_key__',
        category: 'E2E测试',
      },
    });

    // -1 不可能是正常注册用户，数据库外键必须拒绝这条记录。
    await expect(
      prisma.practiceRecord.create({
        data: {
          userId: -1,
          clientRequestId: 'foreign-key-invalid-user',
          questionId: question.id,
          result: 'correct',
        },
      }),
    ).rejects.toMatchObject({ code: 'P2003' });
  });

  it('同一用户同一 clientRequestId 只能保存一条练习记录', async () => {
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'request-id-unique-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    const prisma = app.get(PrismaService);
    const question = await prisma.question.create({
      data: {
        title: '__e2e_client_request_id_unique__',
        normalizedTitle: '__e2e_client_request_id_unique__',
        category: 'E2E测试',
      },
    });
    const data = {
      userId: registered.body.data.id,
      clientRequestId: 'client-request-duplicate-1',
      questionId: question.id,
      result: 'correct',
    };

    await prisma.practiceRecord.create({ data });
    await expect(prisma.practiceRecord.create({ data })).rejects.toMatchObject({
      code: 'P2002',
    });
    expect(
      await prisma.practiceRecord.count({
        where: {
          userId: data.userId,
          clientRequestId: data.clientRequestId,
        },
      }),
    ).toBe(1);
  });

  it('同一个练习请求并发重放 10 次只新增一条记录', async () => {
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'practice-retry-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: 'practice-retry-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    const prisma = app.get(PrismaService);
    const question = await prisma.question.create({
      data: {
        title: '__e2e_practice_retry__',
        normalizedTitle: '__e2e_practice_retry__',
        category: 'E2E测试',
      },
    });
    const payload = {
      questionId: question.id,
      clientRequestId: '11111111-1111-4111-8111-111111111111',
      userAnswer: '同一次作答',
      result: 'correct',
      mode: 'write',
    };

    const responses = await Promise.all(
      Array.from({ length: 10 }, () =>
        request(app.getHttpServer())
          .post('/practice-records')
          .set('Authorization', `Bearer ${login.body.data.accessToken}`)
          .send(payload)
          .expect(201),
      ),
    );

    // 十次响应必须指向第一次成功写入的同一条记录。
    expect(
      new Set(responses.map((response) => response.body.data.id)).size,
    ).toBe(1);
    expect(
      await prisma.practiceRecord.count({
        where: {
          userId: registered.body.data.id,
          clientRequestId: payload.clientRequestId,
        },
      }),
    ).toBe(1);
  });

  it('登录迁移预览只统计当前用户且迁移不会覆盖云端旧记录', async () => {
    async function registerAndLogin(email: string) {
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'correct-password-123' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'correct-password-123' })
        .expect(201);
      return {
        userId: registered.body.data.id as number,
        accessToken: login.body.data.accessToken as string,
      };
    }

    const userA = await registerAndLogin('migration-a-e2e@example.test');
    const userB = await registerAndLogin('migration-b-e2e@example.test');
    const question = await app.get(PrismaService).question.create({
      data: {
        title: '__e2e_login_migration__',
        normalizedTitle: '__e2e_login_migration__',
        category: 'E2E测试',
      },
    });

    const firstRecord = await request(app.getHttpServer())
      .post('/practice-records')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({
        questionId: question.id,
        clientRequestId: '22222222-2222-4222-8222-222222222222',
        result: 'wrong',
        practicedAt: '2026-08-20T08:00:00.000Z',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/practice-records')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({
        questionId: question.id,
        clientRequestId: '33333333-3333-4333-8333-333333333333',
        result: 'correct',
        practicedAt: '2026-08-21T08:00:00.000Z',
      })
      .expect(201);

    expect(firstRecord.body.data.practicedAt).toBe('2026-08-20T08:00:00.000Z');
    const summaryA = await request(app.getHttpServer())
      .get('/practice-records/summary')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);
    const summaryB = await request(app.getHttpServer())
      .get('/practice-records/summary')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(200);

    expect(summaryA.body.data).toEqual({
      practiceRecordCount: 2,
      latestPracticedAt: '2026-08-21T08:00:00.000Z',
    });
    expect(summaryB.body.data).toEqual({
      practiceRecordCount: 0,
      latestPracticedAt: null,
    });
    expect(
      await app.get(PrismaService).practiceRecord.count({
        where: { userId: userA.userId },
      }),
    ).toBe(2);
  });

  it('GET/practice-records 只返回当前登录用户的全部记录', async () => {
    async function registerAndLogin(email: string) {
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'correct-password-123' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'correct-password-123' })
        .expect(201);
      return {
        userId: registered.body.data.id as number,
        accessToken: login.body.data.accessToken as string,
      };
    }

    const userA = await registerAndLogin('practice-list-a-e2e@example.test');
    const userB = await registerAndLogin('practice-list-b-e2e@example.test');
    const question = await app.get(PrismaService).question.create({
      data: {
        title: '__e2e_practice_list_question__',
        normalizedTitle: '__e2e_practice_list_question__',
        category: 'E2E测试',
      },
    });

    await request(app.getHttpServer())
      .post('/practice-records')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({
        questionId: question.id,
        clientRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
        result: 'correct',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/practice-records')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .send({
        questionId: question.id,
        clientRequestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
        result: 'wrong',
      })
      .expect(201);

    const recordsA = await request(app.getHttpServer())
      .get('/practice-records')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);
    const recordsB = await request(app.getHttpServer())
      .get('/practice-records')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(200);

    expect(recordsA.body.data).toHaveLength(1);
    expect(recordsA.body.data[0]).toMatchObject({
      userId: userA.userId,
      clientRequestId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
      result: 'correct',
    });
    expect(recordsB.body.data).toHaveLength(1);
    expect(recordsB.body.data[0]).toMatchObject({
      userId: userB.userId,
      clientRequestId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      result: 'wrong',
    });
  });

  it('Favorite 按用户和题目唯一，且不同用户互相隔离', async () => {
    async function registerAndLogin(email: string) {
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'correct-password-123' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'correct-password-123' })
        .expect(201);
      return {
        user: registered.body.data,
        accessToken: login.body.data.accessToken,
      };
    }

    const userA = await registerAndLogin('favorite-a-e2e@example.test');
    const userB = await registerAndLogin('favorite-b-e2e@example.test');
    const question = await app.get(PrismaService).question.create({
      data: {
        title: '__e2e_favorite_question__',
        normalizedTitle: '__e2e_favorite_question__',
        category: 'E2E测试',
      },
    });

    await request(app.getHttpServer())
      .post(`/favorites/${question.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(201);
    await request(app.getHttpServer())
      .post(`/favorites/${question.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(201);

    const prisma = app.get(PrismaService);
    expect(
      await prisma.favorite.count({
        where: { userId: userA.user.id, questionId: question.id },
      }),
    ).toBe(1);

    const userAFavorites = await request(app.getHttpServer())
      .get('/favorites')
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);
    expect(userAFavorites.body.data).toHaveLength(1);

    const userBFavorites = await request(app.getHttpServer())
      .get('/favorites')
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(200);
    expect(userBFavorites.body.data).toHaveLength(0);
  });

  it('Note 按用户和题目保存个人备注，更新不会新增重复记录', async () => {
    async function registerAndLogin(email: string) {
      const registered = await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'correct-password-123' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'correct-password-123' })
        .expect(201);
      return {
        user: registered.body.data,
        accessToken: login.body.data.accessToken,
      };
    }

    const userA = await registerAndLogin('note-a-e2e@example.test');
    const userB = await registerAndLogin('note-b-e2e@example.test');
    const question = await app.get(PrismaService).question.create({
      data: {
        title: '__e2e_note_question__',
        normalizedTitle: '__e2e_note_question__',
        category: 'E2E测试',
      },
    });

    await request(app.getHttpServer())
      .put(`/notes/${question.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ content: '第一次备注' })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/notes/${question.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ content: '更新后的备注' })
      .expect(200);

    const prisma = app.get(PrismaService);
    expect(
      await prisma.note.count({
        where: { userId: userA.user.id, questionId: question.id },
      }),
    ).toBe(1);

    const userANote = await request(app.getHttpServer())
      .get(`/notes/${question.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);
    expect(userANote.body.data.content).toBe('更新后的备注');

    await request(app.getHttpServer())
      .get(`/notes/${question.id}`)
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .put(`/notes/${question.id}`)
      .set('Authorization', `Bearer ${userB.accessToken}`)
      .send({ content: 'B 的个人备注' })
      .expect(200);

    expect(
      await prisma.note.count({ where: { questionId: question.id } }),
    ).toBe(2);
  });

  it('A 用户不能读取、修改或删除 B 用户的练习记录', async () => {
    async function registerAndLogin(email: string) {
      await request(app.getHttpServer())
        .post('/auth/register')
        .send({ email, password: 'correct-password-123' })
        .expect(201);
      const login = await request(app.getHttpServer())
        .post('/auth/login')
        .send({ email, password: 'correct-password-123' })
        .expect(201);
      return login.body.data;
    }

    const userA = await registerAndLogin('ownership-a-e2e@example.test');
    const userB = await registerAndLogin('ownership-b-e2e@example.test');
    const prisma = app.get(PrismaService);
    const question = await prisma.question.create({
      data: {
        title: '__e2e_ownership_question__',
        normalizedTitle: '__e2e_ownership_question__',
        category: 'E2E测试',
      },
    });
    const recordA = await prisma.practiceRecord.create({
      data: {
        userId: userA.user.id,
        clientRequestId: 'ownership-record-a',
        questionId: question.id,
        result: 'correct',
      },
    });
    const recordB = await prisma.practiceRecord.create({
      data: {
        userId: userB.user.id,
        clientRequestId: 'ownership-record-b',
        questionId: question.id,
        result: 'wrong',
      },
    });

    await request(app.getHttpServer())
      .get(`/practice-records/${recordA.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(200);

    await request(app.getHttpServer())
      .get(`/practice-records/${recordB.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(404);

    await request(app.getHttpServer())
      .get(`/practice-records/${recordA.id}`)
      .expect(401);

    await request(app.getHttpServer())
      .patch(`/practice-records/${recordB.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .send({ userId: userB.user.id, result: 'correct' })
      .expect(400)
      .expect((response) => {
        expect(response.body.error.code).toBe('VALIDATION_ERROR');
      });

    const unchangedRecordB = await prisma.practiceRecord.findUnique({
      where: { id: recordB.id },
    });
    expect(unchangedRecordB?.result).toBe('wrong');
    // A 即使知道 B 的记录 ID，也不能删除不属于自己的记录。
    await request(app.getHttpServer())
      .delete(`/practice-records/${recordB.id}`)
      .set('Authorization', `Bearer ${userA.accessToken}`)
      .expect(404);

    const recordBAfterDeleteAttempt = await prisma.practiceRecord.findUnique({
      where: { id: recordB.id },
    });
    expect(recordBAfterDeleteAttempt).not.toBeNull();
  });

  it('审核导入任务只能由 ADMIN 发布，并把草稿题目和审计记录推进到已发布', async () => {
    const editorToken = await loginAsEditor(
      'review-import-editor-e2e@example.test',
    );
    const admin = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'review-import-admin-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    await app.get(PrismaService).user.update({
      where: { id: admin.body.data.id },
      data: { role: 'ADMIN' },
    });
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: admin.body.data.email, password: 'correct-password-123' })
      .expect(201);
    const prisma = app.get(PrismaService);
    const file = await prisma.fileObject.create({
      data: {
        objectKey: 'review-import.json',
        ownerId: admin.body.data.id,
        sha256: 'review-import-sha',
        size: 1,
        mime: 'application/json',
      },
    });
    const job = await prisma.importJob.create({
      data: {
        userId: admin.body.data.id,
        fileObjectId: file.id,
        idempotencyKey: 'review-import-key',
        pipelineVersion: 'review-v1',
        reviewRequired: true,
        status: 'WAITING_REVIEW',
      },
    });
    const question = await prisma.question.create({
      data: {
        title: '__e2e_review_draft__',
        normalizedTitle: '__e2e_review_draft__',
        category: 'E2E',
        importJobId: job.id,
      },
    });
    await request(app.getHttpServer())
      .post(`/import-jobs/${job.id}/publish`)
      .set('Authorization', `Bearer ${editorToken}`)
      .expect(403);
    const published = await request(app.getHttpServer())
      .post(`/import-jobs/${job.id}/publish`)
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .expect(201);
    expect(published.body.data.status).toBe('SUCCEEDED');
    expect(
      (await prisma.question.findUnique({ where: { id: question.id } }))
        ?.status,
    ).toBe('PUBLISHED');
    expect(
      await prisma.auditLog.count({
        where: { action: 'IMPORT_PUBLISHED', entityId: job.id },
      }),
    ).toBe(1);
  });

  it('管理员可预览、逐项修正并整批回滚待审核导入', async () => {
    const registered = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'review-rollback-admin@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    const prisma = app.get(PrismaService);
    await prisma.user.update({
      where: { id: registered.body.data.id },
      data: { role: 'ADMIN' },
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: registered.body.data.email,
        password: 'correct-password-123',
      })
      .expect(201);
    const token = login.body.data.accessToken as string;
    const file = await prisma.fileObject.create({
      data: {
        objectKey: 'review-rollback.json',
        ownerId: registered.body.data.id,
        sha256: 'review-rollback-sha',
        size: 1,
        mime: 'application/json',
      },
    });
    const job = await prisma.importJob.create({
      data: {
        userId: registered.body.data.id,
        fileObjectId: file.id,
        idempotencyKey: 'review-rollback',
        reviewRequired: true,
        status: 'WAITING_REVIEW',
      },
    });
    const question = await prisma.question.create({
      data: {
        title: '__review_rollback__',
        normalizedTitle: '__review_rollback__',
        category: '待修正',
        difficulty: '基础',
        answer: '原始答案',
        reviewSuggestions: JSON.stringify({
          category: '数据库',
          difficulty: '进阶',
          answer: '建议答案',
          reasons: ['题干关键词匹配到数据库'],
        }),
        importJobId: job.id,
      },
    });
    const preview = await request(app.getHttpServer())
      .get(`/import-jobs/${job.id}/review`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(preview.body.data.questions).toHaveLength(1);
    expect(preview.body.data.questions[0].reviewSuggestions).toMatchObject({
      category: '数据库',
      difficulty: '进阶',
      answer: '建议答案',
    });
    await request(app.getHttpServer())
      .patch(`/questions/${question.id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: question.title,
        category: '数据库',
        difficulty: '进阶',
        answer: '建议答案',
        version: 1,
        reason: 'REVIEW_SUGGESTION_ACCEPTED',
      })
      .expect(200);
    expect(
      (
        await prisma.questionRevision.findFirst({
          where: {
            questionId: question.id,
            reason: 'REVIEW_SUGGESTION_ACCEPTED',
          },
        })
      )?.reason,
    ).toBe('REVIEW_SUGGESTION_ACCEPTED');
    await request(app.getHttpServer())
      .post(`/import-jobs/${job.id}/rollback`)
      .set('Authorization', `Bearer ${token}`)
      .expect(201)
      .expect((response) =>
        expect(response.body.data.status).toBe('CANCELLED'),
      );
    expect(
      await prisma.question.count({ where: { importJobId: job.id } }),
    ).toBe(0);
    expect(
      await prisma.auditLog.count({
        where: { action: 'IMPORT_ROLLED_BACK', entityId: job.id },
      }),
    ).toBe(1);
  });

  it('清空题库要求 ADMIN，且前端之外后端也会阻止危险操作', async () => {
    const learner = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'learner-clear-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    const learnerLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: learner.body.data.email,
        password: 'correct-password-123',
      })
      .expect(201);

    await request(app.getHttpServer()).delete('/questions').expect(401);
    await request(app.getHttpServer())
      .delete('/questions')
      .set('Authorization', `Bearer ${learnerLogin.body.data.accessToken}`)
      .expect(403);

    const admin = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: 'admin-clear-e2e@example.test',
        password: 'correct-password-123',
      })
      .expect(201);
    await app.get(PrismaService).user.update({
      where: { id: admin.body.data.id },
      data: { role: 'ADMIN' },
    });
    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({
        email: admin.body.data.email,
        password: 'correct-password-123',
      })
      .expect(201);
    await request(app.getHttpServer())
      .post('/questions')
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .send({
        title: '__e2e_admin_clear__',
        category: 'E2E测试',
      });

    const cleared = await request(app.getHttpServer())
      .delete('/questions')
      .set('Authorization', `Bearer ${adminLogin.body.data.accessToken}`)
      .expect(200);
    expect(cleared.body.data.deletedCount).toBe(1);
  });
});
