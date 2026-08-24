import { Injectable, NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { Logger } from '@nestjs/common';

export type RequestWithId = Request & {
  requestId: string;
};
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  private readonly logger = new Logger(RequestIdMiddleware.name);

  use(request: RequestWithId, response: Response, next: NextFunction): void {
    const requestId = randomUUID();
    const startedAt = Date.now();
    request.requestId = requestId;
    response.setHeader('X-Request-Id', requestId);

    response.on('finish', () => {
      const durationMs = Date.now() - startedAt;
      this.logger.log(
        `Request ID: ${requestId} - ${request.method} ${request.originalUrl} - Status: ${response.statusCode}-Duration:${durationMs}ms`,
      );
    });

    next();
  }
}
