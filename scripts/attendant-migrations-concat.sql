-- Combined attendant-related migrations (chronological)
-- Generated: 2025-10-23
-- Run in production only after taking a DB backup/snapshot.

-- ========== migration: 20250925192406_init/migration.sql ==========
-- (initial schema: creates Outlet, Product, PersonCode, AttendantClosing, AttendantDeposit, AttendantExpense, etc.)

CREATE TYPE IF NOT EXISTS "public"."PersonRole" AS ENUM ('attendant', 'supervisor', 'supplier');
CREATE TYPE IF NOT EXISTS "public"."DepositStatus" AS ENUM ('VALID', 'PENDING', 'INVALID');

CREATE TABLE IF NOT EXISTS "public"."Outlet" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Outlet_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."Product" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT NOT NULL,
    "sellPrice" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "Product_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."PersonCode" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "code" TEXT NOT NULL,
    "role" "public"."PersonRole" NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    CONSTRAINT "PersonCode_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."AttendantClosing" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "outletName" TEXT NOT NULL,
    "itemKey" TEXT NOT NULL,
    "closingQty" DOUBLE PRECISION NOT NULL,
    "wasteQty" DOUBLE PRECISION NOT NULL DEFAULT 0,
    CONSTRAINT "AttendantClosing_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."AttendantDeposit" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "outletName" TEXT NOT NULL,
    "code" TEXT,
    "note" TEXT,
    "amount" INTEGER NOT NULL,
    "status" "public"."DepositStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendantDeposit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "public"."AttendantExpense" (
    "id" TEXT NOT NULL,
    "date" TEXT NOT NULL,
    "outletName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AttendantExpense_pkey" PRIMARY KEY ("id")
);

-- indexes from init
CREATE UNIQUE INDEX IF NOT EXISTS "Outlet_name_key" ON "public"."Outlet"("name");
CREATE UNIQUE INDEX IF NOT EXISTS "PersonCode_code_key" ON "public"."PersonCode"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "AttendantClosing_date_outletName_itemKey_key" ON "public"."AttendantClosing"("date", "outletName", "itemKey");

-- ========== migration: 20250925201601_add_attendant_assignment/migration.sql ==========
-- AttendantAssignment table (initial)

CREATE TABLE IF NOT EXISTS "public"."AttendantAssignment" (
    "code" TEXT NOT NULL,
    "outlet" TEXT NOT NULL,
    "productKeys" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AttendantAssignment_pkey" PRIMARY KEY ("code")
);

-- ========== migration: 20250929130500_add_attendant_and_session/migration.sql ==========
-- (empty in local repo) -- nothing to execute here

-- ========== migration: 20250930170000_fix_missing_tables/migration.sql ==========
-- Fix missing tables and create Attendant, LoginCode, WaMessageLog, PhoneMapping, etc.

ALTER TABLE IF EXISTS "public"."AttendantAssignment" DROP CONSTRAINT IF EXISTS "AttendantAssignment_pkey";
ALTER TABLE IF EXISTS "public"."AttendantAssignment" ADD COLUMN IF NOT EXISTS "id" TEXT;

DO $$ BEGIN
    PERFORM 1 FROM information_schema.columns 
     WHERE table_schema = 'public' AND table_name = 'AttendantAssignment' AND column_name = 'productKeys';
    IF FOUND THEN
        ALTER TABLE "public"."AttendantAssignment" DROP COLUMN "productKeys";
    END IF;
END $$;
ALTER TABLE IF EXISTS "public"."AttendantAssignment" ADD COLUMN IF NOT EXISTS "productKeys" TEXT[];

UPDATE "public"."AttendantAssignment"
SET "id" = COALESCE("id", 'aa_' || md5(random()::text || clock_timestamp()::text))
WHERE "id" IS NULL;

ALTER TABLE IF EXISTS "public"."AttendantAssignment" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE IF EXISTS "public"."AttendantAssignment" ADD CONSTRAINT IF NOT EXISTS "AttendantAssignment_pkey" PRIMARY KEY ("id");

-- Create PhoneMapping
CREATE TABLE IF NOT EXISTS "public"."PhoneMapping" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "phoneE164" TEXT NOT NULL,
    "outlet" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PhoneMapping_pkey" PRIMARY KEY ("id")
);

-- Create Attendant table
CREATE TABLE IF NOT EXISTS "public"."Attendant" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "outletId" TEXT,
    "loginCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Attendant_pkey" PRIMARY KEY ("id")
);

-- Create LoginCode table
CREATE TABLE IF NOT EXISTS "public"."LoginCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "attendantId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);

-- Create WaMessageLog
CREATE TABLE IF NOT EXISTS "public"."WaMessageLog" (
    "id" TEXT NOT NULL,
    "attendantId" TEXT,
    "direction" TEXT NOT NULL,
    "templateName" TEXT,
    "payload" JSONB NOT NULL,
    "waMessageId" TEXT,
    "status" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WaMessageLog_pkey" PRIMARY KEY ("id")
);

-- Unique indexes
CREATE UNIQUE INDEX IF NOT EXISTS "PhoneMapping_code_key" ON "public"."PhoneMapping"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "Attendant_loginCode_key" ON "public"."Attendant"("loginCode");
CREATE UNIQUE INDEX IF NOT EXISTS "LoginCode_code_key" ON "public"."LoginCode"("code");
CREATE UNIQUE INDEX IF NOT EXISTS "WaMessageLog_waMessageId_key" ON "public"."WaMessageLog"("waMessageId");
CREATE UNIQUE INDEX IF NOT EXISTS "AttendantAssignment_code_key" ON "public"."AttendantAssignment"("code");

-- Add FKs
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Outlet') THEN
    ALTER TABLE "public"."Attendant" ADD CONSTRAINT IF NOT EXISTS "Attendant_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "public"."Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Attendant') THEN
    ALTER TABLE "public"."LoginCode" ADD CONSTRAINT IF NOT EXISTS "LoginCode_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "public"."Attendant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- Session FK guarded (Session table may have been created later)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Session') AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Attendant') THEN
    ALTER TABLE "public"."Session" ADD CONSTRAINT IF NOT EXISTS "Session_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "public"."Attendant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;

-- ========== migration: 20250930174500_fix_assignment_id_backfill/migration.sql ==========
-- Ensure gen_random_uuid availability and convert AttendantAssignment.id to UUID when needed

CREATE EXTENSION IF NOT EXISTS "pgcrypto";

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

UPDATE "public"."AttendantAssignment"
SET "id" = gen_random_uuid()
WHERE "id" IS NULL;

ALTER TABLE "public"."AttendantAssignment" ALTER COLUMN "id" SET NOT NULL;

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

ALTER TABLE "public"."AttendantAssignment" ALTER COLUMN "id" SET DEFAULT gen_random_uuid();

-- ========== migration: 20250930190000_add_wa_session/migration.sql ==========
-- WaSession table and index

CREATE TABLE IF NOT EXISTS "public"."WaSession" (
  "id" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "code" TEXT,
  "outlet" TEXT,
  "state" TEXT NOT NULL DEFAULT 'IDLE',
  "cursor" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "WaSession_phoneE164_key" ON "public"."WaSession"("phoneE164");

-- ========== migration: 20251001_lowercase_codes/migration.sql & cleanup.sql ==========
-- Normalize case/spacing of codes where present; guarded to avoid failing when tables missing

DO $$ BEGIN
  BEGIN
    UPDATE "PersonCode" SET code = lower(code);
  EXCEPTION WHEN undefined_table THEN END;
END $$;

DO $$ BEGIN
  BEGIN
    UPDATE "LoginCode" SET code = lower(code);
  EXCEPTION WHEN undefined_table THEN END;
END $$;

DO $$ BEGIN
  BEGIN
    UPDATE "Attendant" SET "loginCode" = lower("loginCode");
  EXCEPTION WHEN undefined_table THEN END;
END $$;

-- Additional dedupe / normalization blocks also included in the full migration set.

-- ========== migration: 20251001_add_code_indexes/migration.sql ==========
-- Add functional indexes for Attendant loginCode canonical lookups (guarded)

DO $$ BEGIN
  IF to_regclass('public.attendant_login_full_uidx') IS NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX attendant_login_full_uidx ON "Attendant" ( lower(regexp_replace("loginCode", ''\s+'', '''', ''g'')) )';
  END IF;
EXCEPTION WHEN undefined_table THEN
END $$;

DO $$ BEGIN
  IF to_regclass('public.attendant_login_num_idx') IS NULL THEN
    EXECUTE 'CREATE INDEX attendant_login_num_idx ON "Attendant" ( regexp_replace("loginCode", ''\D'', '''', ''g'') )';
  END IF;
EXCEPTION WHEN undefined_table THEN
END $$;

-- ========== migration: 20251002_add_attendant_tillcount/migration.sql ==========
-- Create AttendantTillCount

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'AttendantTillCount'
    ) THEN
        CREATE TABLE "public"."AttendantTillCount" (
            "id" TEXT NOT NULL,
            "date" TEXT NOT NULL,
            "outletName" TEXT NOT NULL,
            "counted" DOUBLE PRECISION NOT NULL DEFAULT 0,
            CONSTRAINT "AttendantTillCount_pkey" PRIMARY KEY ("id")
        );
    END IF;
END $$;

DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'AttendantTillCount_date_outletName_key'
    ) THEN
        CREATE UNIQUE INDEX "AttendantTillCount_date_outletName_key"
        ON "public"."AttendantTillCount" ("date", "outletName");
    END IF;
END $$;

-- ========== migration: 20251002_normalize_attendant_codes/migration.sql ==========
-- AttendantAssignment normalization, dedupe and convert productKeys -> jsonb

UPDATE "AttendantAssignment"
SET "code" = lower(regexp_replace(btrim("code"), '\\s+', '', 'g'))
WHERE "code" IS NOT NULL
  AND "code" <> lower(regexp_replace(btrim("code"), '\\s+', '', 'g'));

WITH ranked AS (
  SELECT
    id,
    code,
    outlet,
    "updatedAt",
    "productKeys",
    ROW_NUMBER() OVER (
      PARTITION BY code
      ORDER BY
        CASE WHEN outlet IS NOT NULL AND outlet <> '' THEN 0 ELSE 1 END,
        "updatedAt" DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM "AttendantAssignment"
),
merged AS (
  SELECT
    code,
    COALESCE(
      MAX(outlet) FILTER (WHERE outlet IS NOT NULL AND outlet <> ''),
      MAX(outlet)
    ) AS outlet,
    COALESCE(
      ARRAY_AGG(DISTINCT key) FILTER (WHERE key IS NOT NULL),
      ARRAY[]::text[]
    ) AS keys
  FROM (
    SELECT
      code,
      outlet,
      unnest(COALESCE("productKeys", ARRAY[]::text[])) AS key
    FROM "AttendantAssignment"
  ) AS unnested
  GROUP BY code
)
UPDATE "AttendantAssignment" aa
SET
  outlet = merged.outlet,
  "productKeys" = merged.keys
FROM ranked r
JOIN merged ON merged.code = r.code
WHERE aa.id = r.id
  AND r.rn = 1;

DELETE FROM "AttendantAssignment" aa
USING (
  SELECT id, rn
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY code
        ORDER BY
          CASE WHEN outlet IS NOT NULL AND outlet <> '' THEN 0 ELSE 1 END,
          "updatedAt" DESC NULLS LAST,
          id DESC
      ) AS rn
    FROM "AttendantAssignment"
  ) ranked_inline
  WHERE rn > 1
) dupes
WHERE aa.id = dupes.id;

ALTER TABLE "AttendantAssignment"
  ALTER COLUMN "productKeys" TYPE jsonb
  USING to_jsonb(COALESCE("productKeys", ARRAY[]::text[]));

CREATE UNIQUE INDEX IF NOT EXISTS "AttendantAssignment_code_key"
  ON "AttendantAssignment" ("code");

CREATE UNIQUE INDEX IF NOT EXISTS idx_attendantassignment_canon
  ON "AttendantAssignment" ((lower(regexp_replace("code", '\\s+', '', 'g'))));

-- ========== migration: 20251007_add_session_hardening/migration.sql ==========
-- Add session hardening columns to WaSession

ALTER TABLE IF EXISTS "public"."WaSession"
ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lastFinalizeAt" TIMESTAMP(3) NULL;

-- ========== migration: 20251022_add_attendantdeposit_verifypayload/migration.sql ==========
-- Add verifyPayload JSONB column to AttendantDeposit

DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'AttendantDeposit' AND column_name = 'verifyPayload') THEN
        ALTER TABLE "public"."AttendantDeposit" ADD COLUMN "verifyPayload" JSONB;
    END IF;
END$$;

-- End of combined file

-- IMPORTANT: This file is a concatenation of multiple migrations and is intended
-- to be executed only when running migrations manually. Prefer `npx prisma migrate deploy`.
