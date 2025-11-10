-- Add 'assistant' to PersonRole enum if it doesn't already exist
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t
                 JOIN pg_enum e ON t.oid = e.enumtypid
                 WHERE t.typname = 'PersonRole' AND e.enumlabel = 'assistant') THEN
    ALTER TYPE "PersonRole" ADD VALUE 'assistant';
  END IF;
END$$;
