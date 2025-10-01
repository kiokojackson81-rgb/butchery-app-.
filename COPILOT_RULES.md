# 🔐 BarakaOps – Code Matching Rules (FINAL)

This document instructs contributors and AI assistants how to implement and keep the login behavior consistent across UI, API, and DB.

## Goals

- Case-insensitive: COLLO A, collo a, CoLlO A are the same.
- Whitespace-insensitive: user can add spaces anywhere.
- Number-core match: if the user input contains the right digits, login passes (even if letters differ or are missing), provided the match is unique.
- Persist everything to DB (never only localStorage).
- Outlets saved in Admin remain after reload and map correctly to Attendant / Supervisor / Supplier / Admin.

## 1) Canonical normalization (use everywhere)

Create three canonical forms:

```ts
function canonFull(raw: string) {
  return raw.trim().toLowerCase().replace(/\s+/g, "");          // “collo a” → “colloa”
}
function canonNum(raw: string) {
  return (raw.match(/\d+/g) || []).join("");                     // “ab 123 45 xy” → “12345”
}
function canonLite(raw: string) {
  return raw.replace(/\s+/g, "");                                // keep case; rarely used
}
```

- UI input: normalize with canonFull + canonNum.
- Server/API: always compute both `full = canonFull(input)` and `num = canonNum(input)` before validation.

## 2) Database invariants (Prisma/Postgres)

Do not change your domain concept. Add functional indexes so lookups are fast and unambiguous without refactoring your schema.

### 2.1 Functional indexes (Postgres)

```sql
-- PersonCode: full (lower, no spaces) and numeric core
CREATE UNIQUE INDEX IF NOT EXISTS personcode_code_full_uidx
  ON "PersonCode" ( lower(regexp_replace(code, '\s+', '', 'g')) );

CREATE INDEX IF NOT EXISTS personcode_code_num_idx
  ON "PersonCode" ( regexp_replace(code, '\\D', '', 'g') );

-- Attendant/LoginCode mirrors
CREATE UNIQUE INDEX IF NOT EXISTS login_code_full_uidx
  ON "LoginCode" ( lower(regexp_replace(code, '\s+', '', 'g')) );

CREATE INDEX IF NOT EXISTS login_code_num_idx
  ON "LoginCode" ( regexp_replace(code, '\\D', '', 'g') );

CREATE UNIQUE INDEX IF NOT EXISTS attendant_code_full_uidx
  ON "Attendant" ( lower(regexp_replace(code, '\s+', '', 'g')) );

CREATE INDEX IF NOT EXISTS attendant_code_num_idx
  ON "Attendant" ( regexp_replace(code, '\\D', '', 'g') );
```

If you have existing duplicates that differ only by case/spacing, fix them first (see §5 collisions).

## 3) API login rule (applies to Attendant, Supervisor, Supplier)

Algorithm (exactly this):

Compute:

```ts
const full = canonFull(input);   // lower+no spaces
const num  = canonNum(input);    // digits only (may be "")
```

Query in this order (same transaction/handler):

Full match (fast, unique by index):

```ts
const byFull = await prisma.loginCode.findUnique({
  where: { code: full }, // we’ll show how below without a virtual column
});
```

In Prisma, because we used functional indexes, use findFirst with filters:

```ts
const byFull = await prisma.loginCode.findFirst({
  where: { code: { mode: 'insensitive', equals: input.replace(/\s+/g,'') } }
});
```

(If using raw SQL, prefer LOWER(REPLACE(code,' ','')) = $1.)

If not found and num !== "", do a numeric-core search:

```ts
const byNum = await prisma.$queryRaw<
  { code: string }[]
>`SELECT code FROM "LoginCode"
  WHERE regexp_replace(code, '\\D', '', 'g') = ${num}
  LIMIT 2`;
```

- 0 rows → reject.
- 1 row → accept (resolve the actual row; then continue).
- 2+ rows → reject with “code not specific; multiple matches”. (See §5.)

Once a code row is chosen, resolve role/outlet via your existing joins:

- Attendant → Attendant (must be active=true, has outlet)
- Supervisor → your Supervisor/PersonCode.role='supervisor'
- Supplier → your Supplier/PersonCode.role='supplier'

Set session cookie and return `{ ok:true, role, outlet }`.

Example TS (Attendant login)

```ts
// /api/auth/login
import { prisma } from '@/lib/prisma';

function canonFull(s:string){ return s.trim().toLowerCase().replace(/\s+/g,''); }
function canonNum(s:string){ return (s.match(/\d+/g)||[]).join(''); }

export async function POST(req: Request) {
  const { loginCode: raw } = await req.json();
  const full = canonFull(String(raw||''));
  const num  = canonNum(String(raw||''));
  if (!full && !num) return Response.json({ ok:false, error:'Invalid code' }, { status:400 });

  // 1) By FULL (case/space-insensitive)
  let row = await prisma.$queryRawUnsafe(
    SELECT * FROM "LoginCode"
    WHERE LOWER(REPLACE(code,' ',''))
          = ${full}
    LIMIT 1
  `).then(r=>r[0]);

  // 2) By NUMERIC core (only if not found)
  if (!row && num) {
  const matches = await prisma.$queryRawUnsafe(
      SELECT * FROM "LoginCode"
      WHERE regexp_replace(code, '\\D', '', 'g') = ${num}
      LIMIT 3
    `);
    if (matches.length === 1) row = matches[0];
    else if (matches.length > 1) {
      return Response.json({ ok:false, error:'Ambiguous code; multiple matches' }, { status:409 });
    }
  }

  if (!row || row.active === false) {
    return Response.json({ ok:false, error:'Login failed' }, { status:401 });
  }

  // Resolve attendant
  const att = await prisma.attendant.findFirst({
    where: {
      OR: [
        { code: { equals: row.code, mode: 'insensitive' } },
        // safeguard for spacing differences:
        { code: { equals: row.code.replace(/\s+/g,''), mode: 'insensitive' } },
      ],
      active: true
    }
  });
  if (!att?.outlet) {
    return Response.json({ ok:false, error:'Code not assigned to outlet' }, { status:422 });
  }

  // set cookie (bk_sess) using your existing session helper
  // await setSession({ role:'attendant', code: row.code, outlet: att.outlet });

  return Response.json({ ok:true, role:'attendant', code: row.code, outlet: att.outlet });
}
```

Use the same matching strategy for `/api/auth/validate-code`, `/api/auth/supervisor`, `/api/auth/supplier`.

## 4) Admin “Save” must persist to DB (survive reload)

When Admin saves:

- Outlets → upsert `Outlet` rows and write `Setting('admin_outlets')`.
- People & Codes → upsert `PersonCode` + `LoginCode` + role rows (Attendant/Supervisor/Supplier) and write `Setting('admin_codes')`.
- Assignments (scope) → upsert `AttendantAssignment(code → outlet, productKeys[])` and write `Setting('attendant_scope')`.
- Pricebook → write `Setting('admin_pricebook')` (+ any relational rows you keep).

After Admin “Save”, immediately re-query DB (not localStorage) to confirm:

```sql
SELECT name, code, active FROM "Outlet" ORDER BY name;
SELECT code, active FROM "LoginCode" ORDER BY code;
SELECT code, outlet, active FROM "Attendant" ORDER BY code;
SELECT key FROM "Setting"
WHERE key IN ('admin_outlets','admin_codes','attendant_scope','admin_pricebook');
```

## 5) Numeric-core collisions (avoid ambiguous logins)

Because number-core login accepts any input whose digits match, two different codes must not share the same digits. Enforce this at Admin save time:

- When saving a code, compute `num = canonNum(code)`.
- Reject save if another active code (any role) has the same `num`.
- If you must allow it, login will error with 409 Ambiguous when a user types only the digits.

Optional guard (at persistence layer):

> Add a partial unique index on `(regexp_replace(code,'\D','','g')) WHERE active=true` for each of your main code tables, if you want to hard-enforce uniqueness by digits.

## 6) Frontend behavior guarantees

Attendant / Supervisor / Supplier login forms

- Accept any mixture of case and spaces.
- Allow numeric-only entries (e.g., user types just “12345”).
- Post the raw input; server owns normalization and matching logic.

Attendant dashboard outlet resolution

- After `/api/auth/me`, resolve outlet via DB (not just local mirror).
- If Admin mirrors are empty, hydrate from DB before reading local.

## 7) WhatsApp link/login helpers (if used)

- When building links or rows that include codes, always display the pretty version, but store and compare with `canonFull/canonNum`.
- Keep your WA interactive row title ≤ 24 chars (API limit).

## 8) QA checklist (must pass before merging)

- colloa, COLLO A, collo A all log in the same account.
- Typing just digits (e.g., 12345) logs in if and only if one active code has digits 12345.
- Admin-saved outlets/codes remain after full reload (verified in DB).
- Supervisor/Supplier/Attendant resolve correct outlet & role from DB.
- SELECT checks in §4 show expected rows.
- Ambiguous number-core (two active codes share the same digits) yields a clear 409 error or is prevented at save time.

---

Notes for Copilot/GPT

- Never rely solely on localStorage for persistence. DB is the source of truth; local mirrors are a cache.
- When touching login/auth endpoints, always include both full and num matching as described.
- Prefer Postgres functional indexes over schema rewrites to keep design unchanged while guaranteeing performance.
- Keep responses `{ ok: boolean, ... }` (no throws to the client).

If you want, I can also give you:

- a small migration script to create the indexes above in your Prisma migration folder, and
- a unit test (Vitest) that proves all the matching cases pass.
