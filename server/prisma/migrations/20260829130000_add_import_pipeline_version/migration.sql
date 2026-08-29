ALTER TABLE "ImportJob" ADD COLUMN "pipelineVersion" TEXT NOT NULL DEFAULT 'v1';
CREATE INDEX "ImportJob_userId_fileObjectId_pipelineVersion_idx"
  ON "ImportJob"("userId", "fileObjectId", "pipelineVersion");
