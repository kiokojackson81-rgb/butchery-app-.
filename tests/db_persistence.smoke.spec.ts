import { afterAll, beforeAll, describe, expect, it } from "vitest";

// Normalize base origin for tests. In some runners BASE_URL may be "/".
const ORIGIN = (() => {
  const b = process.env.BASE_URL || "http://localhost:3000";
  if (/^https?:\/\//.test(b)) return b.replace(/\/$/, "");
  return "http://localhost:3000";
})();
const U = (p: string) => `${ORIGIN}${p.startsWith("/") ? "" : "/"}${p}`;

async function j(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t }; }
}

function ymd() {
  return new Date().toISOString().slice(0, 10);
}

describe("DB-first persistence smoke", () => {
  const date = ymd();
  const outlet = `VT_${Math.random().toString(36).slice(2, 7)}`;

  it("saves and reads deposits from DB", async () => {
    const body = {
      outlet,
      entries: [
        { code: "T1", amount: 111, note: "vtest" },
        { code: "T2", amount: 222 },
      ],
    };
  const post = await j(U("/api/deposits"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(post.status).toBe(200);
    expect((post as any).json?.ok).toBe(true);

  const get = await j(U(`/api/deposits?date=${date}&outlet=${encodeURIComponent(outlet)}`));
    expect(get.status).toBe(200);
    const rows = (get as any).json?.rows || [];
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("saves and reads expenses from DB", async () => {
    const body = { outlet, items: [ { name: "Fuel", amount: 1234 }, { name: "Bags", amount: 300 } ] };
  const post = await j(U("/api/expenses"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(post.status).toBe(200);
    expect((post as any).json?.ok).toBe(true);

  const get = await j(U(`/api/expenses?date=${date}&outlet=${encodeURIComponent(outlet)}`));
    expect(get.status).toBe(200);
    const rows = (get as any).json?.rows || [];
    expect(rows.length).toBeGreaterThanOrEqual(2);
  });

  it("saves and reads closings/waste from DB", async () => {
    const body = { outlet, date, closingMap: { beef: 5, goat: 2 }, wasteMap: { beef: 1 } };
  const post = await j(U("/api/attendant/closing"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(post.status).toBe(200);
    expect((post as any).json?.ok).toBe(true);
    const saved = (post as any).json;
    expect(saved.savedCount).toBeGreaterThanOrEqual(1);

  const get = await j(U(`/api/attendant/closing?date=${date}&outlet=${encodeURIComponent(outlet)}`));
    expect(get.status).toBe(200);
    const resp = (get as any).json || {};
    expect(resp.ok).toBe(true);
    expect(resp.closingMap?.beef).toBe(5);
    expect(resp.wasteMap?.beef).toBe(1);
  });

  afterAll(async () => {
    // Best-effort cleanup: clear deposits, expenses, and closings for the outlet/date used.
    try {
      await j(U("/api/deposits"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outlet, entries: [] }) });
    } catch {}
    try {
      await j(U("/api/expenses"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outlet, items: [] }) });
    } catch {}
    try {
      await j(U("/api/attendant/closing"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ outlet, date, closingMap: {}, wasteMap: {} }) });
    } catch {}
  }, 60000);
});
