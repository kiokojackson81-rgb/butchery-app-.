-- No-op migration to satisfy Prisma migration history.
-- This directory existed without a migration.sql, which caused P3015 on deploy.
-- Keeping this file ensures migrate deploy can proceed.

-- Safe, idempotent no-op statement
DO $$ BEGIN END $$;