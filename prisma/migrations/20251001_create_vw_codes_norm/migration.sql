-- Helper view for canonicalized codes used by checks and lookups
-- Safe drop: ok if not present
DROP VIEW IF EXISTS "vw_codes_norm";

-- Conservative definition: do not assume optional columns exist on LoginCode
-- Emits stable columns regardless of table shape
CREATE VIEW "vw_codes_norm" AS
SELECT
  lc.id,
  NULL::text                             AS name,
  lc.code                                AS raw_code,
  lower(replace(lc.code, ' ', ''))       AS canon_code,
  regexp_replace(lc.code, '\\D', '', 'g') AS canon_num,
  TRUE                                   AS active
FROM "LoginCode" lc;