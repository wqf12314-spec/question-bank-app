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
    _context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<{ success: true; data: T }> {
    // 统一包装成功响应，避免每个 Controller 重复实现响应外壳。
    return next
      .handle()
      .pipe(map((data) => ({ success: true as const, data })));
  }
}
