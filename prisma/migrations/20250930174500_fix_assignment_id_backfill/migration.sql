-- Enable UUID generation (Neon supports pgcrypto)
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- 1) Add id column if missing (UUID type)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'AttendantAssignment'
      AND column_name = 'id'
  ) THEN
    ALTER TABLE "public"."AttendantAssignment" ADD COLUMN "id" UUID;
  END IF;
END$$;

-- 2) Backfill null ids
UPDATE "public"."AttendantAssignment"
SET "id" = gen_random_uuid()
WHERE "id" IS NULL;

-- 3) Enforce NOT NULL
ALTER TABLE "public"."AttendantAssignment" ALTER COLUMN "id" SET NOT NULL;

-- 4) Add PK if table has no primary key yet
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public."AttendantAssignment"'::regclass
      AND contype = 'p'
  ) THEN
    ALTER TABLE "public"."AttendantAssignment" ADD CONSTRAINT "AttendantAssignment_pkey" PRIMARY KEY ("id");
  END IF;
END$$;

-- 5) Set default for future inserts
ALTER TABLE "public"."AttendantAssignment" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();
