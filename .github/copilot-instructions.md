# AI agent quickstart — butchery-app

Next.js (App Router) app with Prisma/Postgres, WhatsApp Cloud (Meta Graph) and Safaricom Daraja. This file gives AI agents the minimal, project‑specific rules to be productive here.

Boundaries and architecture
- Frontend: `src/app/**` (App Router). Global wrappers in `src/app/layout.tsx`; client storage bridge at `src/app/_bridges/StorageBridge.tsx`.
- Server/API: `src/app/api/**/route.ts` (Node runtime only). Keep third‑party calls and heavy logic on the server.
- DB: Prisma schema `prisma/schema.prisma`. Use the singleton from `src/lib/prisma.ts` (or `@/lib/db`). Never new PrismaClient in routes.
- WhatsApp glue: `src/lib/wa.ts` (send wrapper, honors `WA_DRY_RUN`); WA flows/state under `src/server/wa*` and `src/lib/wa_*`.

Development workflows
- Install: `npm install` (postinstall runs Prisma generate). Typecheck: `npm run -s typecheck`.
- Dev servers: default `npm run dev` (3000). For WA local flows use the workspace task “dev (pwsh, :3002, wa flags)” which sets `PORT=3002 WA_DRY_RUN=true ...`.
- Tests: Playwright at `playwright/*.spec.ts`; set `BASE_URL` to match your dev port (VS Code tasks provided). Vitest unit tests are configured via `vitest.config.ts`.
- DB utilities: see `scripts/` (e.g., `seed-attendant-code.ts`, `seedAssignments.ts`, `db-reset-official.mjs`).

Route and response conventions
- Always include in API routes:
  export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;
- Return `{ ok: boolean, ... }` on both success and failure. Don’t throw to clients; respond `{ ok: false, error }`.
- Prisma usage in routes often uses `(prisma as any).model.method(...)` — keep this pattern when editing similar files to avoid TS noise.

Auth, sessions, and storage
- Attendant sessions are cookie‑based via `src/lib/session.ts` (cookie `bk_sess`, ~24h). Admin is client‑only via `sessionStorage` key `admin_auth` (`components/guards/AdminGuard.tsx`).
- StorageBridge mirrors select local/session keys through `/api/state/bulk-get` and `/api/state/bulk-set`; treat them as server‑backed.
- WA login is link‑only: deep link creation + `/api/wa/auth/finalize` bind/greet (see `src/server/wa_links.ts`, webhook route under `src/app/api/wa/webhook`).

Data model and guards
- Core tables: `Outlet`, `Product`, `PersonCode/PhoneMapping` (WA link), `Attendant`/`LoginCode`, `AttendantScope` + `ScopeProduct`, `PricebookRow`, `Supply*`, `AttendantClosing/Deposit/Expense`, `ActivePeriod`, `Setting`, `AppState`, `WaSession`, `WaMessageLog`.
- Trading period locks: closings/deposits/expenses writes are rejected when the period is LOCKED (see `src/server/trading_period.ts`).

Integrations and jobs
- WhatsApp envs: `WHATSAPP_*` (token, phone id, verify token, app secret). Set `WA_DRY_RUN=true` for local.
- Daraja helpers live in `src/lib/daraja.ts`; keep all calls server‑side.
- Scheduled reminders and cron‑like routes under `src/app/api/wa/jobs/*` (see `vercel.json`).

Examples and pointers
- Session login endpoints: `src/app/api/auth/login/route.ts`, `src/app/api/auth/me/route.ts`.
- Storage bridge server endpoints: `/api/state/bulk-get` and `/api/state/bulk-set`.
- WA flows: `src/app/api/wa/webhook/route.ts`, `src/server/wa_links.ts`, `src/lib/wa_attendant_flow.ts`.

Gotchas and troubleshooting
- Keep API responses consistent and avoid throwing.
- Never expose secrets client‑side; route all WA/Daraja calls through server code.
- Stale Prisma types? `npm run prisma:generate`. Session issues? inspect `bk_sess` and `Session` TTL. Storage not hydrating? check allowed keys in `StorageBridge`.
- Normalize login codes with `utils/normalize-codes` (`canonFull`/`canonNum`) when editing code that handles codes.

Admin data upserts
- For admin CSV/upsert flows, also update mirrored settings keys: `admin_outlets`, `admin_codes`, `attendant_scope`, `admin_pricebook`.

Note: Some GPT/OOC test files remain for legacy verification, but production flows are link‑only WA + server‑side logic. Use the provided VS Code tasks and env flags when running local tests.
