import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3000";

// Preconditions: run dev with WA_* flags enabled for tabs and AI in DRY mode.
// The suite runs only against localhost to avoid hitting real Graph.

test.describe("WhatsApp GPT-only routing (smoke)", () => {
  test.beforeAll(async ({ request }) => {
    const LOCAL = /(localhost|127\.0\.0\.1)/i.test(BASE);
    if (!LOCAL) test.skip(true, "Skipping: not running against localhost");
    const flagsResp = await request.get(`${BASE}/api/wa/dev/flags`);
    if (!flagsResp.ok()) test.skip(true, `Skipping: flags endpoint not available (${flagsResp.status()})`);
    const flags = await flagsResp.json().catch(() => ({} as any));
    const cfg = flags?.flags || {};
    if (!cfg?.DRY || !cfg?.GPT_ONLY || !cfg?.AI || !cfg?.TABS || !cfg?.INTERACTIVE) {
      test.skip(true, `Skipping: server flags not set for GPT-only+tabs (got ${JSON.stringify(cfg)})`);
    }
  });

  test("Hi produces text and an interactive (tabs)", async ({ request }) => {
    test.skip(!/(localhost|127\.0\.0\.1)/i.test(BASE), "Runs only locally against dev server");
    const phoneE164 = "+254700000001";

    const fin = await request.post(`${BASE}/api/wa/auth/finalize`, {
      data: { phoneE164, code: process.env.TEST_CODE_ATTENDANT || "ATT001" },
    });
    expect(fin.ok()).toBeTruthy();

    const s = await request.get(`${BASE}/api/wa/dev/session?phoneE164=${encodeURIComponent(phoneE164)}`);
    if (!s.ok()) test.skip(true, `Skipping: dev session endpoint not available (${s.status()})`);
    const sj = await s.json().catch(() => ({} as any));
    if (sj?.ok === false && /DISABLED/i.test(String(sj?.error || ""))) test.skip(true, "Skipping: WA_DRY_RUN not enabled on server");

    const fromGraph = phoneE164.replace(/^\+/, "");
    const webhookBody = {
      object: 'whatsapp_business_account',
      entry: [ { id: 'WABA_ID', changes: [ { field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '12345', phone_number_id: '12345' }, contacts: [ { profile: { name: 'Test' }, wa_id: fromGraph } ], messages: [ { from: fromGraph, id: `wamid.${Date.now()}`, timestamp: String(Math.floor(Date.now()/1000)), type: 'text', text: { body: 'Hi' } } ] } } ] } ]
    } as const;

    const resp = await request.post(`${BASE}/api/wa/webhook`, { data: webhookBody, headers: { 'content-type': 'application/json' } });
    expect(resp.ok()).toBeTruthy();

    let foundInteractive = false;
    for (let i = 0; i < 8 && !foundInteractive; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const logs = await request.get(`${BASE}/api/wa/admin/inspect?phone=${encodeURIComponent(phoneE164)}&limit=40`);
      if (!logs.ok()) continue;
      const body = await logs.json().catch(() => ({} as any));
      const rows = (body?.logs as any[]) || [];
      foundInteractive = rows.some((r: any) => r?.type === "AI_DISPATCH_INTERACTIVE");
    }
    expect(foundInteractive).toBeTruthy();
  });

  test("Digit '1' does not route to legacy menu first", async ({ request }) => {
    test.skip(!/(localhost|127\.0\.0\.1)/i.test(BASE), "Runs only locally against dev server");
    const phoneE164 = "+254700000001";

    const fin = await request.post(`${BASE}/api/wa/auth/finalize`, {
      data: { phoneE164, code: process.env.TEST_CODE_ATTENDANT || "ATT001" },
    });
    expect(fin.ok()).toBeTruthy();

    const fromGraph = phoneE164.replace(/^\+/, "");
    const webhookBody = {
      object: 'whatsapp_business_account',
      entry: [ { id: 'WABA_ID', changes: [ { field: 'messages', value: { messaging_product: 'whatsapp', metadata: { display_phone_number: '12345', phone_number_id: '12345' }, contacts: [ { profile: { name: 'Test' }, wa_id: fromGraph } ], messages: [ { from: fromGraph, id: `wamid.${Date.now()}`, timestamp: String(Math.floor(Date.now()/1000)), type: 'text', text: { body: '1' } } ] } } ] } ]
    } as const;

    const s = await request.get(`${BASE}/api/wa/dev/session?phoneE164=${encodeURIComponent(phoneE164)}`);
    if (!s.ok()) test.skip(true, `Skipping: dev session endpoint not available (${s.status()})`);
    const sj = await s.json().catch(() => ({} as any));
    if (sj?.ok === false && /DISABLED/i.test(String(sj?.error || ""))) test.skip(true, "Skipping: WA_DRY_RUN not enabled on server");

    const resp = await request.post(`${BASE}/api/wa/webhook`, { data: webhookBody, headers: { 'content-type': 'application/json' } });
    expect(resp.ok()).toBeTruthy();

    let hasInteractiveOrText = false, hasLegacy = false;
    for (let i = 0; i < 8 && !hasInteractiveOrText; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const logs = await request.get(`${BASE}/api/wa/admin/inspect?phone=${encodeURIComponent(phoneE164)}&limit=40`);
      if (!logs.ok()) continue;
      const body = await logs.json().catch(() => ({} as any));
      const rows = (body?.logs as any[]) || [];
      hasInteractiveOrText = rows.some((r: any) => r?.type === "AI_DISPATCH_INTERACTIVE" || r?.type === "AI_DISPATCH_TEXT");
      hasLegacy = rows.some((r: any) => /Choose/i.test(String(r?.payload || "")));
    }
    expect(hasInteractiveOrText).toBeTruthy();
    expect(hasLegacy).toBeFalsy();
  });
});
