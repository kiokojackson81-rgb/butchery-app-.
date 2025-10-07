import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const DRY = (process.env.WA_DRY_RUN === "true") || true;

// Minimal GPT-only smoke to guard against legacy fallbacks.
// Preconditions: run dev with WA_DRY_RUN=true so no real Graph calls are made.

test.describe("WhatsApp GPT-only routing", () => {
  test("Hi produces GPT text + six-tab interactive", async ({ request }) => {
    test.skip(!/localhost/i.test(BASE), "Runs only locally against dev server");
    const phoneE164 = "+254700000001";

    // Ensure dev session exists
    const s = await request.get(`${BASE}/api/wa/dev/session?phoneE164=${encodeURIComponent(phoneE164)}`);
    expect(s.ok()).toBeTruthy();

    // Simulate inbound text via webhook simulator (if present) or direct webhook POST
    const resp = await request.post(`${BASE}/api/wa/simulate`, {
      data: { phoneE164, text: "Hi" },
    });
    expect(resp.ok()).toBeTruthy();

    // Pull recent logs to assert OOC_INFO and AI_DISPATCH_INTERACTIVE
    const logs = await request.get(`${BASE}/api/wa/logs?limit=20&to=${encodeURIComponent(phoneE164)}`);
    expect(logs.ok()).toBeTruthy();
    const body = await logs.json();
    const rows = body.rows || [];
    const hasOOC = rows.some((r: any) => r?.type === "OOC_INFO");
    const hasInteractive = rows.some((r: any) => r?.type === "AI_DISPATCH_INTERACTIVE");
    expect(hasOOC).toBeTruthy();
    expect(hasInteractive).toBeTruthy();
  });

  test("Digit '1' routes through GPT first (no legacy)", async ({ request }) => {
    test.skip(!/localhost/i.test(BASE), "Runs only locally against dev server");
    const phoneE164 = "+254700000001";
    const resp = await request.post(`${BASE}/api/wa/simulate`, { data: { phoneE164, text: "1" } });
    expect(resp.ok()).toBeTruthy();
    const logs = await request.get(`${BASE}/api/wa/logs?limit=20&to=${encodeURIComponent(phoneE164)}`);
    const body = await logs.json();
    const rows = body.rows || [];
    // Should have OOC and no legacy types
    expect(rows.some((r: any) => r?.type === "OOC_INFO")).toBeTruthy();
    expect(rows.some((r: any) => /Choose/i.test(JSON.stringify(r?.payload || {})))).toBeFalsy();
  });
});
