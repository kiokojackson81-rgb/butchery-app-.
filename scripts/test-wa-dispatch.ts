import 'dotenv/config';
import { POST } from '../src/app/api/wa/webhook/route';
import { clearDevWaLogs, queryDevWaLogs } from '../src/lib/dev_wa_logs';

// Local-only smoke test for WhatsApp dispatch logic (no network calls).
// Runs in WA_DRY_RUN mode and prints the outbound payload(s) captured in the in-memory dev log store.

process.env.WA_DRY_RUN = process.env.WA_DRY_RUN || 'true';
process.env.WA_GPT_ONLY = process.env.WA_GPT_ONLY || 'true';
process.env.WA_LOG_DRY_RUN = process.env.WA_LOG_DRY_RUN || 'true';
process.env.WHATSAPP_APP_SECRET = process.env.WHATSAPP_APP_SECRET || '';

async function run() {
  const from = process.argv[2] || '254700000001';
  const text = process.argv.slice(3).join(' ') || 'Hello, I want to record a deposit';

  clearDevWaLogs();

  const body = {
    entry: [
      {
        changes: [
          {
            value: {
              messages: [
                {
                  from,
                  id: `wamid.simulated.${Date.now()}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: text },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  const req = new Request('https://example.test/api/wa/webhook', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });

  const res = await POST(req as any);
  const resText = await res.text().catch(() => '');

  const rows = queryDevWaLogs({ to: from, limit: 20 });
  const summary = rows.map((r) => ({
    createdAt: r.createdAt,
    direction: r.direction,
    status: r.status,
    templateName: r.templateName,
    waMessageId: r.waMessageId,
    to: r.payload?.phone || r.payload?.meta?.phoneE164 || r.payload?.request?.to || r.payload?.to || null,
    textPreview: (r.payload?.text ? String(r.payload.text) : (r.payload?.request?.text?.body ? String(r.payload.request.text.body) : '')).slice(0, 120),
  }));

  console.log('webhook status:', (res as any).status, 'body:', resText);
  console.log(JSON.stringify(summary, null, 2));
}

run().catch((e) => {
  console.error('test-wa-dispatch failed:', String((e as any)?.message || e));
  process.exit(2);
});
