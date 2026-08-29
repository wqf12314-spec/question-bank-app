import { INestApplication, ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import cookieParser from 'cookie-parser';
import helmet from 'helmet';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor';

export function configureApp(app: INestApplication): void {
  app.enableCors({
    origin: [
      process.env.FRONTEND_URL ?? 'http://localhost:5173',
      'http://localhost:3000',
    ],
    credentials: true,
  });
  app.use(cookieParser());
  // API 与 E2E 共用 Helmet，避免只在反向代理上补安全响应头导致本地验证失真。
  app.use(helmet());
  const buckets = new Map<string, { count: number; resetAt: number }>();
  app.use((request: any, response: any, next: any) => {
    if (
      ![
        'POST /auth/login',
        'POST /auth/register',
        'POST /uploads/initiate',
      ].includes(`${request.method} ${request.path}`)
    )
      return next();
    const key = `${request.ip}:${request.method}:${request.path}`;
    const now = Date.now();
    const bucket = buckets.get(key);
    if (!bucket || bucket.resetAt <= now)
      buckets.set(key, { count: 1, resetAt: now + 60_000 });
    else if (bucket.count >= 30) {
      response.setHeader('Retry-After', '60');
      return response.status(429).json({
        success: false,
        error: { code: 'RATE_LIMITED', message: 'Too many requests' },
      });
    } else bucket.count += 1;
    next();
  });
  app.use(json({ limit: '2mb' }));
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  // 正式服务与 E2E 共用协议配置，避免测试环境绕过真实校验链路。
  app.useGlobalInterceptors(new ApiResponseInterceptor());
  app.useGlobalFilters(new ApiExceptionFilter());
}
