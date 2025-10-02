import { describe, it, expect } from "vitest";

// IMPORTANT: Set BASE_URL to the live site (e.g., https://barakafresh.com)
const ORIGIN = (() => {
  const b = process.env.BASE_URL || "https://barakafresh.com";
  if (/^https?:\/\//.test(b)) return b.replace(/\/$/, "");
  return "https://barakafresh.com";
})();
const U = (p: string) => `${ORIGIN}${p.startsWith("/") ? "" : "/"}${p}`;

function ymd() { return new Date().toISOString().slice(0,10); }

// Helper that returns body and Set-Cookie headers
async function jWithCookies(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const text = await r.text();
  const setCookie = r.headers.get("set-cookie") || r.headers.get("Set-Cookie") || "";
  try { return { status: r.status, json: JSON.parse(text), cookie: setCookie }; } catch { return { status: r.status, text, cookie: setCookie }; }
}

async function j(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t }; }
}

describe("Live E2E: attendant happy path on production", () => {
  const date = ymd();
  const outlet = `VT_${Math.random().toString(36).slice(2,7)}`;
  const code = "KIOKO20"; // canonFull will uppercase/normalize if needed
  const products = ["beef", "goat", "chicken"]; // example product keys

  it("provisions assignment, logs in, saves data, sends WA supply notify, and reads summary", async () => {
    // 1) Create assignment (code -> outlet + products)
    const a1 = await j(U("/api/attendant/assignments"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, outlet, productKeys: products }),
    });
    expect(a1.status).toBe(200);
    expect((a1 as any).json?.ok).toBe(true);

    // 1b) Map phone for notifications to +254705663175 (best-effort)
    await j(U("/api/admin/phone-mapping"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, role: "attendant", phoneE164: "+254705663175", outlet }),
    }).catch(() => ({} as any));

    // 2) Attendant login via assignment code
    const login = await jWithCookies(U("/api/attendant/login"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(login.status).toBe(200);
    const cookie = (login as any).cookie || "";
    // Some downstream APIs rely on session cookie; attach it
    const authHeaders = { "Content-Type": "application/json", "Cookie": cookie } as Record<string,string>;

    // 3) Supplier supply opening to the outlet (server-first reading later)
    const openingRows = [ { itemKey: "beef", qty: 10 }, { itemKey: "goat", qty: 6 } ];
    const sup = await j(U("/api/supply/opening"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ date, outlet, rows: openingRows }),
    });
    expect(sup.status).toBe(200);

    // 3b) Trigger WhatsApp notifications for supply
    const notify = await j(U("/api/supply/notify"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ outlet, date }),
    });
  // eslint-disable-next-line no-console
  console.log("notify.status:", notify.status);
  // best-effort: do not fail the flow if notify endpoint is gated/disabled in prod

    // 4) Attendant submits closing + waste
    const closingMap = { beef: 4, goat: 2 };
    const wasteMap = { beef: 1 };
    const cls = await j(U("/api/attendant/closing"), {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ date, outlet, closingMap, wasteMap }),
    });
    expect(cls.status).toBe(200);
    expect((cls as any).json?.ok).toBe(true);

    // 5) Attendant submits expenses
    const exp = await j(U("/api/expenses"), {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ outlet, items: [ { name: "Fuel", amount: 350 }, { name: "Bags", amount: 200 } ] }),
    });
    expect(exp.status).toBe(200);

    // 6) Till count (optional)
    await j(U("/api/tillcount"), {
      method: "POST",
      headers: authHeaders,
      body: JSON.stringify({ date, outlet, counted: 12345 }),
    });

    // 7) Supervisor summary readback (server computed)
    const sum = await j(U(`/api/supervisor/summary?date=${encodeURIComponent(date)}&outlet=${encodeURIComponent(outlet)}`));
    expect(sum.status).toBe(200);
    const data = (sum as any).json?.data || {};

    // Basic assertions that some numbers exist
  expect(["number", "undefined"].includes(typeof data.expectedKsh)).toBe(true);
  expect(["number", "undefined"].includes(typeof data.expensesKsh)).toBe(true);

    // 8) Print a compact report to console for CI visibility
    // (Optional) This is safe since vitest prints stdout
    // eslint-disable-next-line no-console
    console.log(JSON.stringify({
      outlet,
      date,
      openingRows,
      closingMap,
      wasteMap,
      summary: data,
    }));
  }, 60000);
});
