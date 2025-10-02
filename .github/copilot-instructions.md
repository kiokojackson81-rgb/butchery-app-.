# AI agent quickstart for this repo

This project is a Next.js (App Router) app with a Prisma/Postgres backend and WhatsApp/Daraja integrations. Use these notes to work productively and avoid footguns.

## Architecture and boundaries
- Frontend: `src/app/**` (App Router). Pages under:
  - `/admin` (sessionStorage-gated via `AdminGuard`), `/attendant`, `/supervisor`, `/supplier`.
  - Global wrappers: `src/app/layout.tsx` mounts `StorageBridge` and `ErrorBoundary`.
- API routes: `src/app/api/**/route.ts` are server actions (runtime: nodejs). Persisted services live here.
- Database: Prisma schema in `prisma/schema.prisma`. Use the singleton client from `src/lib/prisma.ts` (re-exported via `src/lib/db.ts`). Avoid creating new PrismaClient instances.
- Auth/session (attendant): Cookie-based session stored in table `Session` with helper APIs in `src/lib/session.ts`. Admin auth is client-only (sessionStorage flag) via `components/guards/AdminGuard.tsx`.
- LocalStorage mirroring: `StorageBridge` selectively mirrors local/session storage keys to DB via `/api/state/bulk-get|bulk-set` and table `AppState`. Treat these keys as server-backed.
- External integrations:
  - WhatsApp via Meta Graph API: `src/lib/wa.ts` (env-driven). Server-only usage.
  - Safaricom Daraja: `src/lib/daraja.ts`.

## Data model highlights (Prisma)
- Core entities: `Outlet`, `Product`, `Attendant`, `Session`, `LoginCode`, `AttendantScope`, `PricebookRow`, `Supply*`, `AttendantClosing/Deposit/Expense`, `ActivePeriod`, `Setting`, `AppState`, `ReviewItem`, `PhoneMapping`.
- Roles are enum `PersonRole` (attendant|supervisor|supplier). Deposits track `DepositStatus`.
- Use `src/lib/prisma.ts` for DB ops; prefer `(prisma as any).model.method(...)` to avoid stale type friction in API routes.

## Conventions and patterns
- API route defaults: include
  - `export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;`
  - Return JSON with `{ ok: boolean, ... }` and avoid throwing; on error return `{ ok: false, error }`.
- Sessions: use `createSession/getSession/destroySession` from `src/lib/session.ts`. Cookies set under `bk_sess` with lax/HttpOnly; don’t hand-roll cookie headers.
- Admin auth: client-side only. Check `sessionStorage.getItem("admin_auth") === "true"`; redirect to `/admin/login` if absent. Use `AdminLogoutButton` to clear only admin flags.
- StorageBridge: only persist whitelisted keys. Read/write localStorage/sessionStorage normally—bridge will sync via `/api/state/*`. Don’t fetch the same data again if a key already mirrors DB.
- WhatsApp envs: prefer `src/lib/wa.ts` and supply `WHATSAPP_*` rather than hardcoding endpoints.
- Prisma on Vercel/Edge: all DB code must run on Node runtime; never mark Prisma routes as `edge`.

## Developer workflows
- Install and generate Prisma client: `npm install` triggers `postinstall` → `prisma generate`.
- Dev server: `npm run dev` (Next.js on :3000).
- Typecheck: `npm run typecheck` (Next config ignores build-time TS errors, but keep it clean locally).
- Build: `npm run build` (Next build; ESLint/TS errors don’t block due to `next.config.ts`). After build, `prisma migrate deploy` runs via `postbuild`.
- DB tasks (scripts/): `db:check`, seed/update assignments (`scripts/seedAssignments.mjs`), etc.

## Examples to follow
- Session login flow: `src/app/api/auth/login/route.ts` calls `createSession` and sets cookie; `src/app/api/auth/me/route.ts` reads via `getSession`.
- LocalStorage DB sync: `src/app/_bridges/StorageBridge.tsx` + `/api/state/bulk-get|bulk-set` in `src/app/api/state/...` and table `AppState`.
- Settings KV: `src/app/api/settings/[key]/route.ts` paired with `src/lib/settingsBridge.ts` and `utils/safeStorage.ts`.
- Guards: `components/guards/AdminGuard.tsx`, `components/guards/AttendantGuard.tsx` show redirect patterns.

## When adding code
- New API routes: put under `src/app/api/.../route.ts`; add the Node runtime flags; use Prisma singleton and return `{ ok }` shapes. If reading/writing mirrored client keys, go through `/api/state/*`.
- New server utilities: place in `src/lib/**` and keep network calls behind small wrappers like `wa.ts`/`chatrace.ts`.
- Do not create another Prisma client. Import from `@/lib/prisma` or `@/lib/db`.
- Avoid leaking secrets to the client. Only call WA/Daraja from server code.

## Troubleshooting
- Stale Prisma types? Cast `prisma as any` in API routes; re-run `npm run prisma:generate` locally.
- Session not recognized? Check `bk_sess` cookie and `Session` table TTL (24h in `lib/session.ts`).
- Storage not hydrating? Verify `/api/state/bulk-get` returns values and keys are whitelisted in `StorageBridge`.

## Quick reminders (pin me)
- Do not modify any UI files or visual components.
- When writing/reading login codes: always normalize with `canonFull` and optionally `canonNum`.
- Match by full canonical first; if not found, match by numeric core only when unique; otherwise respond 409 for ambiguity.
- On Admin save: upsert relational tables (Outlet, PersonCode, LoginCode, role tables) and update Setting mirrors: `admin_outlets`, `admin_codes`, `attendant_scope`, `admin_pricebook`.
- Keep all API responses `{ ok: boolean, ... }`. Never throw to the client.
- Use functional indexes; do not change schema concepts.
