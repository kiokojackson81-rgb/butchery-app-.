import { test, expect } from "@playwright/test";
const WAM = () => `wam-${Date.now()}-${Math.random().toString(36).slice(2,7)}`;

const BASE = process.env.BASE_URL || "http://localhost:3000";
const CODE_ATT = process.env.TEST_CODE_ATTENDANT || "ATT001";

// Derive a unique test phone per browser project to avoid cross-project interference
function phoneForProject(projectName: string): string {
  const envPhone = process.env.TEST_PHONE_E164;
  if (envPhone) return envPhone;
  switch ((projectName || "").toLowerCase()) {
    case "chromium":
      return "+254700000001";
    case "firefox":
      return "+254700000002";
    case "webkit":
      return "+254700000003";
    default:
      return "+254700000009";
  }
}

async function postJSON(request: any, url: string, data: any) {
  const res = await request.post(url, { data });
  expect(res.ok()).toBeTruthy();
  return res.json();
}

test.describe("WA session loop smokes", () => {
  test.describe.configure({ mode: "serial" });
  test("login -> menu -> 1 executes without login loop", async ({ request }) => {
    const PHONE = phoneForProject(test.info().project.name);
    // Finalize login directly
    const j = await postJSON(request, `${BASE}/api/wa/auth/finalize`, { phoneE164: PHONE, code: CODE_ATT });
    expect(j.ok).toBeTruthy();

    // Send webhook-like text '1'
    const body = {
      object: "whatsapp_business_account",
      entry: [{ changes: [{ value: { messages: [{ id: WAM(), from: PHONE.replace(/^\+/, ""), type: "text", text: { body: "1" } }] } }] }],
    };
    const res = await request.post(`${BASE}/api/wa/webhook`, { data: body });
    expect(res.ok()).toBeTruthy();

    // Expect session to enter a handled state (CLOSING_PICK or SUMMARY if no products remain)
    let handled = false;
    for (let i = 0; i < 20 && !handled; i++) {
      const s = await request.get(`${BASE}/api/wa/dev/session?phoneE164=${encodeURIComponent(PHONE)}`);
      const js = await s.json();
      const st = js?.sess?.state;
      handled = st === "CLOSING_PICK" || st === "SUMMARY";
      if (!handled) await new Promise((res) => setTimeout(res, 250));
    }
    expect(handled).toBeTruthy();
  });

  test("duplicate login prompts are suppressed", async ({ request }) => {
    const PHONE = phoneForProject(test.info().project.name);
    // Force expire to trigger login prompt
    await postJSON(request, `${BASE}/api/wa/dev/expire-session`, { phoneE164: PHONE, minutesAgo: 999 });
    // Send a text to trigger login prompt
    const body = { object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ id: "wam2", from: PHONE.replace(/^\+/, ""), type: "text", text: { body: "hello" } }] } }] }] };
    await request.post(`${BASE}/api/wa/webhook`, { data: body });
    // Immediately send again
  await request.post(`${BASE}/api/wa/webhook`, { data: { ...body, entry: [{ changes: [{ value: { messages: [{ id: WAM(), from: PHONE.replace(/^\+/, ""), type: "text", text: { body: "hello again" } }] } }] }] } });
    // Fetch recent logs and ensure not more than one LOGIN prompt marker is present
    const to = PHONE.replace(/[^0-9+]/g, "").replace(/^\+/, "");
    const logs = await request.get(`${BASE}/api/wa/logs?to=${to}&limit=50`);
    const jl = await logs.json();
    const rows: any[] = jl.rows || [];
    const markers = rows.filter((r: any) => String(r?.status || "").includes("LOGIN_PROMPT"));
    expect(markers.length).toBeLessThanOrEqual(1);
  });

  test("TTL expire prompts login once", async ({ request }) => {
    const PHONE = phoneForProject(test.info().project.name);
    await postJSON(request, `${BASE}/api/wa/dev/expire-session`, { phoneE164: PHONE, minutesAgo: 120 });
  const body = { object: "whatsapp_business_account", entry: [{ changes: [{ value: { messages: [{ id: WAM(), from: PHONE.replace(/^\+/, ""), type: "text", text: { body: "1" } }] } }] }] };
    const res = await request.post(`${BASE}/api/wa/webhook`, { data: body });
    expect(res.ok()).toBeTruthy();
    // Verify server put session into LOGIN state
    let inLogin = false;
    for (let i = 0; i < 8 && !inLogin; i++) {
      const s = await request.get(`${BASE}/api/wa/dev/session?phoneE164=${encodeURIComponent(PHONE)}`);
      const js = await s.json();
      inLogin = js?.sess?.state === "LOGIN";
      if (!inLogin) await new Promise((res) => setTimeout(res, 250));
    }
    expect(inLogin).toBeTruthy();
  });
});
