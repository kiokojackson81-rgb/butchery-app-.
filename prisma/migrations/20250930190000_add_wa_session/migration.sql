-- CreateTable WaSession
CREATE TABLE IF NOT EXISTS "public"."WaSession" (
  "id" TEXT NOT NULL,
  "phoneE164" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "code" TEXT,
  "outlet" TEXT,
  "state" TEXT NOT NULL DEFAULT 'IDLE',
  "cursor" JSONB,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WaSession_pkey" PRIMARY KEY ("id")
);

-- Unique index for phone
CREATE UNIQUE INDEX IF NOT EXISTS "WaSession_phoneE164_key" ON "public"."WaSession"("phoneE164");
