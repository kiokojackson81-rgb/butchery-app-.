import { test, expect } from "@playwright/test";

// GPT has been removed; skip this suite by default to avoid false failures.
test.describe('GPT-only specs (disabled)', () => {
  test.skip(true, 'GPT/OOC routing removed; suite disabled.');
});

const BASE = process.env.BASE_URL || "http://localhost:3000";
const DRY = (process.env.WA_DRY_RUN === "true") || true;

// Minimal GPT-only smoke to guard against legacy fallbacks.
// Preconditions: run dev with WA_DRY_RUN=true so no real Graph calls are made.
// Additionally, ensure these flags are set on the SERVER process:
//   WA_GPT_ONLY=true WA_AI_ENABLED=true WA_INTERACTIVE_ENABLED=true WA_TABS_ENABLED=true
// If not set, this suite will be skipped to avoid false failures.

test.describe("WhatsApp GPT-only routing", () => {
  test.beforeAll(async ({ request }) => {
    const LOCAL = /(localhost|127\.0\.0\.1)/i.test(BASE);
    if (!LOCAL) test.skip(true, 'Skipping: not running against localhost');
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

    // Ensure dev session exists (dry-run): finalize login to create waSession
    const fin = await request.post(`${BASE}/api/wa/auth/finalize`, {
      data: { phoneE164, code: process.env.TEST_CODE_ATTENDANT || "ATT001" },
    });
    expect(fin.ok()).toBeTruthy();

  // Sanity: session endpoint reachable; skip if disabled/not running
  const s = await request.get(`${BASE}/api/wa/dev/session?phoneE164=${encodeURIComponent(phoneE164)}`);
  if (!s.ok()) test.skip(true, `Skipping: dev session endpoint not available (${s.status()})`);
  const sj = await s.json().catch(() => ({} as any));
  if (sj?.ok === false && /DISABLED/i.test(String(sj?.error || ""))) test.skip(true, "Skipping: WA_DRY_RUN not enabled on server");

    // Drive inbound via webhook to exercise GPT/OOC path
    const fromGraph = phoneE164.replace(/^\+/, "");
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
                messages: [
                  { from: fromGraph, id: `wamid.${Date.now()}`, timestamp: String(Math.floor(Date.now()/1000)), type: 'text', text: { body: 'Hi' } },
                ],
              },
            },
          ],
        },
      ],
    } as const;
    const resp = await request.post(`${BASE}/api/wa/webhook`, { data: webhookBody, headers: { 'content-type': 'application/json' } });
    expect(resp.ok()).toBeTruthy();

    // Pull recent logs via admin inspect to assert AI_DISPATCH_INTERACTIVE (poll up to ~8s)
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
    // Ensure session exists
    const fin = await request.post(`${BASE}/api/wa/auth/finalize`, {
      data: { phoneE164, code: process.env.TEST_CODE_ATTENDANT || "ATT001" },
    });
    expect(fin.ok()).toBeTruthy();

    const fromGraph = phoneE164.replace(/^\+/, "");
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
                messages: [
                  { from: fromGraph, id: `wamid.${Date.now()}`, timestamp: String(Math.floor(Date.now()/1000)), type: 'text', text: { body: '1' } },
                ],
              },
            },
          ],
        },
      ],
    } as const;
  // Sanity: session endpoint reachable; skip if disabled/not running
  const s = await request.get(`${BASE}/api/wa/dev/session?phoneE164=${encodeURIComponent(phoneE164)}`);
  if (!s.ok()) test.skip(true, `Skipping: dev session endpoint not available (${s.status()})`);
  const sj = await s.json().catch(() => ({} as any));
  if (sj?.ok === false && /DISABLED/i.test(String(sj?.error || ""))) test.skip(true, "Skipping: WA_DRY_RUN not enabled on server");

  const resp = await request.post(`${BASE}/api/wa/webhook`, { data: webhookBody, headers: { 'content-type': 'application/json' } });
    expect(resp.ok()).toBeTruthy();
    // Poll logs similarly using admin inspect
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
