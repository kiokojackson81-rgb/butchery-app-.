-- Manual migration: ensure Attendant.salaryAmount column exists in production.
-- Safe for repeated application (IF NOT EXISTS). Compatible with PostgreSQL.
-- Adds salaryAmount (FLOAT/DOUBLE PRECISION) with default 0 and NOT NULL.
-- Also ensures salaryFrequency column exists with TEXT default 'daily' if missing (to align with schema).

DO $$
BEGIN
  -- Add salaryAmount if missing
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Attendant' AND column_name = 'salaryAmount'
  ) THEN
    ALTER TABLE "Attendant" ADD COLUMN "salaryAmount" DOUBLE PRECISION NOT NULL DEFAULT 0;
    -- Backfill existing rows explicitly (should already default, but be explicit)
    UPDATE "Attendant" SET "salaryAmount" = COALESCE("salaryAmount", 0);
  END IF;

  -- Add salaryFrequency if missing (enum mapped as TEXT here for manual safety)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'Attendant' AND column_name = 'salaryFrequency'
  ) THEN
    ALTER TABLE "Attendant" ADD COLUMN "salaryFrequency" TEXT NOT NULL DEFAULT 'daily';
    UPDATE "Attendant" SET "salaryFrequency" = COALESCE("salaryFrequency", 'daily');
  END IF;
END $$;

-- Verification query (optional; ignored by migrate deploy if not supported):
-- SELECT column_name, data_type FROM information_schema.columns WHERE table_name = 'Attendant' AND column_name IN ('salaryAmount','salaryFrequency');
