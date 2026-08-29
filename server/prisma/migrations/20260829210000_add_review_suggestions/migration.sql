-- 审核建议与题目正文分离；默认空对象保证旧客户端写入仍可兼容。
ALTER TABLE "Question"
  ADD COLUMN IF NOT EXISTS "reviewSuggestions" TEXT NOT NULL DEFAULT '{}';
