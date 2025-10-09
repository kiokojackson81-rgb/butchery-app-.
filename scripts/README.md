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
