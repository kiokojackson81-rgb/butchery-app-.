-- Safe reapply: replace failed migration with a new one Prisma can find
-- This mirrors the idempotent logic from the previous migration, but under a new timestamped folder.

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

BEGIN;

DO $$
DECLARE
  current_type text;
  has_pk bool;
BEGIN
  SELECT data_type INTO current_type
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = 'AttendantAssignment' AND column_name = 'id';

  IF current_type IS NULL THEN
    EXECUTE 'ALTER TABLE "public"."AttendantAssignment" ADD COLUMN "id" uuid';
    EXECUTE 'UPDATE "public"."AttendantAssignment" SET "id" = gen_random_uuid() WHERE "id" IS NULL';
    EXECUTE 'ALTER TABLE "public"."AttendantAssignment" ALTER COLUMN "id" SET NOT NULL';

    SELECT EXISTS (
      SELECT 1 FROM pg_constraint
      WHERE conrelid = 'public."AttendantAssignment"'::regclass AND contype = 'p'
    ) INTO has_pk;
    IF has_pk THEN
      EXECUTE 'ALTER TABLE "public"."AttendantAssignment" DROP CONSTRAINT "AttendantAssignment_pkey"';
    END IF;
    EXECUTE 'ALTER TABLE "public"."AttendantAssignment" ADD CONSTRAINT "AttendantAssignment_pkey" PRIMARY KEY ("id")';

  ELSIF current_type = 'uuid' THEN
    PERFORM 1;

  ELSE
    EXECUTE 'ALTER TABLE "public"."AttendantAssignment" ADD COLUMN "id_uuid" uuid';
    EXECUTE 'UPDATE "public"."AttendantAssignment" SET "id_uuid" = CASE WHEN "id" ~ ''^[0-9a-fA-F-]{36}$'' THEN ("id")::uuid ELSE gen_random_uuid() END';
    EXECUTE 'ALTER TABLE "public"."AttendantAssignment" DROP CONSTRAINT IF EXISTS "AttendantAssignment_pkey"';
    EXECUTE 'ALTER TABLE "public"."AttendantAssignment" DROP COLUMN "id"';
    EXECUTE 'ALTER TABLE "public"."AttendantAssignment" RENAME COLUMN "id_uuid" TO "id"';
    EXECUTE 'ALTER TABLE "public"."AttendantAssignment" ALTER COLUMN "id" SET NOT NULL';
    EXECUTE 'ALTER TABLE "public"."AttendantAssignment" ADD CONSTRAINT "AttendantAssignment_pkey" PRIMARY KEY ("id")';
  END IF;
END $$;

ALTER TABLE "public"."AttendantAssignment" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

COMMIT;
