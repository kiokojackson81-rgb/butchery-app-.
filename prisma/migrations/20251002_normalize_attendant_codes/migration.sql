-- Normalize codes in AttendantAssignment
UPDATE "AttendantAssignment"
SET "code" = lower(regexp_replace(btrim("code"), '\s+', '', 'g'))
WHERE "code" IS NOT NULL
  AND "code" <> lower(regexp_replace(btrim("code"), '\s+', '', 'g'));

-- Merge duplicate AttendantAssignment rows after normalization (keep best outlet, merge product keys)
WITH ranked AS (
  SELECT
    id,
    code,
    outlet,
    "updatedAt",
    "productKeys",
    ROW_NUMBER() OVER (
      PARTITION BY code
      ORDER BY
        CASE WHEN outlet IS NOT NULL AND outlet <> '' THEN 0 ELSE 1 END,
        "updatedAt" DESC NULLS LAST,
        id DESC
    ) AS rn
  FROM "AttendantAssignment"
),
merged AS (
  SELECT
    code,
    COALESCE(
      MAX(outlet) FILTER (WHERE outlet IS NOT NULL AND outlet <> ''),
      MAX(outlet)
    ) AS outlet,
    COALESCE(
      ARRAY_AGG(DISTINCT key) FILTER (WHERE key IS NOT NULL),
      ARRAY[]::text[]
    ) AS keys
  FROM (
    SELECT
      code,
      outlet,
      unnest(COALESCE("productKeys", ARRAY[]::text[])) AS key
    FROM "AttendantAssignment"
  ) AS unnested
  GROUP BY code
)
UPDATE "AttendantAssignment" aa
SET
  outlet = merged.outlet,
  "productKeys" = merged.keys
FROM ranked r
JOIN merged ON merged.code = r.code
WHERE aa.id = r.id
  AND r.rn = 1;

-- Remove duplicate rows (rn > 1) by computing ranking inline in this statement
DELETE FROM "AttendantAssignment" aa
USING (
  SELECT id, rn
  FROM (
    SELECT
      id,
      ROW_NUMBER() OVER (
        PARTITION BY code
        ORDER BY
          CASE WHEN outlet IS NOT NULL AND outlet <> '' THEN 0 ELSE 1 END,
          "updatedAt" DESC NULLS LAST,
          id DESC
      ) AS rn
    FROM "AttendantAssignment"
  ) ranked_inline
  WHERE rn > 1
) dupes
WHERE aa.id = dupes.id;

-- Convert productKeys to jsonb for richer structure
ALTER TABLE "AttendantAssignment"
  ALTER COLUMN "productKeys" TYPE jsonb
  USING to_jsonb(COALESCE("productKeys", ARRAY[]::text[]));

-- Ensure AttendantAssignment indexes cover canonical uniqueness
CREATE UNIQUE INDEX IF NOT EXISTS "AttendantAssignment_code_key"
  ON "AttendantAssignment" ("code");
DROP INDEX IF EXISTS idx_attendantassignment_canon;
DROP INDEX IF EXISTS idx_aa_code_canon;
CREATE UNIQUE INDEX IF NOT EXISTS idx_attendantassignment_canon
  ON "AttendantAssignment" ((lower(regexp_replace("code", '\s+', '', 'g'))));

-- Normalize codes in LoginCode and enforce canonical uniqueness
UPDATE "LoginCode"
SET "code" = lower(regexp_replace(btrim("code"), '\s+', '', 'g'))
WHERE "code" IS NOT NULL
  AND "code" <> lower(regexp_replace(btrim("code"), '\s+', '', 'g'));

WITH ranked_codes AS (
  SELECT
    id,
    code,
    ROW_NUMBER() OVER (
      PARTITION BY code
      ORDER BY "expiresAt" DESC NULLS LAST, "createdAt" DESC NULLS LAST, id DESC
    ) AS rn
  FROM "LoginCode"
)
DELETE FROM "LoginCode"
WHERE id IN (
  SELECT id FROM ranked_codes WHERE rn > 1
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_logincode_canon
  ON "LoginCode" ((lower(regexp_replace("code", '\s+', '', 'g'))));
-- Normalize outlet codes and enforce uniqueness
WITH normalized_outlet AS (
  SELECT
    id,
    NULLIF(lower(regexp_replace(btrim("code"), '\\s+', '', 'g')), '') AS canon_code
  FROM "Outlet"
)
UPDATE "Outlet" o
SET "code" = n.canon_code
FROM normalized_outlet n
WHERE o.id = n.id
  AND (
    (o."code" IS DISTINCT FROM n.canon_code)
    OR (o."code" IS NOT NULL AND n.canon_code IS NULL)
  );

WITH ranked_outlet_codes AS (
  SELECT
    id,
    canon_code,
    ROW_NUMBER() OVER (PARTITION BY canon_code ORDER BY id) AS rn
  FROM (
    SELECT
      id,
      NULLIF(lower(regexp_replace(btrim("code"), '\\s+', '', 'g')), '') AS canon_code
    FROM "Outlet"
  ) AS canonical
  WHERE canon_code IS NOT NULL
)
UPDATE "Outlet" o
SET "code" = NULL
FROM ranked_outlet_codes r
WHERE o.id = r.id
  AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS "Outlet_code_key"
  ON "Outlet" ("code");
