-- Fail before writing if historical titles would collide with the unique index.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "Question"
    GROUP BY lower(btrim("title"))
    HAVING COUNT(*) > 1
  ) THEN
    RAISE EXCEPTION 'Cannot backfill normalizedTitle: duplicate normalized titles exist';
  END IF;
END $$;

-- Rebuild the server-owned value from the source title for every historical row.
UPDATE "Question"
SET "normalizedTitle" = lower(btrim("title"));

-- New writes must never be allowed to omit the deduplication key.
ALTER TABLE "Question"
ALTER COLUMN "normalizedTitle" SET NOT NULL;
