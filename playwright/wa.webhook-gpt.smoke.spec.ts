import { test, expect } from '@playwright/test';

/**
 * Smoke: simulate an inbound WhatsApp text → webhook → GPT → sendText
 * Preconditions:
 * - BASE_URL points to a running server with WA_AI_ENABLED=true and valid envs.
 * - In dry-run, transport logs to WaMessageLog without actually calling Meta.
 */

test('webhook forwards inbound text to GPT and logs reply', async ({ request }) => {
  const base = process.env.BASE_URL || 'http://localhost:3000';

  // Minimal WhatsApp webhook payload
  const phone = '+254700000001';
  const fromGraph = phone.replace(/^\+/, '');
  const body = {
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA_ID',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '12345', phone_number_id: '12345' },
              contacts: [{ profile: { name: 'Test' }, wa_id: fromGraph }],
              messages: [
                {
                  from: fromGraph,
                  id: 'wamid.HBgNMg',
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type: 'text',
                  text: { body: 'hi' },
                },
              ],
            },
          },
        ],
      },
    ],
  };

  // Signature is verified in production; in local smoke we skip by not setting WHATSAPP_APP_SECRET
  const resp = await request.post(`${base}/api/wa/webhook`, {
    headers: { 'content-type': 'application/json' },
    data: body,
  });

  expect(resp.ok()).toBeTruthy();
  const json = await resp.json();
  expect(json).toMatchObject({ ok: true });
});
