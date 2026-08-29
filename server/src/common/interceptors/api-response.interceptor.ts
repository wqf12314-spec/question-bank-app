import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable()
export class ApiResponseInterceptor<T> implements NestInterceptor<
  T,
  { success: true; data: T }
> {
  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<{ success: true; data: T }> {
    const request = context
      .switchToHttp()
      .getRequest<{ path?: string; headers?: Record<string, string> }>();
    // SSE 是持续事件流，不能套普通 JSON 响应外壳，否则 event/id 字段会丢失。
    if (
      request.path?.endsWith('/events') ||
      request.headers?.accept?.includes('text/event-stream')
    ) {
      return next.handle() as Observable<{ success: true; data: T }>;
    }
    // 统一包装成功响应，避免每个 Controller 重复实现响应外壳。
    return next
      .handle()
      .pipe(map((data) => ({ success: true as const, data })));
  }
}
