# Butchery App — Architecture, Routes, and Codes Map

This document inventories the app’s architecture, all user-facing pages, API routes, data models, environment variables, and utility scripts. Use it to navigate the codebase quickly and spot inconsistencies.

## Overview

- Framework: Next.js (App Router)
- Backend: API routes (Node.js runtime) with Prisma/Postgres
- Integrations: WhatsApp (Meta Graph API), Safaricom Daraja C2B
- Auth: Cookie-based attendant sessions; admin gated client-side; WhatsApp chat state machine

## Layout and Conventions

- App Router roots: `src/app/**`
- API routes: `src/app/api/**/route.ts` (Node runtime; dynamic; revalidate 0)
- Prisma singleton: `src/lib/prisma.ts` (or `src/lib/db.ts`)
- Sessions: `src/lib/session.ts` (cookie `bk_sess`)
- WhatsApp helpers: `src/lib/wa.ts`, menus/flows under `src/lib/**` and `src/server/**`
- Storage mirroring: `StorageBridge` + `/api/state/*` + `AppState` table

## Directory Highlights

- `src/app/layout.tsx`: Global layout mounting `StorageBridge` and `ErrorBoundary`
- `src/app/admin/**`: Admin UI (client-gated by `AdminGuard` via sessionStorage)
- `src/app/api/**`: Server actions and webhooks
- `src/lib/**`: DB client, session, external API wrappers, flows
- `src/server/**`: Server-side domain logic (closings, deposits, finance, supply, WA)
- `prisma/schema.prisma`: Database models and enums

## Pages (App Router)

- `/` → `src/app/page.tsx`
- `/login` → `src/app/login/page.tsx`
- Legal: `/privacy`, `/terms`, `/cookies`
  - `src/app/privacy/page.tsx`, `src/app/terms/page.tsx`, `src/app/cookies/page.tsx`
- Attendant:
  - `/attendant` → `src/app/attendant/page.tsx`
  - `/attendant/dashboard` → `src/app/attendant/dashboard/page.tsx`
- Supervisor:
  - `/supervisor` → `src/app/supervisor/page.tsx`
  - `/supervisor/dashboard` → `src/app/supervisor/dashboard/page.tsx`
- Supplier:
  - `/supplier` → `src/app/supplier/page.tsx`
  - `/supplier/dashboard` → `src/app/supplier/dashboard/page.tsx`
- Admin (client-only gate via `AdminGuard`):
  - `/admin` → `src/app/admin/page.tsx`
  - `/admin/login` → `src/app/admin/login/page.tsx`
  - `/admin/staff` → `src/app/admin/staff/page.tsx`
  - `/admin/reports` → `src/app/admin/reports/page.tsx`
  - `/admin/wa-test` → `src/app/admin/wa-test/page.tsx`

Notes
- Admin auth uses `sessionStorage.getItem("admin_auth") === "true"`; see `components/guards/AdminGuard.tsx`.

## API Routes (server)

Grouped by feature. Each route lives at `src/app/api/.../route.ts`.

Auth and Sessions
- POST `/api/auth/validate-code` — Validate login code (web)
- POST `/api/auth/login` — Create attendant session and set cookie
- GET `/api/auth/me` — Read attendant session
- POST `/api/auth/attendant` — Attendant login endpoint (legacy/alt)
- POST `/api/auth/supervisor` — Supervisor login endpoint
- POST `/api/auth/supplier` — Supplier login endpoint
- POST `/api/auth/code/login` — Code-based login (legacy)

WhatsApp (WA)
- POST `/api/wa/webhook` — WhatsApp inbound webhook (Meta Graph)
- POST `/api/wa/send` — Send WhatsApp message (server-only)
- POST `/api/wa/portal-login` — Assist portal login binding via WA
- POST `/api/wa/auth/finalize` — Finalize link-based login from the web (bind + greet)
- POST `/api/wa/jobs/expire-sessions` — Cron to expire idle WA sessions
- POST `/api/wa/jobs/closing-prompt` — Cron to prompt end-of-day closings
 - GET  `/api/wa/jobs/attendant-closing-reminder` — 21:00 EAT attendant reminder (Utility template)
 - GET  `/api/wa/jobs/supervisor-review-reminder` — 22:00 EAT supervisor reminder (Utility template)
 - GET  `/api/wa/jobs/supplier-opening-reminder` — 06:30 EAT supplier reminder (Utility template)

Link-only login flow
- POST `/api/flow/login-link` — Generate per-phone WA deep link and LINK <nonce> text

Legacy Chatrace webhook(s) have been removed in favor of Meta Graph-only integration.

Settings and AppState
- GET/PUT `/api/settings/[key]` — Settings KV (JSON)
- GET `/api/state/get` — Read a mirrored key
- POST `/api/state/set` — Write a mirrored key
- POST `/api/state/bulk-get` — Batch read
- POST `/api/state/bulk-set` — Batch write

Supervisor
- GET `/api/supervisor/summary`
- GET `/api/supervisor/rules`
- GET `/api/supervisor/queue`
- GET `/api/supervisor/reviews`
- POST `/api/supervisor/review`
- POST `/api/supervisor/reviews/[id]/approve`
- POST `/api/supervisor/reviews/[id]/reject`

Supplier
- GET `/api/supplier/products`
- GET `/api/supplier/day`
- POST `/api/supplier/transfer`
- POST `/api/supplier/report`
- POST `/api/supplier/opening-row`
- POST `/api/supplier/request-edit`
- POST `/api/supplier/lock-day`
- POST `/api/supplier/dispute`

Attendant
- POST `/api/attendant/login`
- POST `/api/attendant/closing`
  - Notes: Closing writes are rejected when Trading Period is LOCKED (see server/trading_period.ts).

Cash and Operations
- POST `/api/deposits`
- POST `/api/expenses`
  - Notes: Deposits/Expenses/Till Count writes are rejected when Trading Period is LOCKED.
- GET `/api/metrics/header`
- POST `/api/notify/low-stock`
- POST `/api/payments/till`
- POST `/api/period/start`, GET `/api/period/active`

Outlets
- GET `/api/outlets/[code]`
- POST `/api/outlets/save`

Daraja (M-Pesa C2B)
- POST `/api/daraja/c2b/register`
- POST `/api/daraja/c2b/validate`
- POST `/api/daraja/c2b/confirm`

Admin
- GET `/api/admin/low-stock-thresholds`
- GET `/api/admin/phones`
- POST `/api/admin/phone`
- POST `/api/admin/test-wa-template`
- POST `/api/admin/save-scope-pricebook`
- POST `/api/admin/scope`
- POST `/api/admin/bootstrap`
- GET `/api/admin/persistence/health`
- POST `/api/admin/persistence/patch-auth`
- POST `/api/admin/outlets/upsert`
- POST `/api/admin/codes/sync`
- GET `/api/admin/assignments/list`
- POST `/api/admin/assignments/normalize`
- POST `/api/admin/assignments/upsert`
- POST `/api/admin/attendants/upsert`
- POST `/api/admin/debug/resolve`

Debug
- GET `/api/debug/db`
- POST `/api/debug/payments` (present twice under different folders; one may be legacy)

Supply (core)
- POST `/api/supply/opening`
- POST `/api/supply/transfer`
- POST `/api/supply/lock`

Notes
- Most routes follow the convention: `export const runtime = "nodejs"; export const dynamic = "force-dynamic"; export const revalidate = 0;` and return `{ ok: boolean, ... }` on both success/failure.

## Data Models (Prisma)

Enums
- `PersonRole`: attendant | supervisor | supplier
- `DepositStatus`: VALID | PENDING | INVALID

Core entities
- `Outlet` — Shops/outlets; `name` unique; linked to `Attendant`
- `Product` — Sellable items; `key` unique; price via `sellPrice`
- `PersonCode` — Human-readable login codes (name, code, role, active)
- `PhoneMapping` — Code ↔ phoneE164 ↔ role mapping (for WA binding)
- `AttendantScope` — Code-level outlet + allowed products
- `ScopeProduct` — Join table for scope products
- `PricebookRow` — Outlet-level pricebook
- `SupplyOpeningRow`, `SupplyTransfer` — Supply tracking
- `AttendantClosing`, `AttendantDeposit`, `AttendantExpense` — Daily ops
- `ActivePeriod` — Active day/window per outlet
- `Setting` — Server-backed KV store for mirrored storage keys
- `AppState` — Minimal KV for app state
- `AttendantAssignment` — Code → outlet + product keys (text[])
- `ReviewItem` — Supervisor review queue
- `WaMessageLog` — WhatsApp message logs (in/out/status)
- `WaSession` — WhatsApp chat session state per phone (IDLE|MENU|...)
- Auth models: `Attendant`, `LoginCode`, `Session`

Auth/WA linkage
- WA login is “link-only”: the chat no longer accepts codes; users receive a deep link, open WA, then `/api/wa/auth/finalize` binds and greets them.
- The portal `/login` page can generate/link and then finalize when `wa/nonce` is present.

## Environment Variables

- App/site
  - `APP_ORIGIN` — Base origin for deep links (server)
  - `NODE_ENV` — Production/development behavior
- Database/Prisma
  - `DATABASE_URL`, `DATABASE_URL_UNPOOLED`
  - `PRISMA_*` — Engine toggles (implicit via Prisma)
- WhatsApp
  - `NEXT_PUBLIC_WA_BUSINESS` — Business WA number (public)
  - `NEXT_PUBLIC_WA_PUBLIC_E164` — Public E.164 for wa.me link
  - `WHATSAPP_APP_SECRET`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_TOKEN`
  - `WA_DRY_RUN` — Don’t call WA; log instead
  - `WA_NOTIFY_ON_SUPPLY` — Auto-send a confirmation after supply POST
  - `WA_SESSION_TTL_MIN` — Idle timeout in minutes (default 10)
  - `REMINDERS_ENABLED` — Enable scheduled reminder sends (default true)
  - `TZ_DEFAULT` — Default timezone label for reminder date bucketing (display-only; ISO date is naive)
- Daraja
  - `DARAJA_BASE_URL`, `DARAJA_CONSUMER_KEY`, `DARAJA_CONSUMER_SECRET`, `DARAJA_C2B_SHORTCODE`
- Misc
  - `PUBLIC_BASE_URL` — used in Daraja registration

## Utility Scripts and NPM Commands

NPM scripts (from `package.json`)
- `dev`, `build`, `start`, `lint`, `typecheck`
- Prisma: `prisma:generate`, `prisma:push`, `prisma:migrate:dev`, `prisma:migrate:deploy`
- DB checks/seeders: `db:check`, `db:seed:assignments`
- Codes visibility/seeders:
  - `show:codes` → `tsx scripts/show-codes.ts`
  - `show:attendant:codes` → `tsx scripts/show-attendant-codes.ts`
  - `seed:attendant:sample` → `tsx scripts/seed-attendant-code.ts`

Key script purposes
- `scripts/show-codes.ts` — List `PersonCode` and `PhoneMapping`
- `scripts/show-attendant-codes.ts` — Show active attendant codes with phone/outlet/products
- `scripts/seed-attendant-code.ts` — Seed a sample code/scope if none exist
- `scripts/*Assignments*.mjs` — Seed/normalize assignments

## Important Components and Files

- `src/lib/prisma.ts` — Prisma client singleton
- `src/lib/session.ts` — Cookie session helpers (`bk_sess`)
- `src/lib/wa.ts` — WA send wrappers (honors `WA_DRY_RUN`)
- `src/server/wa_links.ts` — Create per-phone deep links (TTL via `WA_SESSION_TTL_MIN`)
- `src/app/api/wa/webhook/route.ts` — WA inbound handling + proactive login link buttons
- `src/lib/wa_attendant_flow.ts` — WA attendant state machine (link-only login)
- `src/app/_bridges/StorageBridge.tsx` — Client storage ↔ server `AppState` sync

## Sanity Checks and Potential Issues to Review

- Chatrace webhook duplication
  - Both `/api/webhooks/chatrace` and `/api/chatrace/webhook` exist. Confirm which endpoint your provider calls; consider consolidating to one.
- Auth endpoints overlap
  - Legacy code login routes (`/api/auth/code/login`, `/api/wa/portal-login`) vs link-only flow (`/api/flow/login-link` + `/api/wa/auth/finalize`). Ensure the UI only uses the link-only path.
- Duplicate debug payments route
  - There appear to be two `api/debug/payments` files in search results. Verify there is a single source of truth.
- PersonCode vs Attendant/LoginCode
  - You have both `PersonCode` and `Attendant`/`LoginCode` models. Confirm which pathway is canonical for each role.
- Phone mapping consistency
  - `PhoneMapping.role` is a string; `PersonRole` is an enum. Consider aligning types/enforcement.
- Admin guard is client-only
  - Ensure no sensitive data leaks to admin pages at build time. Server-side admin checks aren’t present by design.
- Prisma on Node runtime only
  - Confirm all DB-using routes export `runtime = "nodejs"` and aren’t deployed to Edge.

## How to Run (optional)

PowerShell examples (Windows)
```powershell
# Typecheck
npm run typecheck

# Dev server (dry-run for WA)
$env:WA_DRY_RUN="true"; npm run dev

# Show codes
npm run -s show:attendant:codes
```

## Troubleshooting

- Session not persisting: check `bk_sess` cookie and `Session` TTL.
- WA not sending: set `WA_DRY_RUN=false` (or unset), validate envs, inspect `/api/wa/send` logs.
- Storage not hydrating: verify `/api/state/bulk-get` and allowed keys in `StorageBridge`.
- Prisma schema changes: run `npm run prisma:generate` and typecheck.

---

If you spot a mismatch in this doc vs code, update this file and/or the route names to keep the map accurate.
