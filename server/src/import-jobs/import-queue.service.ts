import {
  Injectable,
  OnModuleDestroy,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Queue, type ConnectionOptions } from 'bullmq';
import { MetricsService } from '../observability/metrics.service';
import pino from 'pino';

export type ImportQueuePayload = {
  jobId: string;
  requestId?: string;
};

export const IMPORT_QUEUE_NAME =
  process.env.IMPORT_QUEUE_NAME || 'question-bank-imports';

export function getRedisConnection(
  blocking = false,
): ConnectionOptions | undefined {
  const rawUrl = process.env.REDIS_URL?.trim();
  if (!rawUrl) return undefined;

  const url = new URL(rawUrl);
  if (!['redis:', 'rediss:'].includes(url.protocol)) {
    throw new Error('REDIS_URL must use redis:// or rediss://');
  }
  const database = url.pathname.replace(/^\//, '');
  return {
    host: url.hostname,
    port: url.port ? Number(url.port) : 6379,
    username: url.username ? decodeURIComponent(url.username) : undefined,
    password: url.password ? decodeURIComponent(url.password) : undefined,
    db: database ? Number(database) : 0,
    tls: url.protocol === 'rediss:' ? {} : undefined,
    // Worker 使用阻塞连接；API 生产者必须快速失败，避免 Redis 故障拖住普通请求。
    maxRetriesPerRequest: blocking ? null : 1,
    connectTimeout: Number(process.env.REDIS_CONNECT_TIMEOUT_MS || 1_000),
    enableOfflineQueue: blocking,
    retryStrategy: blocking ? undefined : () => null,
  };
}

@Injectable()
export class ImportQueueService implements OnModuleDestroy {
  private readonly logger = pino({ name: 'question-bank-import-queue' });
  private queue?: Queue<ImportQueuePayload>;

  constructor(private readonly metrics: MetricsService) {}

  isRedisEnabled() {
    return Boolean(process.env.REDIS_URL?.trim());
  }

  getQueueName() {
    return process.env.IMPORT_QUEUE_NAME || IMPORT_QUEUE_NAME;
  }

  getConnection(blocking = false) {
    return getRedisConnection(blocking);
  }

  async enqueue(payload: ImportQueuePayload, replace = false) {
    const queue = this.getQueue();
    if (!queue) return false;

    try {
      if (replace) {
        const previous = await queue.getJob(payload.jobId);
        if (previous && !(await previous.isActive())) await previous.remove();
      }
      await queue.add('import', payload, {
        jobId: payload.jobId,
        attempts: this.readPositiveInteger('IMPORT_JOB_ATTEMPTS', 3),
        backoff: {
          type: 'exponential',
          delay: this.readPositiveInteger('IMPORT_JOB_BACKOFF_MS', 500),
        },
        removeOnComplete: false,
        removeOnFail: false,
      });
      await this.refreshDepth();
      return true;
    } catch (error) {
      throw new ServiceUnavailableException({
        success: false,
        error: {
          code: 'IMPORT_QUEUE_UNAVAILABLE',
          message: 'Import queue is unavailable; retry after Redis recovers',
          detail: error instanceof Error ? error.message : String(error),
        },
      });
    }
  }

  async health() {
    const queue = this.getQueue();
    if (!queue) {
      return { status: 'not-configured' as const, queueDepth: 0 };
    }
    try {
      // getJobCounts 会真实访问 Redis，同时返回 readiness 所需的队列深度。
      const queueDepth = await this.refreshDepth();
      return { status: 'ok' as const, queueDepth };
    } catch (error) {
      return {
        status: 'unavailable' as const,
        queueDepth: 0,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  async onModuleDestroy() {
    await this.queue?.close().catch(() => undefined);
  }

  private getQueue() {
    const connection = this.getConnection();
    if (!connection) return undefined;
    if (!this.queue) {
      this.queue = new Queue<ImportQueuePayload>(this.getQueueName(), {
        connection,
      });
      this.queue.on('error', (error) =>
        this.logger.warn(
          { error: error.message, queue: this.getQueueName() },
          'import queue connection error',
        ),
      );
    }
    return this.queue;
  }

  private async refreshDepth() {
    const queue = this.getQueue();
    if (!queue) return 0;
    const counts = await queue.getJobCounts(
      'wait',
      'active',
      'delayed',
      'prioritized',
    );
    const depth = Object.values(counts).reduce(
      (total, count) => total + count,
      0,
    );
    this.metrics.setQueueDepth(depth);
    return depth;
  }

  private readPositiveInteger(name: string, fallback: number) {
    const value = Number(process.env[name]);
    return Number.isInteger(value) && value > 0 ? value : fallback;
  }
}
