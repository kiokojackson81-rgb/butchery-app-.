-- Add verifyPayload JSONB column to AttendantDeposit if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'AttendantDeposit' AND column_name = 'verifyPayload') THEN
        ALTER TABLE "public"."AttendantDeposit" ADD COLUMN "verifyPayload" JSONB;
    END IF;
END$$;
