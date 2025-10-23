Scripts for DB migrations and local Postgres for development

Files
- `prod-migrate.ps1` - helper to run production migrations safely. Requires `ALLOW_PROD_MIGRATE='true'` and `DATABASE_URL` set. Attempts a `pg_dump` backup (if `pg_dump` is available) before running `npx prisma migrate deploy`.
- `start-dev-db.ps1` - spins up a local Postgres container (Docker) and prints a recommended `DATABASE_URL` to use in `.env.local`.

Recommended usage

Local dev DB
1. Start Docker Postgres (from project root):
   pwsh ./scripts/start-dev-db.ps1
2. Export DATABASE_URL in your shell or create `.env.local`:
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/butchery?schema=public
3. Apply migrations locally and generate client:
   npx prisma migrate dev --schema=prisma/schema.prisma
   npx prisma generate
4. Start the dev server (example):
   $env:PORT="3002"; npm run dev

Production migrations (CAUTION)
1. Ensure you have a tested backup of the production DB.
2. Set the following env vars in the shell where you run the script:
   $env:ALLOW_PROD_MIGRATE = 'true'
   $env:DATABASE_URL = '<production-database-url>'
3. Run (from project root):
   pwsh ./scripts/prod-migrate.ps1

Notes
- `prod-migrate.ps1` is a convenience script. If you have a CI/CD process for migrations, prefer that.
- Always test restores from backups in a staging environment before touching production.
Staging smoke-run script

This script simulates a subset of the WhatsApp webhook flows by POSTing realistic inbound webhook payloads to a running staging server and polling `/api/wa/diag` for quick verification.

Required env and runtime
- A staging server running the app with WhatsApp and OpenAI credentials configured.
- Environment variables on the server: WHATSAPP_TOKEN, WHATSAPP_WABA_ID, OPENAI_API_KEY, WA_TEMPLATE_NAME, WEBHOOK_VERIFY_TOKEN.
- Local Node (>=16) to run this script.

Usage

node run-staging-smoke.mjs --base https://staging.example.com --phone +254605663175

Notes
- The script does not mutate the database directly — it triggers the webhook handler which performs the server-side writes.
- It pauses a short while between steps to allow the server to process and send outbound messages.
- For a full smoke test (all 12 checks) this script is a starting point; we can extend it to cover attendant/supplier/supervisor flows and to capture diagnostic artifacts on failures.

Artifacts and diag auth

- The script writes artifacts to `./.smoke-artifacts/<timestamp>_<test-name>/result.json` (and `error.json` on failure).
- If your staging diag endpoint requires an API key, pass `--diag-key <key>` and the script will add it as a `key` query parameter to `/api/wa/diag`.
