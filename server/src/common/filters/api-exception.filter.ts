import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Response } from 'express';
import type { RequestWithId } from '../middleware/request-id.middleware';

type ApiErrorResponse = {
  success: false;
  error: {
    code: string;
    message: string;
    requestId?: string;
  };
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<RequestWithId>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const payload =
      exception instanceof HttpException ? exception.getResponse() : null;

    if (this.isApiErrorResponse(payload)) {
      response.status(status).json({
        ...payload,
        error: {
          ...payload.error,
          requestId: request.requestId,
        },
      });
      return;
    }

    response.status(status).json({
      success: false,
      error: {
        code: this.getErrorCode(status),
        message: this.getErrorMessage(payload, status),
        requestId: request.requestId,
      },
    });
  }

  private getErrorCode(status: number) {
    // HTTP 状态负责协议语义，稳定业务码供前端编写判断逻辑。
    const codeByStatus: Record<number, string> = {
      [HttpStatus.BAD_REQUEST]: 'VALIDATION_ERROR',
      [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
      [HttpStatus.CONFLICT]: 'CONFLICT',
    };

    return (
      codeByStatus[status] ??
      (status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_ERROR')
    );
  }

  private getErrorMessage(payload: unknown, status: number) {
    if (typeof payload === 'string') {
      return payload;
    }

    if (payload && typeof payload === 'object') {
      const message = (payload as Record<string, unknown>).message;
      if (Array.isArray(message)) {
        return message
          .filter((item): item is string => typeof item === 'string')
          .join('; ');
      }
      if (typeof message === 'string') {
        return message;
      }
    }

    return status >= 500 ? 'Internal server error' : 'Request failed';
  }

  private isApiErrorResponse(payload: unknown): payload is ApiErrorResponse {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    const record = payload as Record<string, unknown>;
    const error = record.error;
    return (
      record.success === false &&
      !!error &&
      typeof error === 'object' &&
      typeof (error as Record<string, unknown>).code === 'string' &&
      typeof (error as Record<string, unknown>).message === 'string'
    );
  }
}
