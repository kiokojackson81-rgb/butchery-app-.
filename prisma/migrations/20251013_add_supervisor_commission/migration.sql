-- CreateTable
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
  "note" TEXT,
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes
CREATE INDEX IF NOT EXISTS "SupervisorCommission_date_outlet_idx" ON "SupervisorCommission" ("date", "outletName");
CREATE INDEX IF NOT EXISTS "SupervisorCommission_period_supervisor_idx" ON "SupervisorCommission" ("periodKey", "supervisorCode");

-- Trigger to maintain updatedAt (Postgres)
DO $$ BEGIN
  CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
  BEGIN
    NEW."updatedAt" = NOW();
    RETURN NEW;
  END;
  $$ LANGUAGE plpgsql;
EXCEPTION WHEN duplicate_function THEN NULL; END $$;

DO $$ BEGIN
  CREATE TRIGGER supervisor_commission_set_updated
  BEFORE UPDATE ON "SupervisorCommission"
  FOR EACH ROW EXECUTE PROCEDURE set_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
