-- Lowercase codes in primary code tables (guarded for missing tables)

DO $$ BEGIN
  BEGIN
    UPDATE "PersonCode" SET code = lower(code);
  EXCEPTION WHEN undefined_table THEN END;
END $$;

DO $$ BEGIN
  BEGIN
    UPDATE "LoginCode" SET code = lower(code);
  EXCEPTION WHEN undefined_table THEN END;
END $$;

DO $$ BEGIN
  BEGIN
    UPDATE "Attendant" SET "loginCode" = lower("loginCode");
  EXCEPTION WHEN undefined_table THEN END;
END $$;

-- Optional tables (may not exist in this schema)
DO $$ BEGIN
  BEGIN
    UPDATE "Supervisor" SET code = lower(code);
  EXCEPTION WHEN undefined_table THEN END;
END $$;

DO $$ BEGIN
  BEGIN
    UPDATE "Supplier" SET code = lower(code);
  EXCEPTION WHEN undefined_table THEN END;
END $$;

-- Resolve duplicates differing only by case/spacing for LoginCode by FULL canonical
-- Keep the earliest id; delete subsequent duplicates
DO $$ BEGIN
  BEGIN
    WITH pc AS (
      SELECT id, code,
             lower(regexp_replace(code, '\\s+', '', 'g')) AS full,
             row_number() OVER (PARTITION BY lower(regexp_replace(code, '\\s+', '', 'g')) ORDER BY id) AS rn
      FROM "LoginCode"
    )
    DELETE FROM "LoginCode" lc
    USING pc
    WHERE lc.id = pc.id AND pc.rn > 1;
  EXCEPTION WHEN undefined_table THEN END;
END $$;

-- To repeat for other tables, change table name and rerun the CTE block.-- Lowercase codes in primary code tables (where they exist)
DO $$ BEGIN
  EXECUTE 'UPDATE "PersonCode" SET code = lower(code)';
EXCEPTION WHEN undefined_table THEN END $$;

DO $$ BEGIN
  EXECUTE 'UPDATE "LoginCode" SET code = lower(code)';
EXCEPTION WHEN undefined_table THEN END $$;

DO $$ BEGIN
  -- Attendant.loginCode is the field we manage here
  EXECUTE 'UPDATE "Attendant" SET "loginCode" = lower("loginCode") WHERE "loginCode" IS NOT NULL';
EXCEPTION WHEN undefined_table THEN END $$;

DO $$ BEGIN
  EXECUTE 'UPDATE "Supervisor" SET code = lower(code)';
EXCEPTION WHEN undefined_table THEN END $$;

DO $$ BEGIN
  EXECUTE 'UPDATE "Supplier" SET code = lower(code)';
EXCEPTION WHEN undefined_table THEN END $$;

-- Resolve duplicates in LoginCode differing only by case/spacing using canonical full
DO $$ BEGIN
  WITH pc AS (
    SELECT id, code,
           lower(regexp_replace(code, '\\s+', '', 'g')) AS full,
           row_number() OVER (PARTITION BY lower(regexp_replace(code, '\\s+', '', 'g')) ORDER BY id) AS rn
    FROM "LoginCode"
  )
  DELETE FROM "LoginCode" lc
  USING pc
  WHERE lc.id = pc.id AND pc.rn > 1;
EXCEPTION WHEN undefined_table THEN END $$;

-- Repeat the CTE above for other tables if needed, replacing table name accordingly.
