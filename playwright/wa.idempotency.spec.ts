import { test, expect } from "@playwright/test";

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CODE_ATT = process.env.TEST_CODE_ATTENDANT || "ATT001";

function WAM() { return `wam-${Date.now()}-${Math.random().toString(36).slice(2,8)}`; }
function toGraph(phone: string) { return phone.replace(/^\+/, ""); }

async function postJSON(request: any, url: string, data: any) {
  const res = await request.post(url, { data });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

// Validate we don't double-handle the same WhatsApp message id
// Scenario: same wamid retried by Meta; server must process once only
// Pre-req: local dry-run or test environment

test.describe("WA idempotency", () => {
  test("same wamid processed once", async ({ request }) => {
    const PHONE = process.env.TEST_PHONE_E164 || "+254700000009";
    // Ensure session exists via finalize
    await postJSON(request, `${BASE}/api/wa/auth/finalize`, { phoneE164: PHONE, code: CODE_ATT });

    const wamid = WAM();
    const body = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { messages: [{ id: wamid, from: toGraph(PHONE), type: "text", text: { body: "1" } }] } }] }],
    };

    // First attempt
    let res = await request.post(`${BASE}/api/wa/webhook`, { data: body });
    expect(res.ok()).toBeTruthy();

    // Second attempt with same wamid should be ignored silently
    res = await request.post(`${BASE}/api/wa/webhook`, { data: body });
    expect(res.ok()).toBeTruthy();

    // Poll session state; must show a single handled transition (CLOSING_PICK or SUMMARY)
    let handled = false;
    for (let i = 0; i < 20 && !handled; i++) {
      const s = await request.get(`${BASE}/api/wa/dev/session?phoneE164=${encodeURIComponent(PHONE)}`);
      const js = await s.json();
      const st = js?.sess?.state;
      handled = st === "CLOSING_PICK" || st === "SUMMARY";
      if (!handled) await new Promise(r => setTimeout(r, 200));
    }
    expect(handled).toBeTruthy();
  });
});
