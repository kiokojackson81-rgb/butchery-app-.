-- Additive migration: create OutletCode and PaymentStatus enums, Till and Payment tables
BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'outletcode') THEN
    CREATE TYPE public."OutletCode" AS ENUM ('BRIGHT','BARAKA_A','BARAKA_B','BARAKA_C','GENERAL');
  END IF;
END$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'paymentstatus') THEN
    CREATE TYPE public."PaymentStatus" AS ENUM ('PENDING','SUCCESS','FAILED','REVERSED');
  END IF;
END$$;

CREATE TABLE IF NOT EXISTS public."Till" (
  id TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  tillNumber TEXT NOT NULL UNIQUE,
  storeNumber TEXT NOT NULL,
  headOfficeNumber TEXT NOT NULL,
  outletCode public."OutletCode" NOT NULL,
  isActive BOOLEAN DEFAULT true,
  createdAt timestamptz DEFAULT now(),
  updatedAt timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."Payment" (
  id TEXT PRIMARY KEY,
  outletCode public."OutletCode" NOT NULL,
  amount INTEGER NOT NULL,
  msisdn TEXT NOT NULL,
  status public."PaymentStatus" DEFAULT 'PENDING',
  merchantRequestId TEXT,
  checkoutRequestId TEXT UNIQUE,
  mpesaReceipt TEXT,
  businessShortCode TEXT,
  partyB TEXT,
  storeNumber TEXT,
  headOfficeNumber TEXT,
  accountReference TEXT,
  description TEXT,
  rawPayload JSONB,
  createdAt timestamptz DEFAULT now(),
  updatedAt timestamptz DEFAULT now()
);

COMMIT;
