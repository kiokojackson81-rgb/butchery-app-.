-- Add lock metadata to prevent duplicate supplier submissions per outlet/day/item
ALTER TABLE "SupplyOpeningRow"
  ADD COLUMN "lockedAt" TIMESTAMP(3),
  ADD COLUMN "lockedBy" TEXT;
