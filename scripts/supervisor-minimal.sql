-- Minimal SupervisorCommission table (no triggers)
CREATE TABLE IF NOT EXISTS "public"."SupervisorCommission" (
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

CREATE INDEX IF NOT EXISTS "SupervisorCommission_date_outlet_idx" ON "public"."SupervisorCommission" ("date", "outletName");
CREATE INDEX IF NOT EXISTS "SupervisorCommission_period_supervisor_idx" ON "public"."SupervisorCommission" ("periodKey", "supervisorCode");
