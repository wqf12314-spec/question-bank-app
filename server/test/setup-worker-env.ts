import { config } from 'dotenv';
import { join } from 'node:path';

config({ path: '.env.test', quiet: true });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required for worker tests');
}
const databaseName = new URL(process.env.TEST_DATABASE_URL).pathname;
if (!databaseName.toLowerCase().includes('test')) {
  throw new Error(
    'Worker tests refuse to use a database without test in its name',
  );
}

process.env.NODE_ENV = 'test';
process.env.ACCESS_TOKEN_SECRET ??= 'worker-integration-access-token-secret';
process.env.REDIS_URL ??= 'redis://127.0.0.1:6380/0';
process.env.IMPORT_QUEUE_NAME ??= `question-bank-import-test-${process.pid}`;
process.env.IMPORT_JOB_ATTEMPTS = '3';
process.env.IMPORT_JOB_BACKOFF_MS = '500';
process.env.IMPORT_WORKER_CONCURRENCY = '2';
process.env.IMPORT_WORKER_LOCK_DURATION_MS = '2000';
process.env.IMPORT_WORKER_STALLED_INTERVAL_MS = '1000';
process.env.UPLOAD_DIR ??= join(
  process.cwd(),
  '.data',
  `worker-integration-${process.pid}`,
);
