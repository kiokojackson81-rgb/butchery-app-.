-- Data-safe ID type change for AttendantAssignment
-- Adjust the template below to your actual source/target types.
-- Our current schema in prisma shows:
-- model AttendantAssignment {
--   id          String   @id @default(uuid()) @db.Uuid
--   code        String   @unique
--   outlet      String
--   productKeys String[] @db.Text
--   updatedAt   DateTime @updatedAt
--   @@map("AttendantAssignment")
-- }
-- If your production DB currently has id as text or integer, use a safe CAST or a new UUID column approach.

BEGIN;

-- Detect column type at runtime is not trivial in a static migration; pick one block and keep it.
-- A) TEXT -> UUID (values are UUID-like strings)
-- If your AttendantAssignment.id is text and contains UUID strings, keep this block and remove others.
-- To verify before applying in prod:
-- SELECT id FROM "AttendantAssignment" WHERE id !~ '^[0-9a-fA-F-]{36}$' LIMIT 1;

-- Drop referencing FKs first if any (none expected in this schema). Example placeholder:
-- ALTER TABLE "SomeChild" DROP CONSTRAINT IF EXISTS "SomeChild_attendantAssignmentId_fkey";

-- Change type with cast
ALTER TABLE "AttendantAssignment"
  ALTER COLUMN "id" TYPE uuid USING "id"::uuid;

-- Recreate PK (ensure correct)
ALTER TABLE "AttendantAssignment"
  DROP CONSTRAINT IF EXISTS "AttendantAssignment_pkey",
  ADD  CONSTRAINT "AttendantAssignment_pkey" PRIMARY KEY ("id");

-- Recreate dropped FKs if any (none by default)
-- ALTER TABLE "SomeChild"
--   ADD CONSTRAINT "SomeChild_attendantAssignmentId_fkey"
--   FOREIGN KEY ("attendantAssignmentId") REFERENCES "AttendantAssignment"("id") ON DELETE CASCADE;

COMMIT;
