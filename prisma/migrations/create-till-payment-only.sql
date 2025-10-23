-- Create Till and Payment tables only; assumes enums OutletCode and PaymentStatus already exist
CREATE TABLE IF NOT EXISTS public."Till" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  label TEXT NOT NULL,
  "tillNumber" TEXT NOT NULL UNIQUE,
  "storeNumber" TEXT NOT NULL,
  "headOfficeNumber" TEXT NOT NULL,
  "outletCode" public."OutletCode" NOT NULL,
  "isActive" BOOLEAN DEFAULT true,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public."Payment" (
  id TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "outletCode" public."OutletCode" NOT NULL,
  amount INTEGER NOT NULL,
  msisdn TEXT NOT NULL,
  status public."PaymentStatus" DEFAULT 'PENDING',
  "merchantRequestId" TEXT,
  "checkoutRequestId" TEXT UNIQUE,
  "mpesaReceipt" TEXT,
  "businessShortCode" TEXT,
  partyB TEXT,
  "storeNumber" TEXT,
  "headOfficeNumber" TEXT,
  "accountReference" TEXT,
  description TEXT,
  "rawPayload" JSONB,
  "createdAt" timestamptz DEFAULT now(),
  "updatedAt" timestamptz DEFAULT now()
);
