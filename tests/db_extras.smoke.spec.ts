import { describe, it, expect, afterAll } from "vitest";

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
function ymd() { return new Date().toISOString().slice(0,10); }

// Increase timeout for cold starts / prod network
describe("DB-first extras smoke", () => {
  const TEST_TIMEOUT = Number(process.env.SMOKE_TIMEOUT_MS || 30000);
  try {
    // Vitest provides a setTimeout function on the current test context via globalThis.vitest
    (globalThis as any).vitest?.setTimeout?.(TEST_TIMEOUT);
  } catch {}
  const date = ymd();
  const outletA = `VTA_${Math.random().toString(36).slice(2,7)}`;
  const outletB = `VTB_${Math.random().toString(36).slice(2,7)}`;

  it("till count upsert and read", async () => {
    const body = { date, outlet: outletA, counted: 12345 };
    const post = await j(U("/api/tillcount"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    expect(post.status).toBe(200);
    const get = await j(U(`/api/tillcount?date=${date}&outlet=${encodeURIComponent(outletA)}`));
    expect(get.status).toBe(200);
    expect((get as any).json?.counted).toBe(12345);
  });

  it("supply opening save and read", async () => {
    const rows = [ { itemKey: "beef", qty: 10 }, { itemKey: "goat", qty: 5 } ];
    const post = await j(U("/api/supply/opening"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, outlet: outletA, rows }) });
    expect(post.status).toBe(200);
    const get = await j(U(`/api/supply/opening?date=${date}&outlet=${encodeURIComponent(outletA)}`));
    expect(get.status).toBe(200);
    const list = (get as any).json?.rows || [];
    expect(list.length).toBeGreaterThanOrEqual(2);
  });

  it("supply transfer adjusts opening for both outlets", async () => {
    // seed opening for both sides
    await j(U("/api/supply/opening"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, outlet: outletA, rows: [ { itemKey: "beef", qty: 10 } ] }) });
    await j(U("/api/supply/opening"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, outlet: outletB, rows: [ { itemKey: "beef", qty: 3 } ] }) });

    const transfer = { date, fromOutletName: outletA, toOutletName: outletB, itemKey: "beef", unit: "kg", qty: 4 };
    const post = await j(U("/api/supply/transfer"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(transfer) });
    expect(post.status).toBe(200);

    const a = await j(U(`/api/supply/opening?date=${date}&outlet=${encodeURIComponent(outletA)}`));
    const b = await j(U(`/api/supply/opening?date=${date}&outlet=${encodeURIComponent(outletB)}`));
    const qa = Number(((a as any).json?.rows || []).find((r: any) => r.itemKey === "beef")?.qty ?? 0);
    const qb = Number(((b as any).json?.rows || []).find((r: any) => r.itemKey === "beef")?.qty ?? 0);
    expect(qa).toBeGreaterThanOrEqual(6); // 10 - 4
    expect(qb).toBeGreaterThanOrEqual(7); // 3 + 4
  }, 20000);

  it("supervisor reviews create and approve/reject endpoints exist", async () => {
    const payload = { type: "expense", outlet: outletA, date, payload: { name: "Fuel", amount: 99 }, status: "pending" };
    const created = await j(U("/api/supervisor/reviews"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
    expect(created.status).toBe(200);
    const items = (created as any).json?.items || [];
    const id = items[0]?.id;
    expect(id).toBeTruthy();

    // approve
    const approve = await j(U(`/api/supervisor/reviews/${encodeURIComponent(id)}/approve`), { method: "POST" });
    expect(approve.status).toBe(200);

    // reject
    const reject = await j(U(`/api/supervisor/reviews/${encodeURIComponent(id)}/reject`), { method: "POST" });
    expect(reject.status).toBe(200);
  });

  afterAll(async () => {
    // cleanup
    try { await j(U("/api/tillcount"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, outlet: outletA, counted: 0 }) }); } catch {}
    try { await j(U("/api/supply/opening"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, outlet: outletA, rows: [] }) }); } catch {}
    try { await j(U("/api/supply/opening"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ date, outlet: outletB, rows: [] }) }); } catch {}
  });
});
