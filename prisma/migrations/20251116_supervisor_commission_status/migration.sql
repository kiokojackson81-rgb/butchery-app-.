DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionStatus') THEN
		CREATE TYPE "CommissionStatus" AS ENUM ('CALCULATED','APPROVED','PAID');
	END IF;
END$$;

CREATE TABLE IF NOT EXISTS "SupervisorCommission" (
	"id" TEXT PRIMARY KEY,
	"date" TEXT NOT NULL,
	"outletName" TEXT NOT NULL,
	"supervisorCode" TEXT,
	"supervisorPhone" TEXT,
	"salesKsh" INTEGER NOT NULL DEFAULT 0,
	"expensesKsh" INTEGER NOT NULL DEFAULT 0,
	"wasteKsh" INTEGER NOT NULL DEFAULT 0,
	"profitKsh" INTEGER NOT NULL DEFAULT 0,
	"commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.10,
	"commissionKsh" INTEGER NOT NULL DEFAULT 0,
	"periodKey" TEXT NOT NULL,
	"status" TEXT NOT NULL DEFAULT 'calculated',
	"approvedAt" TIMESTAMP(3),
	"paidAt" TIMESTAMP(3),
	"note" TEXT,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
	"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

-- Backfill: add any missing columns if table existed from an earlier partial migration
ALTER TABLE "SupervisorCommission" ADD COLUMN IF NOT EXISTS "supervisorCode" TEXT;
ALTER TABLE "SupervisorCommission" ADD COLUMN IF NOT EXISTS "supervisorPhone" TEXT;
ALTER TABLE "SupervisorCommission" ADD COLUMN IF NOT EXISTS "salesKsh" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SupervisorCommission" ADD COLUMN IF NOT EXISTS "expensesKsh" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SupervisorCommission" ADD COLUMN IF NOT EXISTS "wasteKsh" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SupervisorCommission" ADD COLUMN IF NOT EXISTS "profitKsh" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SupervisorCommission" ADD COLUMN IF NOT EXISTS "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0.10;
ALTER TABLE "SupervisorCommission" ADD COLUMN IF NOT EXISTS "commissionKsh" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "SupervisorCommission" ADD COLUMN IF NOT EXISTS "periodKey" TEXT NOT NULL;
-- Ensure status is TEXT with default 'calculated'
DO $$
BEGIN
	IF EXISTS (
		SELECT 1 FROM information_schema.columns 
		WHERE table_schema = 'public' AND table_name = 'SupervisorCommission' AND column_name = 'status'
	) THEN
		-- Try to alter the column type to TEXT if it's an enum; ignore if it already is TEXT
		BEGIN
			ALTER TABLE "SupervisorCommission" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
		EXCEPTION WHEN others THEN NULL;
		END;
		BEGIN
			ALTER TABLE "SupervisorCommission" ALTER COLUMN "status" SET DEFAULT 'calculated';
		EXCEPTION WHEN others THEN NULL;
		END;
	END IF;
END$$;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'SupervisorCommission_date_outletName_key'
	) THEN
		CREATE UNIQUE INDEX "SupervisorCommission_date_outletName_key" ON "SupervisorCommission" ("date", "outletName");
	END IF;
END$$;

DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'SupervisorCommission_outletName_date_idx'
	) THEN
		CREATE INDEX "SupervisorCommission_outletName_date_idx" ON "SupervisorCommission" ("outletName", "date");
	END IF;
END$$;

-- Query index for periodKey + supervisorCode
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'SupervisorCommission_periodKey_supervisorCode_idx'
	) THEN
		CREATE INDEX "SupervisorCommission_periodKey_supervisorCode_idx" ON "SupervisorCommission" ("periodKey", "supervisorCode");
	END IF;
END$$;

