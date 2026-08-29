CREATE TYPE "ImportJobStatus" AS ENUM ('QUEUED', 'PARSING', 'VALIDATING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "fileObjectId" INTEGER NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "status" "ImportJobStatus" NOT NULL DEFAULT 'QUEUED',
    "totalItems" INTEGER NOT NULL DEFAULT 0,
    "importedItems" INTEGER NOT NULL DEFAULT 0,
    "skippedItems" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ImportJob_userId_status_idx" ON "ImportJob"("userId", "status");
CREATE INDEX "ImportJob_fileObjectId_idx" ON "ImportJob"("fileObjectId");
CREATE UNIQUE INDEX "ImportJob_userId_idempotencyKey_key" ON "ImportJob"("userId", "idempotencyKey");

ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_fileObjectId_fkey"
  FOREIGN KEY ("fileObjectId") REFERENCES "FileObject"("id") ON DELETE CASCADE ON UPDATE CASCADE;
