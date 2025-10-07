-- Add missing `type` column to WaMessageLog to match Prisma schema
ALTER TABLE "public"."WaMessageLog"
ADD COLUMN IF NOT EXISTS "type" TEXT;
