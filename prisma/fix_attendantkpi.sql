-- Create AttendantKPI table if missing (guards to be safe for production)
CREATE TABLE IF NOT EXISTS "AttendantKPI" (
  "id" TEXT PRIMARY KEY,
  "date" TEXT NOT NULL,
  "attendantId" TEXT NOT NULL,
  "outletName" TEXT NOT NULL,
  "sales" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "gp" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "expenses" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "np" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "salaryDay" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "roiVsSalary" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "wasteCost" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "wastePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "depositExpected" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "depositActual" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "depositGap" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "totalWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "commissionTarget" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "commissionRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "commissionKg" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "commissionAmount" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "redFlags" TEXT[] DEFAULT '{}',
  "createdAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Add unique constraint if not exists (create constraint only if missing)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
    JOIN pg_class t ON c.conrelid = t.oid
    WHERE c.conname = 'attendantkpi_date_attendant_outlet_uq') THEN
    ALTER TABLE "AttendantKPI" ADD CONSTRAINT attendantkpi_date_attendant_outlet_uq UNIQUE ("date","attendantId","outletName");
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "AttendantKPI_outlet_date_idx" ON "AttendantKPI" ("outletName", "date");
CREATE INDEX IF NOT EXISTS "AttendantKPI_attendant_date_idx" ON "AttendantKPI" ("attendantId", "date");

-- Add foreign key to Attendant if the table exists and FK not present
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM pg_class WHERE relname = 'Attendant') THEN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.table_constraints tc
      JOIN information_schema.key_column_usage kcu ON tc.constraint_name = kcu.constraint_name
      WHERE tc.table_name = 'AttendantKPI' AND tc.constraint_type = 'FOREIGN KEY' AND kcu.column_name = 'attendantId'
    ) THEN
      ALTER TABLE "AttendantKPI" ADD CONSTRAINT attendantkpi_attendant_fk FOREIGN KEY ("attendantId") REFERENCES "Attendant"("id");
    END IF;
  END IF;
EXCEPTION WHEN others THEN NULL; END $$;
