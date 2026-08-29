const { join } = require('node:path');
const { config } = require('dotenv');

const serverRoot = join(__dirname, '..');
config({ path: join(serverRoot, '.env.test'), quiet: true });

if (!process.env.TEST_DATABASE_URL) {
  throw new Error('TEST_DATABASE_URL is required for browser tests');
}

const databaseName = new URL(process.env.TEST_DATABASE_URL).pathname;
if (!/test/i.test(databaseName)) {
  throw new Error(
    "Browser tests refuse to use a database without 'test' in its name",
  );
}

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.DIRECT_DATABASE_URL = process.env.TEST_DATABASE_URL;
process.env.ACCESS_TOKEN_SECRET ||= 'browser-e2e-only-access-token-secret';
process.env.PORT = '3003';
process.env.FRONTEND_URL = 'http://127.0.0.1:4173';

process.chdir(serverRoot);
require(join(serverRoot, 'dist', 'src', 'main.js'));
