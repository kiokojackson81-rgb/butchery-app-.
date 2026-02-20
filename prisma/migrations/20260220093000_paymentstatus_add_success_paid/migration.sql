-- Ensure PaymentStatus enum supports both legacy and current "paid" values.
-- Some DBs were created with PAID (legacy) and others with SUCCESS (current).
DO $$
DECLARE
  type_name text;
BEGIN
  SELECT t.typname INTO type_name
  FROM pg_type t
  JOIN pg_namespace n ON n.oid = t.typnamespace
  WHERE n.nspname = 'public' AND lower(t.typname) = lower('PaymentStatus')
  LIMIT 1;

  -- If the enum doesn't exist yet (DB not migrated), do nothing.
  IF type_name IS NULL THEN
    RETURN;
  END IF;

  -- Add SUCCESS if missing
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public'
      AND lower(t.typname) = lower('PaymentStatus')
      AND e.enumlabel = 'SUCCESS'
  ) THEN
    EXECUTE format('ALTER TYPE %I.%I ADD VALUE %L', 'public', type_name, 'SUCCESS');
  END IF;

  -- Add PAID if missing (legacy alias)
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE n.nspname = 'public'
      AND lower(t.typname) = lower('PaymentStatus')
      AND e.enumlabel = 'PAID'
  ) THEN
    EXECUTE format('ALTER TYPE %I.%I ADD VALUE %L', 'public', type_name, 'PAID');
  END IF;
END$$;

