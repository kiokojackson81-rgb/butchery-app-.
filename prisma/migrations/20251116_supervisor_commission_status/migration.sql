-- Manual migration for SupervisorCommission + CommissionStatus
-- Safely create enum if it doesn't exist
DO $$
BEGIN
	IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CommissionStatus') THEN
		CREATE TYPE "CommissionStatus" AS ENUM ('CALCULATED','APPROVED','PAID');
	END IF;
END$$;

-- Create SupervisorCommission table
CREATE TABLE IF NOT EXISTS "SupervisorCommission" (
	"id" TEXT PRIMARY KEY,
	"date" TEXT NOT NULL,
	"outletName" TEXT NOT NULL,
	"status" "CommissionStatus" NOT NULL DEFAULT 'CALCULATED',
	"approvedAt" TIMESTAMP(3),
	"paidAt" TIMESTAMP(3),
	"note" TEXT,
	"createdAt" TIMESTAMP(3) NOT NULL DEFAULT NOW(),
	"updatedAt" TIMESTAMP(3) NOT NULL DEFAULT NOW()
);

-- Uniqueness per day/outlet
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'SupervisorCommission_date_outletName_key'
	) THEN
		CREATE UNIQUE INDEX "SupervisorCommission_date_outletName_key" ON "SupervisorCommission" ("date", "outletName");
	END IF;
END$$;

-- Query index
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'SupervisorCommission_outletName_date_idx'
	) THEN
		CREATE INDEX "SupervisorCommission_outletName_date_idx" ON "SupervisorCommission" ("outletName", "date");
	END IF;
END$$;

