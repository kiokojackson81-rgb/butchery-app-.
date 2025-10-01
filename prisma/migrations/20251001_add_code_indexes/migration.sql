-- Functional indexes to support case/space-insensitive and digits-core lookups
-- Note: Some tables may not exist in this schema; keep IF NOT EXISTS on indexes and wrap in DO blocks when needed.

-- LoginCode.code full canonical (lower + strip spaces)
DO $$ BEGIN
  IF to_regclass('public.login_code_full_uidx') IS NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX login_code_full_uidx ON "LoginCode" ( lower(regexp_replace(code, ''\s+'', '''', ''g'')) )';
  END IF;
EXCEPTION WHEN undefined_table THEN
  -- Table not present; skip
END $$;

-- LoginCode.code digits-only index
DO $$ BEGIN
  IF to_regclass('public.login_code_num_idx') IS NULL THEN
    EXECUTE 'CREATE INDEX login_code_num_idx ON "LoginCode" ( regexp_replace(code, ''\D'', '''', ''g'') )';
  END IF;
EXCEPTION WHEN undefined_table THEN
END $$;

-- PersonCode.code
DO $$ BEGIN
  IF to_regclass('public.personcode_code_full_uidx') IS NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX personcode_code_full_uidx ON "PersonCode" ( lower(regexp_replace(code, ''\s+'', '''', ''g'')) )';
  END IF;
EXCEPTION WHEN undefined_table THEN
END $$;

DO $$ BEGIN
  IF to_regclass('public.personcode_code_num_idx') IS NULL THEN
    EXECUTE 'CREATE INDEX personcode_code_num_idx ON "PersonCode" ( regexp_replace(code, ''\D'', '''', ''g'') )';
  END IF;
EXCEPTION WHEN undefined_table THEN
END $$;

-- Attendant.loginCode (present in current schema)
DO $$ BEGIN
  IF to_regclass('public.attendant_login_full_uidx') IS NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX attendant_login_full_uidx ON "Attendant" ( lower(regexp_replace("loginCode", ''\s+'', '''', ''g'')) )';
  END IF;
EXCEPTION WHEN undefined_table THEN
END $$;

DO $$ BEGIN
  IF to_regclass('public.attendant_login_num_idx') IS NULL THEN
    EXECUTE 'CREATE INDEX attendant_login_num_idx ON "Attendant" ( regexp_replace("loginCode", ''\D'', '''', ''g'') )';
  END IF;
EXCEPTION WHEN undefined_table THEN
END $$;

-- Supervisor.code (if exists)
DO $$ BEGIN
  IF to_regclass('public.supervisor_code_full_uidx') IS NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX supervisor_code_full_uidx ON "Supervisor" ( lower(regexp_replace(code, ''\s+'', '''', ''g'')) )';
  END IF;
EXCEPTION WHEN undefined_table THEN
END $$;

DO $$ BEGIN
  IF to_regclass('public.supervisor_code_num_idx') IS NULL THEN
    EXECUTE 'CREATE INDEX supervisor_code_num_idx ON "Supervisor" ( regexp_replace(code, ''\D'', '''', ''g'') )';
  END IF;
EXCEPTION WHEN undefined_table THEN
END $$;

-- Supplier.code (if exists)
DO $$ BEGIN
  IF to_regclass('public.supplier_code_full_uidx') IS NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX supplier_code_full_uidx ON "Supplier" ( lower(regexp_replace(code, ''\s+'', '''', ''g'')) )';
  END IF;
EXCEPTION WHEN undefined_table THEN
END $$;

DO $$ BEGIN
  IF to_regclass('public.supplier_code_num_idx') IS NULL THEN
    EXECUTE 'CREATE INDEX supplier_code_num_idx ON "Supplier" ( regexp_replace(code, ''\D'', '''', ''g'') )';
  END IF;
EXCEPTION WHEN undefined_table THEN
END $$;
