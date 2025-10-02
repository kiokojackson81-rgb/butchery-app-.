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

function digits(e164: string) { return String(e164 || "").replace(/\D/g, ""); }
async function wait(ms: number) { return new Promise((res) => setTimeout(res, ms)); }

// Validates supervisor login triggers an interactive button menu on WhatsApp.
describe("Supervisor WA login sends menu (live)", () => {
  it("sends interactive supervisor menu after successful login (if TEST_WA_E164 provided)", async () => {
    const code = process.env.SMOKE_SUPERVISOR_CODE || "SUPV1"; // provide a valid supervisor code in env
    const phone = process.env.TEST_WA_E164 || "";

    const r = await j(U("/api/wa/auth/start"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, wa: phone || undefined }),
    });
    expect(r.status).toBeLessThan(500);
    expect((r as any).json?.ok).toBe(true);

    if (!phone) return;

    const to = digits(phone);
    let found = false;
    for (let i = 0; i < 12 && !found; i++) {
      await wait(2500);
      const logs = await j(U(`/api/wa/logs?limit=80&to=${encodeURIComponent(to)}`));
      if ((logs as any).status >= 500) continue;
      const rows = (logs as any).json?.rows || [];
      for (const row of rows) {
        const payload = row?.payload || {};
        const req = payload?.request || payload?.body || {};
        if (req?.type === "interactive") {
          const isButtons = req?.interactive?.type === "button";
          if (isButtons) { found = true; break; }
        }
      }
    }

    expect(found).toBe(true);
  }, 60000);
});
