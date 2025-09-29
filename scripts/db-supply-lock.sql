-- scripts/db-supply-lock.sql
-- Idempotent DDL for supply lock support
-- Creates OpeningLock table used by /api/supply/lock routes

CREATE TABLE IF NOT EXISTS "OpeningLock" (
  id SERIAL PRIMARY KEY,
  date DATE NOT NULL,
  "outletName" TEXT NOT NULL,
  locked BOOLEAN NOT NULL DEFAULT FALSE,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Unique constraint on (date, outletName)
CREATE UNIQUE INDEX IF NOT EXISTS openinglock_date_outlet_unique
  ON "OpeningLock" (date, "outletName");

-- Trigger to update updatedAt
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'openinglock_set_updated_at'
  ) THEN
    CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
    BEGIN
      NEW."updatedAt" = NOW();
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;

    CREATE TRIGGER openinglock_set_updated_at
    BEFORE UPDATE ON "OpeningLock"
    FOR EACH ROW
    EXECUTE FUNCTION set_updated_at();
  END IF;
END $$;
