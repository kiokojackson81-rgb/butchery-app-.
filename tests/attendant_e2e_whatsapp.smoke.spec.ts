import { describe, it, expect } from "vitest";

const ORIGIN = (() => {
  const b = process.env.BASE_URL || "https://barakafresh.com";
  if (/^https?:\/\//.test(b)) return b.replace(/\/$/, "");
  return "https://barakafresh.com";
})();
const U = (p: string) => `${ORIGIN}${p.startsWith("/") ? "" : "/"}${p}`;

function ymd() { return new Date().toISOString().slice(0,10); }
function sleep(ms: number) { return new Promise((r)=>setTimeout(r, ms)); }
function digits(e164: string) { return String(e164||"").replace(/\D/g, ""); }

async function j(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t }; }
}

async function jWithCookies(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  const setCookie = r.headers.get("set-cookie") || r.headers.get("Set-Cookie") || "";
  try { return { status: r.status, json: JSON.parse(text), cookie: setCookie }; } catch { return { status: r.status, text, cookie: setCookie }; }
}

// This smoke runs against live BASE_URL and checks that the end-to-end
// actions emit WhatsApp outbound logs to TEST_WA_E164 if configured.
describe("Live WA E2E: supply → closing → deposit → notifications", () => {
  const date = ymd();
  const outlet = `WA_${Math.random().toString(36).slice(2,8)}`;
  const code = process.env.SMOKE_ATTENDANT_CODE || "KIOKO20";
  const toPhone = process.env.TEST_WA_E164 || "+254705663175";

  it("emits WA logs to test phone", async () => {
    // Provision assignment and phone mapping
    await j(U("/api/attendant/assignments"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, outlet, productKeys: ["beef","goat"] }),
    });
    await j(U("/api/admin/phone-mapping"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, role: "attendant", phoneE164: toPhone, outlet }),
    });

    // Attendant login (cookie for API ops)
    const login = await jWithCookies(U("/api/attendant/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    const cookie = (login as any).cookie || "";
    const authHeaders = { "Content-Type": "application/json", "Cookie": cookie } as Record<string,string>;

    // Supply opening + notify
    await j(U("/api/supply/opening"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, outlet, rows: [ { itemKey: "beef", qty: 8 } ] }),
    });
    await j(U("/api/supply/notify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outlet, date }),
    });

    // Closing + waste
    await j(U("/api/attendant/closing"), {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ date, outlet, closingMap: { beef: 3 }, wasteMap: { beef: 1 } }),
    });

    // Expense
    await j(U("/api/expenses"), {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ outlet, items: [ { name: "Fuel", amount: 200 } ] }),
    });

    // Deposit (simple route for DB insertion)
    await j(U("/api/deposits"), {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ date, outlet, entries: [ { code, amount: 500, note: "TEST" } ] }),
    });

    // Now poll WA logs for any outbound message to phone (menu, notify, etc.)
    const to = digits(toPhone);
    let seen = false;
    for (let i = 0; i < 12 && !seen; i++) {
      await sleep(2500);
      const logs = await j(U(`/api/wa/logs?limit=120&to=${encodeURIComponent(to)}`));
      if ((logs as any).status >= 500) continue;
      const rows = (logs as any)?.json?.rows || [];
      seen = rows.some((r: any) => String(r?.direction || "").toLowerCase() === "out");
    }

    expect(seen).toBe(true);
  }, 90000);
});
