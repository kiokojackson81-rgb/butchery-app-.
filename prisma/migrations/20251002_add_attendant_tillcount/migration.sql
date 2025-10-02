-- Create AttendantTillCount table for manual till counts per day/outlet
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM information_schema.tables
        WHERE table_schema = 'public' AND table_name = 'AttendantTillCount'
    ) THEN
        CREATE TABLE "public"."AttendantTillCount" (
            "id" TEXT NOT NULL,
            "date" TEXT NOT NULL,
            "outletName" TEXT NOT NULL,
            "counted" DOUBLE PRECISION NOT NULL DEFAULT 0,

            CONSTRAINT "AttendantTillCount_pkey" PRIMARY KEY ("id")
        );
    END IF;
END $$;

-- Ensure unique constraint on (date, outletName)
DO $$ BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'AttendantTillCount_date_outletName_key'
    ) THEN
        CREATE UNIQUE INDEX "AttendantTillCount_date_outletName_key"
        ON "public"."AttendantTillCount" ("date", "outletName");
    END IF;
END $$;
