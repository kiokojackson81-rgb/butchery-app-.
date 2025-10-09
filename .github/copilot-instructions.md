# AI agent quickstart — butchery-app

This repository is a Next.js (App Router) application with a Prisma/Postgres backend and integrations to WhatsApp (Meta Graph) and Safaricom Daraja. The goal: give AI coding agents concise, actionable rules that match this project's conventions.

Key boundaries
- Frontend: `src/app/**` (App Router). Global wrappers and bridges live in `src/app/layout.tsx` and `src/app/_bridges/*` (see `StorageBridge.tsx`).
- Server/API: `src/app/api/**/route.ts` — these are Node server actions (add runtime flags). Keep heavy logic and third‑party network calls on the server.
- Database: Prisma schema at `prisma/schema.prisma`. Use the singleton Prisma client in `src/lib/prisma.ts` (or re-export `src/lib/db.ts`). Never instantiate new PrismaClient in API routes.

Developer workflows (concrete)
- Install and generate Prisma: run `npm install` (postinstall runs `prisma generate`).
- Dev server: `npm run dev` (port 3000). For WA/GPT local testing use the alternate task `npm run dev:3002` or the workspace task that sets WA_* env flags (see VS Code tasks). Example envs often used in CI/local runs: `WA_DRY_RUN=true WA_GPT_ONLY=true WA_AI_ENABLED=true WA_INTERACTIVE_ENABLED=true WA_TABS_ENABLED=true`.
- Playwright tests: configured in `playwright.config.ts`. Use `BASE_URL` env when running tests against a custom port.
- DB scripts: review `scripts/` for seeding and maintenance (`seedAssignments.ts`, `seed-login-codes.ts`, `db-reset-official.mjs`).

Conventions and important patterns
- API responses: consistently return JSON shaped { ok: boolean, ... }. Do not throw errors to the client; return `{ ok: false, error }` instead.
- API route headers (include in new routes):
  export const runtime = "nodejs";
  export const dynamic = "force-dynamic";
  export const revalidate = 0;
- Sessions: attendant sessions are cookie based and managed via `src/lib/session.ts`. Cookie name: `bk_sess` (24h TTL). Admin auth is client-only and stored in sessionStorage (`admin_auth`). See `components/guards/AdminGuard.tsx`.
- Local storage mirroring: `src/app/_bridges/StorageBridge.tsx` mirrors a whitelist of local/session keys to the DB through `/api/state/bulk-get` and `/api/state/bulk-set`. Treat those values as server-backed and prefer the API endpoints for cross-process reads/writes.
- Prisma usage: prefer `import prisma from '@/lib/prisma'` (or `@/lib/db`). In API routes you may see `(prisma as any).model.method(...)` — keep this pattern when editing similar routes to avoid TS friction.
- Secrets & integrations: call WhatsApp (`src/lib/wa.ts`) and Daraja (`src/lib/daraja.ts`) from server-side code only. Do not leak tokens to the client.

Data model highlights (where to look)
- Core tables: `Outlet`, `Product`, `Attendant`, `Session`, `LoginCode`, `AttendantScope`, `PricebookRow`, `Supply*`, `AttendantClosing/Deposit/Expense`, `ActivePeriod`, `Setting`, `AppState` (see `prisma/schema.prisma`).

When adding code or routes
- Place API routes under `src/app/api/.../route.ts` and follow the response and runtime patterns above.
- Put shared server utilities in `src/lib/**`.
- If manipulating client-mirrored keys, go through `/api/state/*` endpoints rather than directly updating localStorage on other pages.
- For Admin CSV/upsert flows, update the related Setting mirrors: `admin_outlets`, `admin_codes`, `attendant_scope`, `admin_pricebook`.

Examples (quick pointers)
- Session login: `src/app/api/auth/login/route.ts` and `src/app/api/auth/me/route.ts`.
- StorageBridge: `src/app/_bridges/StorageBridge.tsx` and server endpoints `src/app/api/state/bulk-get/route.ts`.
- WA wrapper: `src/lib/wa.ts` (look for env var usage: WHATSAPP_*)

Troubleshooting notes
- Stale Prisma types: run `npm run prisma:generate` after installing.
- Session issues: inspect `bk_sess` cookie and `Session` table TTL in `src/lib/session.ts`.
- Storage not hydrating: ensure keys are whitelisted inside `StorageBridge` and `/api/state/bulk-get` returns expected values.

Quick reminders
- Do not change UI/visual components unless the task explicitly requires it.
- Always normalize login codes using helpers in `utils/normalize-codes` (look for `canonFull`/`canonNum`).
- Keep API responses consistent: `{ ok: boolean, ... }`.

If anything here is unclear or you want more examples (playwright commands, exact envs used in CI, or common PR cleanup steps), tell me which section to expand.
