import { Controller, Get, ServiceUnavailableException } from '@nestjs/common';
import { access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { join } from 'node:path';
import { PrismaService } from './prisma/prisma.service';
import { MetricsService } from './observability/metrics.service';
import { ReadinessAlertService } from './observability/readiness-alert.service';
import { ImportQueueService } from './import-jobs/import-queue.service';
import { ObjectStorageService } from './uploads/object-storage.service';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly metrics: MetricsService,
    private readonly readinessAlerts: ReadinessAlertService,
    private readonly importQueue: ImportQueueService,
    private readonly objectStorage: ObjectStorageService,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok', service: 'question-bank-api' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch (error) {
      const alert = this.readinessAlerts.record('postgres', error);
      throw new ServiceUnavailableException({
        success: false,
        error: {
          code: 'POSTGRES_NOT_READY',
          message: 'PostgreSQL is unavailable',
          detail: alert.message,
        },
      });
    }
    let objectStorageStatus: string = 'local-filesystem';
    if (this.objectStorage.isEnabled()) {
      const objectStorage = await this.objectStorage.health();
      if (objectStorage.status !== 'ok') {
        throw new ServiceUnavailableException({
          success: false,
          error: {
            code: 'OBJECT_STORAGE_NOT_READY',
            message: 'Object storage is unavailable',
            detail: objectStorage.error,
          },
        });
      }
      objectStorageStatus = 's3';
    } else {
      const uploadRoot =
        process.env.UPLOAD_DIR || join(process.cwd(), '.data', 'uploads');
      try {
        await access(uploadRoot, constants.R_OK | constants.W_OK);
      } catch {
        throw new ServiceUnavailableException({
          success: false,
          error: {
            code: 'OBJECT_STORAGE_NOT_READY',
            message: 'Local upload storage is not readable and writable',
          },
        });
      }
    }
    const redis = await this.importQueue.health();
    if (redis.status === 'unavailable') {
      throw new ServiceUnavailableException({
        success: false,
        error: {
          code: 'REDIS_NOT_READY',
          message: 'Redis import queue is unavailable',
          detail: redis.error,
        },
      });
    }
    return {
      status: 'ready',
      dependencies: {
        postgres: 'ok',
        redis: redis.status,
        objectStorage: objectStorageStatus,
      },
      queueDepth: redis.queueDepth,
    };
  }

  @Get('metrics')
  metricsSnapshot() {
    return this.metrics.snapshot();
  }
}
