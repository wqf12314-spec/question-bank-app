-- Add the request identity first so existing rows can be backfilled safely.
ALTER TABLE "PracticeRecord" ADD COLUMN "clientRequestId" TEXT;

-- Legacy rows did not have a client request id; their record id is stable and unique.
UPDATE "PracticeRecord"
SET "clientRequestId" = 'legacy-' || "id"::text
WHERE "clientRequestId" IS NULL;

-- New records must always carry a client request id.
ALTER TABLE "PracticeRecord" ALTER COLUMN "clientRequestId" SET NOT NULL;

-- One user cannot create two records for the same client request.
CREATE UNIQUE INDEX "PracticeRecord_userId_clientRequestId_key"
ON "PracticeRecord"("userId", "clientRequestId");
