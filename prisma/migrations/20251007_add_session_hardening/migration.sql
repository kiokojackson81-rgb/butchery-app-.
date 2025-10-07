-- Add session hardening fields to WaSession
ALTER TABLE "public"."WaSession"
ADD COLUMN IF NOT EXISTS "sessionVersion" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "lastFinalizeAt" TIMESTAMP(3) NULL;