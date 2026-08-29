import {
  BadRequestException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from '../prisma/prisma.service';
import { QuestionsService } from '../questions/questions.service';
import { MetricsService } from '../observability/metrics.service';
import pino from 'pino';
import { ImportQueueService } from './import-queue.service';
import { ObjectStorageService } from '../uploads/object-storage.service';
import Ajv from 'ajv';
import { questionBankSchema, questionItemSchema } from './question-bank.schema';
import { findSemanticCandidates } from './semantic-candidates';
import {
  createReviewSuggestions,
  parseReviewSuggestions,
} from './review-suggestions';
import { DocumentExtractionService } from './document-extraction.service';

const UPLOAD_ROOT =
  process.env.UPLOAD_DIR || join(process.cwd(), '.data', 'uploads');

export class PermanentImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PermanentImportError';
  }
}

@Injectable()
export class ImportJobsService implements OnModuleInit, OnModuleDestroy {
  private readonly ajv = new Ajv({
    allErrors: true,
    strict: true,
  });
  private readonly validator = this.ajv.compile(questionBankSchema);
  private readonly questionValidator = this.ajv.compile(questionItemSchema);
  private readonly logger = pino({ name: 'question-bank-import-job' });
  private readonly queued = new Set<string>();
  private readonly events = new Map<
    string,
    Array<{ id: number; event: string; data: unknown }>
  >();
  private nextEventId = 1;
  private recoveryTimer?: NodeJS.Timeout;

  constructor(
    private readonly prisma: PrismaService,
    private readonly questionsService: QuestionsService,
    private readonly metrics: MetricsService,
    private readonly importQueue: ImportQueueService,
    private readonly documentExtraction: DocumentExtractionService,
    private readonly objectStorage?: ObjectStorageService,
  ) {}

  async onModuleInit() {
    if (process.env.IMPORT_WORKER === 'true') return;
    // 进程重启后把未完成任务重新放回本地队列；运行过久的阶段标记为失败，避免永久卡死。
    await this.recoverInterruptedJobs().catch((error) =>
      this.logger.warn(
        { error: error instanceof Error ? error.message : String(error) },
        'import queue recovery deferred',
      ),
    );
    this.recoveryTimer = setInterval(
      () =>
        void this.recoverInterruptedJobs().catch((error) =>
          this.logger.warn(
            {
              error: error instanceof Error ? error.message : String(error),
            },
            'import queue recovery deferred',
          ),
        ),
      60_000,
    );
    this.recoveryTimer.unref?.();
  }

  onModuleDestroy() {
    if (this.recoveryTimer) clearInterval(this.recoveryTimer);
  }

  async create(
    userId: number,
    fileObjectId: number,
    idempotencyKey?: string,
    pipelineVersion = 'v1',
    requestId?: string,
  ) {
    const file = await this.prisma.fileObject.findFirst({
      where: { id: fileObjectId, ownerId: userId },
      include: {
        importJobs: {
          where: {
            userId,
            ...(idempotencyKey ? { idempotencyKey } : { pipelineVersion }),
          },
        },
      },
    });
    if (!file) throw new NotFoundException('File object not found');
    if (
      file.mime !== 'application/json' &&
      !pipelineVersion.startsWith('review-')
    ) {
      throw new BadRequestException(
        'PDF and image imports require a review-* pipeline and cannot publish directly',
      );
    }
    const generatedKey = idempotencyKey || `${file.sha256}:${pipelineVersion}`;
    const existing = file.importJobs.find(
      (job) => job.idempotencyKey === generatedKey,
    );
    if (existing) {
      if (existing.status === 'QUEUED') {
        await this.enqueue(existing.id, existing.requestId || requestId);
      }
      return existing;
    }

    let job;
    try {
      job = await this.prisma.importJob.create({
        data: {
          userId,
          fileObjectId,
          requestId,
          idempotencyKey: generatedKey,
          pipelineVersion,
          reviewRequired: pipelineVersion.startsWith('review-'),
          source: file.mime,
        },
      });
    } catch (error) {
      // 并发重复提交由数据库唯一约束仲裁，失败请求读取同一条任务即可安全重试。
      if (
        error &&
        typeof error === 'object' &&
        'code' in error &&
        error.code === 'P2002'
      ) {
        const duplicate = await this.prisma.importJob.findUnique({
          where: {
            userId_idempotencyKey: { userId, idempotencyKey: generatedKey },
          },
        });
        if (duplicate) {
          if (duplicate.status === 'QUEUED') {
            await this.enqueue(duplicate.id, duplicate.requestId || requestId);
          }
          return duplicate;
        }
      }
      throw error;
    }
    this.publish(job.id, 'queued', job);
    this.logger.info(
      { requestId, jobId: job.id, userId, status: job.status },
      'import job queued',
    );
    await this.enqueue(job.id, requestId);
    return job;
  }

  async get(userId: number, id: string) {
    const job = await this.prisma.importJob.findFirst({
      where: { id, userId },
    });
    if (!job) throw new NotFoundException('Import job not found');
    return job;
  }

  async cancel(userId: number, id: string) {
    const job = await this.get(userId, id);
    if (['SUCCEEDED', 'FAILED', 'PARTIAL', 'CANCELLED'].includes(job.status))
      return job;
    const cancelled = await this.prisma.importJob.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        finishedAt: new Date(),
        errorMessage: 'Cancelled by user',
      },
    });
    this.publish(id, 'cancelled', cancelled);
    return cancelled;
  }

  async retry(userId: number, id: string, requestId?: string) {
    const job = await this.get(userId, id);
    if (!['FAILED', 'PARTIAL'].includes(job.status)) return job;
    const queued = await this.prisma.importJob.update({
      where: { id },
      data: {
        ...(requestId ? { requestId } : {}),
        status: 'QUEUED',
        errorMessage: null,
        failureReport: null,
        finishedAt: null,
        startedAt: null,
        totalItems: 0,
        importedItems: 0,
        skippedItems: 0,
        failedItems: 0,
      },
    });
    this.publish(id, 'queued', queued);
    await this.enqueue(id, requestId, true);
    return queued;
  }

  getEvents(userId: number, id: string, lastEventId = 0) {
    const cursor = Number.isFinite(lastEventId) ? lastEventId : 0;
    return this.get(userId, id).then((job) => ({
      job,
      events: (this.events.get(id) || []).filter((event) => event.id > cursor),
    }));
  }

  private async enqueue(
    jobId: string,
    requestId?: string | null,
    replace = false,
  ) {
    if (this.importQueue.isRedisEnabled()) {
      try {
        await this.importQueue.enqueue(
          { jobId, requestId: requestId || undefined },
          replace,
        );
      } catch (error) {
        await this.prisma.importJob
          .update({
            where: { id: jobId },
            data: {
              errorMessage:
                'Import queue unavailable; task remains queued for recovery',
            },
          })
          .catch(() => undefined);
        throw error;
      }
      return;
    }
    if (this.queued.has(jobId)) return;
    this.queued.add(jobId);
    this.metrics.setQueueDepth(this.queued.size);
    // 没有配置 Redis 时保留单进程学习演示，生产部署应启动独立 Worker。
    setImmediate(() => void this.processLocal(jobId));
  }

  async processJob(jobId: string) {
    const processingStartedAt = Date.now();
    try {
      const current = await this.prisma.importJob.findUnique({
        where: { id: jobId },
      });
      if (
        !current ||
        ['SUCCEEDED', 'PARTIAL', 'FAILED', 'CANCELLED'].includes(current.status)
      )
        return;
      const parsingStartedAt = new Date();
      const claimed = await this.prisma.importJob.updateMany({
        where: {
          id: jobId,
          status: { in: ['QUEUED', 'PARSING', 'VALIDATING', 'DEDUPING'] },
        },
        data: {
          status: 'PARSING',
          startedAt: current.startedAt ?? parsingStartedAt,
          parsingStartedAt,
          parsingFinishedAt: null,
          validatingStartedAt: null,
          validatingFinishedAt: null,
          parsingDurationMs: null,
          validatingDurationMs: null,
          failedItems: 0,
        },
      });
      if (claimed.count === 0) return;
      const job = await this.prisma.importJob.findUniqueOrThrow({
        where: { id: jobId },
        include: { fileObject: true },
      });
      this.publish(jobId, 'parsing', job);
      this.logger.info(
        {
          requestId: job.requestId,
          jobId,
          userId: job.userId,
          status: job.status,
        },
        'import job stage',
      );
      if (job.fileObject.mime !== 'application/json' && !job.reviewRequired) {
        throw new PermanentImportError(
          'PDF and image imports require a review-* pipeline and cannot publish directly',
        );
      }

      const content =
        job.fileObject.storageBackend === 's3'
          ? await (async () => {
              if (!this.objectStorage)
                throw new PermanentImportError(
                  'Object storage adapter is unavailable',
                );
              const streamed = await this.objectStorage.readObjectWithSha256(
                job.fileObject.objectKey,
              );
              if (streamed.sha256 !== job.fileObject.sha256) {
                throw new PermanentImportError(
                  'Object storage SHA-256 does not match FileObject metadata',
                );
              }
              return streamed.content;
            })()
          : await (async () => {
              // 跨用户物理去重后，逻辑所有者和最早的本地完成会话可能不同。
              // 这里只在受控服务层按物理 objectKey 找源文件，绝不将其暴露给客户端。
              const sourceSession = await this.prisma.uploadSession.findFirst({
                where: {
                  objectKey: job.fileObject.objectKey,
                  status: 'COMPLETED',
                },
                orderBy: { createdAt: 'asc' },
              });
              if (!sourceSession)
                throw new PermanentImportError(
                  'Upload session source not found',
                );
              return fs.readFile(
                join(UPLOAD_ROOT, `${sourceSession.id}.complete`),
              );
            })();
      let payload: {
        schemaVersion?: number;
        questions?: unknown;
        source?: unknown;
        promptVersion?: unknown;
        confidence?: unknown;
      };
      if (job.fileObject.mime === 'application/json') {
        try {
          payload = JSON.parse(content.toString('utf8')) as typeof payload;
        } catch {
          throw new PermanentImportError('Invalid JSON document');
        }
      } else {
        try {
          const extracted = await this.documentExtraction.extract(
            job.fileObject.mime,
            content,
          );
          payload = {
            schemaVersion: 1,
            source: extracted.provider,
            questions: [
              {
                title: `${extracted.provider === 'pdf-parse' ? 'PDF' : 'OCR'} 提取结果：${job.fileObject.objectKey}`,
                category: '待审核',
                answer: extracted.text,
                difficulty: '基础',
                tags: [
                  extracted.provider === 'pdf-parse'
                    ? 'PDF提取待审核'
                    : 'OCR提取待审核',
                ],
              },
            ],
          };
          await this.prisma.importJob.update({
            where: { id: jobId },
            data: { extractionMetrics: JSON.stringify(extracted.metrics) },
          });
        } catch (error) {
          const message =
            error instanceof Error
              ? error.message
              : 'Document extraction failed';
          await this.prisma.importJob.update({
            where: { id: jobId },
            data: {
              extractionMetrics: JSON.stringify({
                provider:
                  job.fileObject.mime === 'application/pdf'
                    ? 'pdf-parse'
                    : 'tesseract.js',
                language:
                  job.fileObject.mime === 'application/pdf'
                    ? null
                    : process.env.OCR_LANGUAGE || 'eng',
                failure: message,
                cost: 0,
              }),
            },
          });
          throw new PermanentImportError(message);
        }
      }
      if (!this.validator(payload)) {
        throw new PermanentImportError('Invalid question bank schema');
      }
      const metadataPayload = payload as {
        schemaVersion: 1;
        questions: unknown[];
        source?: unknown;
        promptVersion?: unknown;
        confidence?: unknown;
      };
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          ...(typeof metadataPayload.source === 'string'
            ? { source: metadataPayload.source }
            : {}),
          ...(typeof metadataPayload.promptVersion === 'string'
            ? { promptVersion: metadataPayload.promptVersion }
            : {}),
          ...(typeof metadataPayload.confidence === 'number' &&
          Number.isFinite(metadataPayload.confidence)
            ? {
                confidence: Math.max(
                  0,
                  Math.min(1, metadataPayload.confidence),
                ),
              }
            : {}),
        },
      });
      if (await this.isCancelled(jobId)) return;
      const parsingFinishedAt = new Date();
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          parsingFinishedAt,
          parsingDurationMs:
            parsingFinishedAt.getTime() - parsingStartedAt.getTime(),
        },
      });
      const validatingStartedAt = new Date();
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'VALIDATING',
          totalItems: payload.questions.length,
          validatingStartedAt,
        },
      });
      this.publish(jobId, 'validating', {
        jobId,
        totalItems: payload.questions.length,
      });
      this.logger.info(
        {
          requestId: job.requestId,
          jobId,
          userId: job.userId,
          status: 'VALIDATING',
        },
        'import job stage',
      );

      const failureRows: Array<{ index: number; reason: string }> = [];
      const questions = payload.questions.flatMap((question, index) => {
        if (
          !question ||
          typeof question !== 'object' ||
          typeof (question as Record<string, unknown>).title !== 'string'
        ) {
          failureRows.push({
            index: index + 1,
            reason: '题目必须是包含字符串 title 的对象',
          });
          return [];
        }
        const value = question as Record<string, unknown>;
        if (!this.questionValidator(value)) {
          const reason = this.questionValidator.errors
            ?.map((error) => `${error.instancePath || '/'} ${error.message}`)
            .join('; ');
          failureRows.push({
            index: index + 1,
            reason: `题目字段不符合 JSON Schema${reason ? `: ${reason}` : ''}`,
          });
          return [];
        }
        return [
          {
            title: String(value.title),
            category:
              typeof value.category === 'string' ? value.category : '未分类',
            answer: typeof value.answer === 'string' ? value.answer : '',
            difficulty:
              typeof value.difficulty === 'string' ? value.difficulty : '基础',
            tags: Array.isArray(value.tags)
              ? value.tags.filter(
                  (tag): tag is string => typeof tag === 'string',
                )
              : [],
          },
        ];
      });
      const failedItems = failureRows.length;
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          status: 'DEDUPING',
          failedItems,
          failureReport: failureRows.length
            ? JSON.stringify(failureRows)
            : null,
        },
      });
      this.publish(jobId, 'deduping', {
        jobId,
        inputItems: payload.questions.length,
        validItems: questions.length,
        failedItems,
      });
      this.logger.info(
        {
          requestId: job.requestId,
          jobId,
          userId: job.userId,
          status: 'DEDUPING',
        },
        'import job stage',
      );
      if (await this.isCancelled(jobId)) return;
      const existingQuestions = await this.prisma.question.findMany({
        select: { id: true, title: true },
      });
      const duplicateCandidates = findSemanticCandidates(
        questions,
        existingQuestions,
      );
      await this.prisma.importJob.update({
        where: { id: jobId },
        data: {
          duplicateCandidates: duplicateCandidates.length
            ? JSON.stringify(duplicateCandidates)
            : null,
        },
      });
      const result = await this.questionsService.importMany(
        questions,
        job.reviewRequired ? job.id : undefined,
      );
      if (job.reviewRequired && result.importedCount > 0) {
        const drafts = await this.prisma.question.findMany({
          where: { importJobId: job.id, status: 'DRAFT' },
          select: {
            id: true,
            title: true,
            category: true,
            difficulty: true,
            answer: true,
          },
        });
        // 建议和正文分两次持久化，避免任何规则结果自动改变 Draft 内容。
        await this.prisma.$transaction(
          drafts.map((draft) =>
            this.prisma.question.update({
              where: { id: draft.id },
              data: {
                reviewSuggestions: JSON.stringify(
                  createReviewSuggestions(draft),
                ),
              },
            }),
          ),
        );
      }
      const validatingFinishedAt = new Date();
      const skippedItems = result.skippedCount;
      const finalStatus = job.reviewRequired
        ? 'WAITING_REVIEW'
        : failedItems > 0 || result.skippedCount > 0
          ? 'PARTIAL'
          : 'SUCCEEDED';
      const completed = await this.prisma.importJob.updateMany({
        where: { id: jobId, status: { not: 'CANCELLED' } },
        data: {
          status: finalStatus,
          importedItems: result.importedCount,
          skippedItems,
          failedItems,
          validatingFinishedAt,
          validatingDurationMs:
            validatingFinishedAt.getTime() - validatingStartedAt.getTime(),
          failureReport: failureRows.length
            ? JSON.stringify(failureRows)
            : null,
          finishedAt: finalStatus === 'WAITING_REVIEW' ? null : new Date(),
        },
      });
      if (completed.count === 0) return;
      const succeeded = await this.prisma.importJob.findUniqueOrThrow({
        where: { id: jobId },
      });
      this.publish(jobId, finalStatus.toLowerCase(), succeeded);
      this.logger.info(
        {
          requestId: succeeded.requestId,
          jobId,
          userId: succeeded.userId,
          status: succeeded.status,
        },
        'import job completed',
      );
      this.metrics.recordImportJob(
        finalStatus,
        Date.now() - processingStartedAt,
      );
    } finally {
      if (!this.importQueue.isRedisEnabled()) {
        this.queued.delete(jobId);
        this.metrics.setQueueDepth(this.queued.size);
      }
    }
  }

  async publishReview(userId: number, jobId: string) {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
      include: { questions: true },
    });
    if (!job) throw new NotFoundException('Import job not found');
    if (!job.reviewRequired || job.status !== 'WAITING_REVIEW') return job;
    const published = await this.prisma.$transaction(async (tx) => {
      await tx.importJob.update({
        where: { id: jobId },
        data: { status: 'PUBLISHING', reviewerId: userId },
      });
      for (const question of job.questions) {
        const updated = await tx.question.update({
          where: { id: question.id },
          data: { status: 'PUBLISHED', version: { increment: 1 } },
        });
        await tx.questionRevision.create({
          data: {
            questionId: question.id,
            editorId: userId,
            beforeJson: JSON.stringify(question),
            afterJson: JSON.stringify(updated),
            reason: `IMPORT_PUBLISH_${jobId}`,
          },
        });
        await tx.auditLog.create({
          data: {
            actorId: userId,
            action: 'IMPORT_PUBLISHED',
            entityType: 'ImportJob',
            entityId: jobId,
            questionId: question.id,
            metadata: JSON.stringify({ jobId, questionId: question.id }),
          },
        });
      }
      return tx.importJob.update({
        where: { id: jobId },
        data: { status: 'SUCCEEDED', finishedAt: new Date() },
      });
    });
    this.publish(jobId, 'published', published);
    return published;
  }

  async getReview(userId: number, jobId: string, actorRole: string) {
    const where = actorRole === 'ADMIN' ? { id: jobId } : { id: jobId, userId };
    const job = await this.prisma.importJob.findFirst({
      where,
      include: { questions: { orderBy: { id: 'asc' } } },
    });
    if (!job) throw new NotFoundException('Import job not found');
    return {
      ...job,
      questions: job.questions.map((question) => ({
        ...question,
        tags: JSON.parse(question.tags) as string[],
        reviewSuggestions: parseReviewSuggestions(question.reviewSuggestions),
      })),
    };
  }

  async rollbackReview(userId: number, jobId: string) {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
    });
    if (!job) throw new NotFoundException('Import job not found');
    if (job.status !== 'WAITING_REVIEW') return job;
    return this.prisma.$transaction(async (tx) => {
      const removed = await tx.question.deleteMany({
        where: { importJobId: jobId, status: 'DRAFT' },
      });
      await tx.auditLog.create({
        data: {
          actorId: userId,
          action: 'IMPORT_ROLLED_BACK',
          entityType: 'ImportJob',
          entityId: jobId,
          metadata: JSON.stringify({ removedDrafts: removed.count }),
        },
      });
      return tx.importJob.update({
        where: { id: jobId },
        data: {
          status: 'CANCELLED',
          finishedAt: new Date(),
          errorMessage: `Review batch rolled back by administrator (${removed.count} drafts)`,
        },
      });
    });
  }

  async markRetrying(
    jobId: string,
    attempt: number,
    maxAttempts: number,
    error: unknown,
  ) {
    const message = error instanceof Error ? error.message : 'Import failed';
    const updated = await this.prisma.importJob.updateMany({
      where: { id: jobId, status: { not: 'CANCELLED' } },
      data: {
        status: 'QUEUED',
        errorMessage: `Attempt ${attempt}/${maxAttempts} failed: ${message}`,
        finishedAt: null,
      },
    });
    if (updated.count === 0) return this.getById(jobId);
    const retrying = await this.getById(jobId);
    this.publish(jobId, 'retrying', retrying);
    this.logger.warn(
      {
        requestId: retrying.requestId,
        jobId,
        userId: retrying.userId,
        attempt,
        maxAttempts,
        error: message,
      },
      'import job scheduled for retry',
    );
    return retrying;
  }

  async markFailed(jobId: string, error: unknown) {
    const message = error instanceof Error ? error.message : 'Import failed';
    const current = await this.prisma.importJob.findUnique({
      where: { id: jobId },
    });
    if (!current || current.status === 'CANCELLED') return current;
    const updated = await this.prisma.importJob.updateMany({
      where: { id: jobId, status: { not: 'CANCELLED' } },
      data: {
        status: 'FAILED',
        errorMessage: message,
        failureReport: JSON.stringify([{ index: 0, reason: message }]),
        finishedAt: new Date(),
      },
    });
    if (updated.count === 0) return this.getById(jobId);
    const failed = await this.getById(jobId);
    this.publish(jobId, 'failed', failed);
    this.logger.error(
      {
        requestId: failed.requestId,
        jobId,
        userId: failed.userId,
        status: failed.status,
        error: failed.errorMessage,
      },
      'import job failed',
    );
    this.metrics.recordImportJob(
      'FAILED',
      failed.startedAt
        ? Math.max(0, Date.now() - failed.startedAt.getTime())
        : undefined,
    );
    return failed;
  }

  private async processLocal(jobId: string) {
    try {
      await this.processJob(jobId);
    } catch (error) {
      await this.markFailed(jobId, error);
    }
  }

  private async isCancelled(jobId: string) {
    const job = await this.prisma.importJob.findUnique({
      where: { id: jobId },
      select: { status: true },
    });
    return !job || job.status === 'CANCELLED';
  }

  private getById(jobId: string) {
    return this.prisma.importJob.findUniqueOrThrow({ where: { id: jobId } });
  }

  private publish(jobId: string, event: string, data: unknown) {
    const history = this.events.get(jobId) || [];
    history.push({ id: this.nextEventId++, event, data });
    this.events.set(jobId, history.slice(-50));
  }

  private async recoverInterruptedJobs() {
    const cutoff = new Date(Date.now() - 15 * 60 * 1000);
    const redisQueue = this.importQueue.isRedisEnabled();
    const stale = await this.prisma.importJob.findMany({
      where: redisQueue
        ? { status: 'QUEUED' }
        : {
            OR: [
              { status: 'QUEUED' },
              { status: 'PARSING', startedAt: { lt: cutoff } },
              { status: 'VALIDATING', startedAt: { lt: cutoff } },
              { status: 'DEDUPING', startedAt: { lt: cutoff } },
            ],
          },
      select: { id: true, status: true, startedAt: true },
    });
    for (const job of stale) {
      if (job.status === 'QUEUED') {
        await this.enqueue(job.id);
        continue;
      }
      const failed = await this.prisma.importJob.update({
        where: { id: job.id },
        data: {
          status: 'FAILED',
          errorMessage: 'Import worker timed out; retry is available',
          finishedAt: new Date(),
        },
      });
      this.publish(job.id, 'failed', failed);
    }
  }
}
