-- Make vw_codes_norm view and functional indexes permanent

-- Drop the view if it exists
DROP VIEW IF EXISTS public.vw_codes_norm;

-- Create the view (paste your exact CREATE VIEW statement below)
CREATE VIEW "vw_codes_norm" AS
SELECT
  lc.id,
  NULL::text                             AS name,
  lc.code                                AS raw_code,
  lower(replace(lc.code, ' ', ''))       AS canon_code,
  regexp_replace(lc.code, '\\D', '', 'g') AS canon_num,
  TRUE                                   AS active
FROM "LoginCode" lc;

-- Create functional indexes
CREATE UNIQUE INDEX IF NOT EXISTS idx_logincode_canon ON "LoginCode" ((lower(replace(code,' ',''))));
CREATE INDEX IF NOT EXISTS idx_aa_code_canon ON "AttendantAssignment" ((lower(replace(code,' ',''))));
