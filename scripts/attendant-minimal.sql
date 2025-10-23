-- Minimal Attendant DDL: creates Attendant, LoginCode, WaMessageLog, and related indexes/PKs/FKs
-- Run after taking a DB snapshot. This is a minimal subset to satisfy Prisma queries that need the Attendant table.

CREATE TABLE IF NOT EXISTS "public"."Attendant" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "outletId" TEXT,
  "loginCode" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Attendant_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Attendant_loginCode_key" ON "public"."Attendant"("loginCode");

CREATE TABLE IF NOT EXISTS "public"."LoginCode" (
  "id" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "attendantId" TEXT NOT NULL,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "LoginCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "LoginCode_code_key" ON "public"."LoginCode"("code");

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

CREATE UNIQUE INDEX IF NOT EXISTS "WaMessageLog_waMessageId_key" ON "public"."WaMessageLog"("waMessageId");

-- Foreign keys (guarded)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Outlet') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Attendant_outletId_fkey') THEN
      -- add as NOT VALID to avoid failure if orphaned rows exist; validate later when safe
      EXECUTE 'ALTER TABLE "public"."Attendant" ADD CONSTRAINT "Attendant_outletId_fkey" FOREIGN KEY ("outletId") REFERENCES "public"."Outlet"("id") ON DELETE SET NULL ON UPDATE CASCADE NOT VALID';
    END IF;
  END IF;
END $$;

DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'Attendant') THEN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'LoginCode_attendantId_fkey') THEN
      -- add as NOT VALID to avoid failures due to orphaned LoginCode rows; validate after data cleanup
      EXECUTE 'ALTER TABLE "public"."LoginCode" ADD CONSTRAINT "LoginCode_attendantId_fkey" FOREIGN KEY ("attendantId") REFERENCES "public"."Attendant"("id") ON DELETE RESTRICT ON UPDATE CASCADE NOT VALID';
    END IF;
  END IF;
END $$;

-- End minimal DDL
