-- Functional indexes for canonical code matching and performance

-- Unique on lower(replace(code,' ','')) ensures no duplicates differing by case/space
CREATE UNIQUE INDEX IF NOT EXISTS personcode_code_full_unique
ON "PersonCode" ((lower(replace(code, ' ', ''))));

-- Digits-only core index to accelerate numeric lookup
CREATE INDEX IF NOT EXISTS personcode_code_digits_idx
ON "PersonCode" ((regexp_replace(code, '\\D', '', 'g')));

-- Optional supporting index for PhoneMapping.code lookups
CREATE INDEX IF NOT EXISTS phonemapping_code_idx ON "PhoneMapping" (code);
