import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import pino from 'pino';
import { MetricsService } from '../../observability/metrics.service';

export type RequestWithId = Request & {
  requestId: string;
};
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = pino({ name: 'question-bank-api' });

  constructor(private readonly metrics: MetricsService) {}

  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const requestId = randomUUID();
    const startedAt = Date.now();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    response.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      this.metrics.recordRequest(response.statusCode, durationMs);
      const userId = (request as RequestWithId & { user?: { sub?: number } })
        .user?.sub;
      const route = request.route?.path || request.originalUrl.split('?')[0];
      this.logger.info(
        {
          requestId,
          route,
          method: request.method,
          status: response.statusCode,
          durationMs,
          ...(userId ? { userId } : {}),
          ...(request.originalUrl.startsWith('/import-jobs/') &&
          request.params?.id
            ? { jobId: request.params.id }
            : {}),
        },
        'request completed',
      );
    });

    next();
  }
}
