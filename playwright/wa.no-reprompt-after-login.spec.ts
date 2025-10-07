import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CODE_ATT = process.env.TEST_CODE_ATTENDANT || "ATT001";

function WAM() { return `wam-${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }
function toGraph(phone: string) { return phone.replace(/^\+/, ""); }
async function postJSON(request: any, url: string, data: any) { const res = await request.post(url, { data }); expect(res.ok()).toBeTruthy(); return res.json(); }

test.describe("No login re-prompt after login", () => {
  test("finalize then '1' should not re-prompt", async ({ request }) => {
    const PHONE = process.env.TEST_PHONE_E164 || "+254700000039";

    // 1) Finalize login (bind phone ↔ code and set ACTIVE/MENU)
    await postJSON(request, `${BASE}/api/wa/auth/finalize`, { phoneE164: PHONE, code: CODE_ATT });

    // 2) Baseline: fetch last WA log id for this phone
    const toDigits = (p: string) => String(p || "").replace(/[^0-9+]/g, "").replace(/^\+/, "");
    const to = toDigits(PHONE);
    const baseLogs = await request.get(`${BASE}/api/wa/logs?to=${encodeURIComponent(to)}&limit=1`);
    expect(baseLogs.ok()).toBeTruthy();
    const baseJson = await baseLogs.json();
    const baseRows: any[] = baseJson?.rows || [];
    const cursorAfter = baseRows[0]?.id as string | undefined;

    // 3) Send an inbound text '1' immediately
    const body = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { messages: [{ id: WAM(), from: toGraph(PHONE), type: "text", text: { body: "1" } }] } }] }],
    };
    const res = await request.post(`${BASE}/api/wa/webhook`, { data: body });
    expect(res.ok()).toBeTruthy();

    // 4) Fetch new logs after baseline and assert no LOGIN_PROMPT among them
    const logs2 = await request.get(`${BASE}/api/wa/logs?to=${encodeURIComponent(to)}&limit=30${cursorAfter ? `&after=${cursorAfter}` : ""}`);
    expect(logs2.ok()).toBeTruthy();
    const j2 = await logs2.json();
    const rows2: any[] = j2?.rows || [];
    const hasPrompt = rows2.some((r) => String(r?.status || "").toUpperCase() === "LOGIN_PROMPT");
    expect(hasPrompt).toBeFalsy();

    // 5) Also verify session state is not LOGIN/SPLASH (i.e., remains authenticated)
    const sessRes = await request.get(`${BASE}/api/wa/dev/session?phoneE164=${encodeURIComponent(PHONE)}`);
    expect(sessRes.ok()).toBeTruthy();
    const sess = await sessRes.json();
    const state = String(sess?.sess?.state || "");
    expect(["LOGIN", "SPLASH"]).not.toContain(state);
  });
});
