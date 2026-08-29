DROP INDEX IF EXISTS "ImportJob_idempotencyKey_key";
-- 早期迁移已经创建了同名联合索引；IF NOT EXISTS 让新环境和已有环境都能安全重放。
CREATE UNIQUE INDEX IF NOT EXISTS "ImportJob_userId_idempotencyKey_key" ON "ImportJob"("userId", "idempotencyKey");
