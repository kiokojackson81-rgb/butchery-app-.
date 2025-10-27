-- Minimal, non-destructive migration: ensure AppState exists
CREATE TABLE IF NOT EXISTS "public"."AppState" (
  "key" TEXT NOT NULL,
  "value" JSONB NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppState_pkey" PRIMARY KEY ("key")
);
