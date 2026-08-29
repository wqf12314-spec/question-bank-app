import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import pino from 'pino';
import { WorkerModule } from './import-jobs/worker.module';

async function bootstrap() {
  process.env.IMPORT_WORKER = 'true';
  const logger = pino({ name: 'question-bank-import-worker-bootstrap' });
  const app = await NestFactory.createApplicationContext(WorkerModule, {
    logger: false,
    abortOnError: false,
  });
  app.enableShutdownHooks();
  logger.info(
    {
      queue: process.env.IMPORT_QUEUE_NAME || 'question-bank-imports',
      concurrency: Number(process.env.IMPORT_WORKER_CONCURRENCY || 2),
    },
    'independent import worker started',
  );
}

void bootstrap().catch((error) => {
  pino({ name: 'question-bank-import-worker-bootstrap' }).fatal(
    {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    },
    'independent import worker failed to start',
  );
  process.exitCode = 1;
});
