# Environment variables (WhatsApp + GPT)

Set these in Vercel → Settings → Environment Variables:

- WhatsApp Cloud API
  - WHATSAPP_PHONE_NUMBER_ID (aka WA_PHONE_ID)
  - WHATSAPP_TOKEN (aka WA_ACCESS_TOKEN)
  - WHATSAPP_VERIFY_TOKEN (aka WA_VERIFY_TOKEN)
  - WHATSAPP_APP_SECRET (for x-hub-signature-256 verification)

- OpenAI
  - OPENAI_API_KEY

- App
  - APP_ORIGIN e.g. https://barakafresh.com
  - NEXT_PUBLIC_WA_PUBLIC_E164 e.g. +2547...
  - WA_DRY_RUN=true|false
  - WA_SESSION_TTL_MIN e.g. 10
  - WA_DISABLE_RAW_LOG=true|false (optional safety hot-flag to no-op DB logging during incidents)

- Database
  - DATABASE_URL (Postgres)

Notes
- This repo uses WHATSAPP_* names in code (see `src/lib/wa.ts`, webhook route). If your project uses WA_* names, set both or adjust env mapping.
- Cron endpoints are configured in `vercel.json` and hit the Next routes under `src/app/api/wa/jobs/*`.
