-- Idempotent constraints and indexes for production hardening
-- Unique Outlet.code (nullable unique via partial index)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_outlet_code_unique'
  ) THEN
    CREATE UNIQUE INDEX idx_outlet_code_unique ON "Outlet"(code) WHERE code IS NOT NULL;
  END IF;
END $$;

-- PersonCode.code unique is already enforced by Prisma schema (unique constraint)

-- Session.token unique is enforced by Prisma.

-- FK integrity: AttendantAssignment references existing outlet & code (soft schema uses names). Skipped hard FK to avoid breaking existing data.

-- Helpful indexes
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_aa_code'
  ) THEN
    CREATE INDEX idx_aa_code ON "AttendantAssignment" (code);
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_aa_outlet'
  ) THEN
    CREATE INDEX idx_aa_outlet ON "AttendantAssignment" (outlet);
  END IF;
END $$;

-- Pricebook composite unique exists; add supporting index for reads
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_pricebook_outlet_product'
  ) THEN
    CREATE INDEX idx_pricebook_outlet_product ON "PricebookRow" ("outletName", "productKey");
  END IF;
END $$;

-- Session(attendantId)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_session_attendant'
  ) THEN
    CREATE INDEX idx_session_attendant ON "Session" ("attendantId");
  END IF;
END $$;
