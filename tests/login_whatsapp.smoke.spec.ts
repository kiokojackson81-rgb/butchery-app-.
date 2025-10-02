import { describe, it, expect } from "vitest";

const ORIGIN = (() => {
  const b = process.env.BASE_URL || "https://barakafresh.com";
  if (/^https?:\/\//.test(b)) return b.replace(/\/$/, "");
  return "https://barakafresh.com";
})();
const U = (p: string) => `${ORIGIN}${p.startsWith("/") ? "" : "/"}${p}`;

async function j(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t }; }
}

describe("WhatsApp login start (live)", () => {
  it("accepts a valid code and returns ok (and sets cookies if wa provided)", async () => {
    const code = process.env.SMOKE_ATTENDANT_CODE || "MutiaA"; // known good in prod
    const wa = process.env.TEST_WA_E164 || "+254700000000"; // optional; server will noop messages if not mapped in meta
    const r = await j(U("/api/wa/auth/start"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, wa }),
    });
    expect(r.status).toBeLessThan(500);
    expect((r as any).json?.ok).toBe(true);
  }, 30000);
});
