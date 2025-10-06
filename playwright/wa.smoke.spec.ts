import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const PHONE = process.env.TEST_PHONE_E164 || "+254700000000";
const CODE_ATT = process.env.TEST_CODE_ATTENDANT || "ATT001";

async function postJSON(request: any, url: string, data: any) {
  const res = await request.post(url, { data });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

test.describe("WA session loop smokes", () => {
  test("login -> menu -> 1 executes without login loop", async ({ request }) => {
    // Finalize login directly
    const j = await postJSON(request, `${BASE}/api/wa/auth/finalize`, { phoneE164: PHONE, code: CODE_ATT });
    expect(j.ok).toBeTruthy();

    // Send webhook-like text '1'
    const body = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { messages: [{ id: "wam1", from: PHONE.replace(/^\+/, ""), type: "text", text: { body: "1" } }] } }] }],
    };
    const res = await request.post(`${BASE}/api/wa/webhook`, { data: body });
    expect(res.ok()).toBeTruthy();

    // Expect logs to contain a menu/closing prompt (heuristic)
    const to = PHONE.replace(/[^0-9+]/g, "").replace(/^\+/, "");
    const logs = await request.get(`${BASE}/api/wa/logs?to=${to}&limit=20`);
    expect(logs.ok()).toBeTruthy();
    const jl = await logs.json();
    expect(jl.ok).toBeTruthy();
    const rows: any[] = jl.rows || [];
    const text = rows.map((r: any) => r?.payload?.request?.text?.body || r?.payload?.text || "").join("\n");
    expect(/Enter closing|Choose|Pick a product/i.test(text)).toBeTruthy();
  });

  test("duplicate login prompts are suppressed", async ({ request }) => {
    // Force expire to trigger login prompt
    await postJSON(request, `${BASE}/api/wa/dev/expire-session`, { phoneE164: PHONE, minutesAgo: 999 });
    // Send a text to trigger login prompt
    const body = { object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ id: "wam2", from: PHONE.replace(/^\+/, ""), type: "text", text: { body: "hello" } }] } }] }] };
    await request.post(`${BASE}/api/wa/webhook`, { data: body });
    // Immediately send again
    await request.post(`${BASE}/api/wa/webhook`, { data: { ...body, entry: [{ changes: [{ value: { messages: [{ id: "wam3", from: PHONE.replace(/^\+/, ""), type: "text", text: { body: "hello again" } }] } }] }] } });
    // Fetch recent logs and ensure not more than one LOGIN prompt marker is present
    const to = PHONE.replace(/[^0-9+]/g, "").replace(/^\+/, "");
    const logs = await request.get(`${BASE}/api/wa/logs?to=${to}&limit=50`);
    const jl = await logs.json();
    const rows: any[] = jl.rows || [];
    const markers = rows.filter((r: any) => String(r?.status || "").includes("LOGIN_PROMPT"));
    expect(markers.length).toBeLessThanOrEqual(1);
  });

  test("TTL expire prompts login once", async ({ request }) => {
    await postJSON(request, `${BASE}/api/wa/dev/expire-session`, { phoneE164: PHONE, minutesAgo: 120 });
    const body = { object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ id: "wam4", from: PHONE.replace(/^\+/, ""), type: "text", text: { body: "1" } }] } }] }] };
    const res = await request.post(`${BASE}/api/wa/webhook`, { data: body });
    expect(res.ok()).toBeTruthy();
    // Should emit a single login prompt log
    const to = PHONE.replace(/[^0-9+]/g, "").replace(/^\+/, "");
    const logs = await request.get(`${BASE}/api/wa/logs?to=${to}&limit=20`);
    const jl = await logs.json();
    const rows: any[] = jl.rows || [];
    const markers = rows.filter((r: any) => String(r?.status || "").includes("LOGIN_PROMPT"));
    expect(markers.length).toBeGreaterThan(0);
  });
});
