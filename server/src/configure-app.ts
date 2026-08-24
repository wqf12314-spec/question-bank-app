import { INestApplication, ValidationPipe } from '@nestjs/common';
import { json } from 'express';
import { ApiExceptionFilter } from './common/filters/api-exception.filter';
import { ApiResponseInterceptor } from './common/interceptors/api-response.interceptor';

export function configureApp(app: INestApplication): void {
  app.enableCors({
    origin: [
      process.env.FRONTEND_URL ?? 'http://localhost:5173',
      'http://localhost:3000',
    ],
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
