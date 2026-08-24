import { config } from 'dotenv';

config({ path: '.env.test', quiet: true });

if (!process.env.TEST_DATABASE_URL) {
  // 测试缺少专用连接时立即停止，绝不能回退到保存真实题目的数据库。
  throw new Error('TEST_DATABASE_URL is required for e2e tests');
}
