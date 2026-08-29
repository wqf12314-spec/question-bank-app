import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { UnrecoverableError, Worker, type Job } from 'bullmq';
import pino from 'pino';
import {
  ImportQueueService,
  type ImportQueuePayload,
} from './import-queue.service';
import { ImportJobsService, PermanentImportError } from './import-jobs.service';

@Injectable()
export class ImportWorkerService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = pino({ name: 'question-bank-import-worker' });
  private worker?: Worker<ImportQueuePayload>;

  constructor(
    private readonly queue: ImportQueueService,
    private readonly importJobs: ImportJobsService,
  ) {}

  async onModuleInit() {
    const connection = this.queue.getConnection(true);
    if (!connection) {
      throw new Error('REDIS_URL is required to start the import worker');
    }

    this.worker = new Worker<ImportQueuePayload>(
      this.queue.getQueueName(),
      (job) => this.process(job),
      {
        connection,
        concurrency: this.readPositiveInteger('IMPORT_WORKER_CONCURRENCY', 2),
        lockDuration: this.readPositiveInteger(
          'IMPORT_WORKER_LOCK_DURATION_MS',
          30_000,
        ),
        stalledInterval: this.readPositiveInteger(
          'IMPORT_WORKER_STALLED_INTERVAL_MS',
          30_000,
        ),
        maxStalledCount: this.readPositiveInteger(
          'IMPORT_WORKER_MAX_STALLED_COUNT',
          2,
        ),
      },
    );
    this.worker.on('ready', () =>
      this.logger.info(
        {
          queue: this.queue.getQueueName(),
          concurrency: this.readPositiveInteger('IMPORT_WORKER_CONCURRENCY', 2),
        },
        'import worker ready',
      ),
    );
    this.worker.on('stalled', (jobId) =>
      this.logger.warn({ jobId }, 'stalled import job will be recovered'),
    );
    this.worker.on('error', (error) =>
      this.logger.error({ error: error.message }, 'import worker error'),
    );
    await this.worker.waitUntilReady();
  }

  async onModuleDestroy() {
    await this.worker?.close().catch(() => undefined);
  }

  private async process(job: Job<ImportQueuePayload>) {
    const { jobId, requestId } = job.data;
    this.logger.info(
      { requestId, jobId, attempt: job.attemptsMade + 1 },
      'import worker processing',
    );
    try {
      await this.importJobs.processJob(jobId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const maxAttempts = Number(job.opts.attempts || 1);
      const finalAttempt = job.attemptsMade + 1 >= maxAttempts;
      if (error instanceof PermanentImportError) {
        await this.importJobs.markFailed(jobId, error);
        throw new UnrecoverableError(message);
      }
      if (finalAttempt) await this.importJobs.markFailed(jobId, error);
      else
        await this.importJobs.markRetrying(
          jobId,
          job.attemptsMade + 1,
          maxAttempts,
          error,
        );
      throw error;
    }
  }

  private readPositiveInteger(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
