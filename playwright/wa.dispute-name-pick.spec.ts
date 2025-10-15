import { test, expect } from '@playwright/test';

const BASE = process.env.BASE_URL || 'http://localhost:3002';

// Minimal smoke to exercise the Reply 1 dispute name-based selection end-to-end via webhook.
// This test will self-skip if dev endpoints or required flags are not available.
// Steps:
// 1) Ensure server is local and dev ping works
// 2) Finalize login for an attendant phone/code
// 3) Upsert an opening item for that outlet/date
// 4) Send '1' (list items) then product name via webhook
// 5) Poll dev session to verify state advanced to DISPUTE_QTY with matching item

test.describe('WA dispute: pick by product name (Reply 1)', () => {
  const phoneE164 = '+254700000081';
  const fromGraph = phoneE164.replace(/^\+/, '');
  const code = process.env.TEST_CODE_ATTENDANT || 'ATT001';
  const outlet = process.env.TEST_OUTLET || 'TestOutlet';
  const itemKey = 'GOAT';
  const prodName = 'Goat';
  const today = new Date().toISOString().slice(0,10);

  test.beforeAll(async ({ request }) => {
    const LOCAL = /(localhost|127\.0\.0\.1)/i.test(BASE);
    if (!LOCAL) test.skip(true, 'Runs only against localhost');
    // Prefer session endpoint which is enabled in DRY/dev without ADMIN_DIAG_KEY
    const probe = await request.get(`${BASE}/api/wa/dev/session?phoneE164=${encodeURIComponent(phoneE164)}`);
    if (!probe.ok()) test.skip(true, `Skipping: dev session endpoint not available (${probe.status()})`);
  });

  test('dispute pick by name reaches DISPUTE_QTY', async ({ request }) => {
    // 1) finalize login to create/attach waSession
    const fin = await request.post(`${BASE}/api/wa/auth/finalize`, { data: { phoneE164, code } });
    if (!fin.ok()) test.skip(true, `Skipping: finalize failed (${fin.status()})`);

    // 2) seed opening row for today/outlet
    const up = await request.post(`${BASE}/api/supply/opening/item`, {
      data: { date: today, outletName: outlet, itemKey, qty: 10, unit: 'kg', supplierName: 'Kyalo' },
    });
    if (!up.ok()) test.skip(true, `Skipping: opening upsert failed (${up.status()})`);

    // Helper: post webhook text
    async function sendText(body: string) {
      const webhookBody = {
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
                  messages: [{ from: fromGraph, id: `wamid.${Date.now()}`, timestamp: String(Math.floor(Date.now()/1000)), type: 'text', text: { body } }],
                },
              },
            ],
          },
        ],
      } as const;
      const resp = await request.post(`${BASE}/api/wa/webhook`, { data: webhookBody, headers: { 'content-type': 'application/json' } });
      expect(resp.ok()).toBeTruthy();
    }

    // 3) send '1' then the product name
    await sendText('1');
    await sendText(prodName);

    // 4) poll dev session to assert state
    let ok = false;
    for (let i = 0; i < 8 && !ok; i++) {
      await new Promise(r => setTimeout(r, 800));
      const sess = await request.get(`${BASE}/api/wa/dev/session?phoneE164=${encodeURIComponent(phoneE164)}`);
      if (!sess.ok()) continue;
      const sj: any = await sess.json().catch(() => ({}));
      const state = sj?.session?.state;
      const cursor = sj?.session?.cursor || {};
      const draft = (cursor as any)?.disputeDraft;
      ok = state === 'DISPUTE_QTY' && draft && (draft.itemKey === itemKey || draft.name === prodName);
    }
    expect(ok).toBeTruthy();
  });
});
