-- Non-destructive: ensure gen_random_uuid() is available and set a default for WaMessageLog.id
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

ALTER TABLE "WaMessageLog"
  ALTER COLUMN "id" SET DEFAULT gen_random_uuid()::text;
