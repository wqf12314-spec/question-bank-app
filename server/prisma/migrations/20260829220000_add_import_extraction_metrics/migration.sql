-- 可空字段保证旧任务与旧客户端在 expand 阶段继续可读。
ALTER TABLE "ImportJob"
  ADD COLUMN IF NOT EXISTS "extractionMetrics" TEXT;
