import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { Queue, QueueEvents } from 'bullmq';
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import { promises as fs } from 'node:fs';
import { join, resolve } from 'node:path';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { configureApp } from '../src/configure-app';
import {
  getRedisConnection,
  type ImportQueuePayload,
} from '../src/import-jobs/import-queue.service';
import { PrismaService } from '../src/prisma/prisma.service';

describe('BullMQ independent import worker (integration)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let userId: number;
  let worker: ChildProcessWithoutNullStreams | undefined;
  let workerOutput = '';
  let queue: Queue<ImportQueuePayload>;
  const uploadRoot = resolve(process.env.UPLOAD_DIR!);

  beforeAll(async () => {
    await fs.mkdir(uploadRoot, { recursive: true });
    queue = new Queue(process.env.IMPORT_QUEUE_NAME!, {
      connection: getRedisConnection()!,
    });
    await queue.obliterate({ force: true });

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
    prisma = app.get(PrismaService);

    const email = `worker-integration-${process.pid}@example.test`;
    await request(app.getHttpServer())
      .post('/auth/register')
      .send({ email, password: 'correct-password-123' })
      .expect(201);
    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    userId = user.id;
    await prisma.user.update({
      where: { id: user.id },
      data: { role: 'EDITOR' },
    });
    const login = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email, password: 'correct-password-123' })
      .expect(201);
    token = login.body.data.accessToken as string;
    worker = await startWorker();
  }, 30_000);

  afterAll(async () => {
    await stopWorker(worker, false);
    await prisma.importJob
      .deleteMany({ where: { userId } })
      .catch(() => undefined);
    await prisma.fileObject
      .deleteMany({ where: { ownerId: userId } })
      .catch(() => undefined);
    await prisma.uploadPart
      .deleteMany({ where: { session: { userId } } })
      .catch(() => undefined);
    await prisma.uploadSession
      .deleteMany({ where: { userId } })
      .catch(() => undefined);
    await prisma.refreshSession
      .deleteMany({ where: { userId } })
      .catch(() => undefined);
    await prisma.user.deleteMany({
      where: { email: { startsWith: 'worker-integration-' } },
    });
    await prisma.question.deleteMany({
      where: { title: { startsWith: '__worker_' } },
    });
    await queue.obliterate({ force: true }).catch(() => undefined);
    await queue.close();
    await app.close();
    if (uploadRoot.startsWith(resolve(process.cwd(), '.data'))) {
      await fs.rm(uploadRoot, { recursive: true, force: true });
    }
  }, 30_000);

  it('API 入队后由独立 Worker 导入，并贯穿 requestId 和真实队列深度', async () => {
    const uploaded = await uploadJson(
      '__worker_success__.json',
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          questions: [{ title: '__worker_success__', category: 'Worker' }],
        }),
      ),
    );
    const created = await createJob(uploaded.fileObjectId, 'worker-success');
    const completed = await waitForJob(created.id, ['SUCCEEDED']);
    expect(completed).toMatchObject({
      totalItems: 1,
      importedItems: 1,
      skippedItems: 0,
      failedItems: 0,
    });
    expect(created.requestId).toEqual(expect.any(String));
    expect(workerOutput).toContain(created.id);
    expect(workerOutput).toContain(created.requestId);

    const bullJob = await queue.getJob(created.id);
    expect(await bullJob?.getState()).toBe('completed');
    const ready = await request(app.getHttpServer())
      .get('/health/ready')
      .expect(200);
    expect(ready.body.data.dependencies.redis).toBe('ok');
    expect(ready.body.data.queueDepth).toEqual(expect.any(Number));

    const duplicate = await createJob(uploaded.fileObjectId, 'worker-success');
    expect(duplicate.id).toBe(created.id);
  });

  it('永久格式错误只执行一次并生成可下载的失败原因', async () => {
    const uploaded = await uploadJson(
      '__worker_permanent__.json',
      Buffer.from(JSON.stringify({ schemaVersion: 2, questions: [] })),
    );
    const created = await createJob(uploaded.fileObjectId, 'worker-permanent');
    const failed = await waitForJob(created.id, ['FAILED']);
    expect(failed.errorMessage).toContain('Invalid question bank schema');
    expect(JSON.parse(failed.failureReport)).toEqual([
      expect.objectContaining({
        index: 0,
        reason: expect.stringContaining('Invalid question bank schema'),
      }),
    ]);
    const bullJob = await queue.getJob(created.id);
    expect(await bullJob?.getState()).toBe('failed');
    expect(bullJob?.attemptsMade).toBe(1);
  });

  it('瞬时文件故障按有限次数退避重试，恢复后成功', async () => {
    const uploaded = await uploadJson(
      '__worker_retry__.json',
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          questions: [{ title: '__worker_retry__', category: 'Worker' }],
        }),
      ),
    );
    const completePath = join(uploadRoot, `${uploaded.sessionId}.complete`);
    const heldPath = `${completePath}.held`;
    await fs.rename(completePath, heldPath);
    const created = await createJob(uploaded.fileObjectId, 'worker-retry');
    await waitFor(async () => {
      const current = await prisma.importJob.findUniqueOrThrow({
        where: { id: created.id },
      });
      return current.errorMessage?.startsWith('Attempt 1/3 failed')
        ? current
        : undefined;
    }, 10_000);
    await fs.rename(heldPath, completePath);
    await waitForJob(created.id, ['SUCCEEDED'], 15_000);
    const bullJob = await queue.getJob(created.id);
    // BullMQ 的 attemptsMade 表示已结束的失败尝试；第一次缺文件失败后恢复成功即为 1。
    expect(bullJob?.attemptsMade).toBeGreaterThanOrEqual(1);
    expect(bullJob?.attemptsMade).toBeLessThanOrEqual(3);
  });

  it('Worker 被强制终止后，BullMQ stalled 检测由新进程恢复任务', async () => {
    await stopWorker(worker, false);
    worker = undefined;
    const largeAnswer = 'x'.repeat(20 * 1024 * 1024);
    const uploaded = await uploadJson(
      '__worker_stalled__.json',
      Buffer.from(
        JSON.stringify({
          schemaVersion: 1,
          questions: [
            {
              title: '__worker_stalled__',
              category: 'Worker',
              answer: largeAnswer,
            },
          ],
        }),
      ),
    );
    const events = new QueueEvents(process.env.IMPORT_QUEUE_NAME!, {
      connection: getRedisConnection(true)!,
    });
    await events.waitUntilReady();
    const created = await createJob(uploaded.fileObjectId, 'worker-stalled');
    const active = new Promise<void>((resolveActive, rejectActive) => {
      const timeout = setTimeout(
        () => rejectActive(new Error('Job did not become active')),
        10_000,
      );
      events.on('active', ({ jobId }) => {
        if (jobId === created.id) {
          clearTimeout(timeout);
          resolveActive();
        }
      });
    });
    const victim = await startWorker();
    await active;
    await stopWorker(victim, true);
    worker = await startWorker();
    const recovered = await waitForJob(created.id, ['SUCCEEDED'], 20_000);
    expect(recovered.importedItems).toBe(1);
    const completedState = await waitFor(async () => {
      const state = await (await queue.getJob(created.id))?.getState();
      return state === 'completed' ? state : undefined;
    }, 5_000);
    expect(completedState).toBe('completed');
    await events.close();
  }, 40_000);

  it('Redis 故障时 readiness 和导入明确失败，普通题库读取仍可用', async () => {
    const originalRedisUrl = process.env.REDIS_URL;
    process.env.REDIS_URL = 'redis://127.0.0.1:6399/0';
    const unavailableModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    const unavailableApp = unavailableModule.createNestApplication();
    configureApp(unavailableApp);
    await unavailableApp.init();
    try {
      await request(unavailableApp.getHttpServer())
        .get('/questions')
        .expect(200);
      await request(unavailableApp.getHttpServer())
        .get('/health/ready')
        .expect(503)
        .expect((response) => {
          expect(response.body.error.code).toBe('REDIS_NOT_READY');
        });
      const uploaded = await uploadJson(
        '__worker_redis_down__.json',
        Buffer.from(JSON.stringify({ schemaVersion: 1, questions: [] })),
      );
      await request(unavailableApp.getHttpServer())
        .post('/import-jobs')
        .set('Authorization', `Bearer ${token}`)
        .send({
          fileObjectId: uploaded.fileObjectId,
          idempotencyKey: 'worker-redis-down',
        })
        .expect(503)
        .expect((response) => {
          expect(response.body.error.code).toBe('IMPORT_QUEUE_UNAVAILABLE');
        });
    } finally {
      await unavailableApp.close();
      process.env.REDIS_URL = originalRedisUrl;
    }
  }, 15_000);

  async function uploadJson(fileName: string, content: Buffer) {
    const initiated = await request(app.getHttpServer())
      .post('/uploads/initiate')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileName, size: content.length, mime: 'application/json' })
      .expect(201);
    const sessionId = initiated.body.data.sessionId as string;
    const partSize = initiated.body.data.partSize as number;
    const partCount = Math.ceil(content.length / partSize);
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
    return { sessionId, fileObjectId: completed.body.data.id as number };
  }

  async function createJob(fileObjectId: number, idempotencyKey: string) {
    const response = await request(app.getHttpServer())
      .post('/import-jobs')
      .set('Authorization', `Bearer ${token}`)
      .send({ fileObjectId, idempotencyKey })
      .expect(201);
    return response.body.data as {
      id: string;
      requestId: string;
      status: string;
    };
  }

  async function waitForJob(
    jobId: string,
    statuses: string[],
    timeoutMs = 10_000,
  ) {
    try {
      return await waitFor(async () => {
        const job = await prisma.importJob.findUniqueOrThrow({
          where: { id: jobId },
        });
        return statuses.includes(job.status) ? job : undefined;
      }, timeoutMs);
    } catch {
      const databaseJob = await prisma.importJob.findUnique({
        where: { id: jobId },
      });
      const bullJob = await queue.getJob(jobId);
      const queueState = bullJob ? await bullJob.getState() : 'missing';
      throw new Error(
        `Job ${jobId} did not reach ${statuses.join(',')}; database=${databaseJob?.status}, queue=${queueState}, attempts=${bullJob?.attemptsMade}; worker=${workerOutput.slice(-2000)}`,
      );
    }
  }

  async function waitFor<T>(
    check: () => Promise<T | undefined>,
    timeoutMs: number,
  ): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const value = await check();
      if (value !== undefined) return value;
      await new Promise((resolveWait) => setTimeout(resolveWait, 50));
    }
    throw new Error(`Condition not met within ${timeoutMs}ms`);
  }

  async function startWorker() {
    const outputStart = workerOutput.length;
    const child = spawn(process.execPath, ['dist/src/worker.js'], {
      cwd: process.cwd(),
      env: { ...process.env, IMPORT_WORKER: 'true' },
      stdio: ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
    });
    child.stdout.on('data', (chunk) => {
      workerOutput += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      workerOutput += chunk.toString();
    });
    await waitFor(
      async () =>
        workerOutput
          .slice(outputStart)
          .includes('independent import worker started')
          ? true
          : undefined,
      10_000,
    );
    return child;
  }

  async function stopWorker(
    child: ChildProcessWithoutNullStreams | undefined,
    force: boolean,
  ) {
    if (!child || child.exitCode !== null) return;
    child.kill(force ? 'SIGKILL' : 'SIGTERM');
    await new Promise<void>((resolveExit, rejectExit) => {
      const timeout = setTimeout(
        () => rejectExit(new Error('Worker process did not exit')),
        5_000,
      );
      child.once('exit', () => {
        clearTimeout(timeout);
        resolveExit();
      });
    });
  }
});
