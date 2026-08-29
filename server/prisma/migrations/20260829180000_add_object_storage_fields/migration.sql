-- Object storage metadata is optional so existing filesystem sessions remain readable.
DROP INDEX IF EXISTS "UploadSession_objectKey_key";
DROP INDEX IF EXISTS "FileObject_objectKey_key";

ALTER TABLE "UploadSession"
  ADD COLUMN "bucket" TEXT,
  ADD COLUMN "uploadId" TEXT,
  ADD COLUMN "storageBackend" TEXT NOT NULL DEFAULT 'filesystem';

ALTER TABLE "FileObject"
  ADD COLUMN "bucket" TEXT,
  ADD COLUMN "storageBackend" TEXT NOT NULL DEFAULT 'filesystem';

CREATE INDEX IF NOT EXISTS "UploadSession_objectKey_idx"
  ON "UploadSession"("objectKey");
CREATE INDEX IF NOT EXISTS "FileObject_objectKey_idx"
  ON "FileObject"("objectKey");
