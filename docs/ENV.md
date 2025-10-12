# Environment variables (Legacy WhatsApp)

Set these in Vercel → Settings → Environment Variables:

- WhatsApp Cloud API
  - WHATSAPP_PHONE_NUMBER_ID (aka WA_PHONE_ID)
  - WHATSAPP_TOKEN (aka WA_ACCESS_TOKEN)
  - WHATSAPP_VERIFY_TOKEN (aka WA_VERIFY_TOKEN)
  - WHATSAPP_APP_SECRET (for x-hub-signature-256 verification)

- App
  - APP_ORIGIN e.g. https://barakafresh.com
  - NEXT_PUBLIC_WA_PUBLIC_E164 e.g. +2547...
  - WA_DRY_RUN=true|false
  - WA_SESSION_TTL_MIN e.g. 10
  - WA_DISABLE_RAW_LOG=true|false (optional safety hot-flag to no-op DB logging during incidents)
  - WA_TABS_ENABLED=true|false (optional, if true the WA UI shows tabs and some text acks are suppressed)

- Database
  - DATABASE_URL (Postgres)

Notes
- GPT/OOC routing has been removed. All flows are legacy-only and server-side.
- This repo uses WHATSAPP_* names in code (see `src/lib/wa.ts`, webhook route). If your project uses WA_* names, set both or adjust env mapping.
- Cron endpoints are configured in `vercel.json` and hit the Next routes under `src/app/api/wa/jobs/*`.

Testing
- Unit tests run without a database or server by default. See `.env.test.example`.
- Integration/DB/Playwright suites are excluded by default in `vitest.config.ts`.
- To run integration tests, provide `DATABASE_URL` and `BASE_URL` and invoke specific suites explicitly.
