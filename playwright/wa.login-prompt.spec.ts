import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const TEST_PHONE = process.env.TEST_PHONE_E164 || "+254700000000";

test.describe("login prompt dispatch (dry-run)", () => {
  test("dev endpoint sends login prompt via dispatcher", async ({ request }) => {
    // Trigger the login prompt
    const res = await request.post(`${BASE}/api/wa/dev/send-login-prompt`, {
      data: { phoneE164: TEST_PHONE, reason: "auth-required" },
    });
    expect(res.ok()).toBeTruthy();
    const j = await res.json();
    expect(j.ok).toBeTruthy();

    // Fetch logs to confirm outbound message
    const toDigits = (p: string) => String(p || "").replace(/[^0-9+]/g, "").replace(/^\+/, "");
    const to = toDigits(TEST_PHONE);
    const logs = await request.get(`${BASE}/api/wa/logs?to=${encodeURIComponent(to)}&limit=20`);
    expect(logs.ok()).toBeTruthy();
    const jl = await logs.json();
    expect(jl.ok).toBeTruthy();
    const rows: any[] = jl.rows || [];
    expect(rows.length).toBeGreaterThan(0);
    const last = rows[0];
    const payload = last?.payload || {};
    const text: string = payload?.text || payload?.request?.text?.body || payload?.body?.text || "";
    // Should contain login prompt copy or deep link
    expect(/log in|login|Open link|Tap to log in/i.test(text)).toBeTruthy();
  });
});
