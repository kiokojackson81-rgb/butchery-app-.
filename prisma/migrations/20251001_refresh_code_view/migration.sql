-- Refresh vw_codes_norm view to surface all code sources in a single canonicalized table
DROP VIEW IF EXISTS "vw_codes_norm";

CREATE VIEW "vw_codes_norm" AS
SELECT
  'login_code'::text               AS source,
  lc.id                            AS record_id,
  lc.code                          AS raw_code,
  lower(replace(lc.code, ' ', '')) AS canon_code,
  regexp_replace(lc.code, '\D', '', 'g') AS canon_num,
  TRUE                             AS active
FROM "LoginCode" lc
UNION ALL
SELECT
  'person_code'::text              AS source,
  pc.id                            AS record_id,
  pc.code                          AS raw_code,
  lower(replace(pc.code, ' ', '')) AS canon_code,
  regexp_replace(pc.code, '\D', '', 'g') AS canon_num,
  pc.active                        AS active
FROM "PersonCode" pc
UNION ALL
SELECT
  'attendant_assignment'::text     AS source,
  aa.id                            AS record_id,
  aa.code                          AS raw_code,
  lower(replace(aa.code, ' ', '')) AS canon_code,
  regexp_replace(aa.code, '\D', '', 'g') AS canon_num,
  TRUE                             AS active
FROM "AttendantAssignment" aa;

-- Recreate functional indexes on canonical code casing/spacing
DROP INDEX IF EXISTS idx_logincode_canon;
DROP INDEX IF EXISTS idx_personcode_canon;
DROP INDEX IF EXISTS idx_attendantassignment_canon;
DROP INDEX IF EXISTS idx_aa_code_canon;

CREATE UNIQUE INDEX IF NOT EXISTS idx_logincode_canon ON "LoginCode" ((lower(replace(code, ' ', ''))));
CREATE UNIQUE INDEX IF NOT EXISTS idx_personcode_canon ON "PersonCode" ((lower(replace(code, ' ', ''))));
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendantassignment_canon ON "AttendantAssignment" ((lower(replace(code, ' ', ''))));

-- Helpful helpers for fast digit-core lookups (non-unique by design)
CREATE INDEX IF NOT EXISTS idx_logincode_canon_num ON "LoginCode" ((regexp_replace(code, '\D', '', 'g')));
CREATE INDEX IF NOT EXISTS idx_personcode_canon_num ON "PersonCode" ((regexp_replace(code, '\D', '', 'g')));
CREATE INDEX IF NOT EXISTS idx_attendantassignment_canon_num ON "AttendantAssignment" ((regexp_replace(code, '\D', '', 'g')));
