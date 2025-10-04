import { describe, it, expect } from "vitest";

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

function digits(e164: string) { return String(e164 || "").replace(/\D/g, ""); }
async function wait(ms: number) { return new Promise((res) => setTimeout(res, ms)); }

type Staff = { code: string; outlet?: string; active?: boolean };

describe("WA Graph dry-run: all active attendants send menu", () => {
  it("starts WA auth and emits interactive menu logs for all attendants with mapped phone (dry-run ok)", async () => {
    // Ensure we are not sending real messages in CI unless configured
    const dry = (process.env.WA_DRY_RUN || "true").toLowerCase() === "true";

    // Load staff
    const staffRes = await j(U("/api/admin/staff"));
    expect(staffRes.status).toBe(200);
    const staff: Staff[] = (staffRes as any).json?.staff || [];
    const attendants = staff.filter((s) => s && s.active !== false && !!s.code && !!s.outlet);
    expect(attendants.length).toBeGreaterThan(0);

    // For each attendant, kick off WA auth (no phone provided in body)
    for (const s of attendants) {
      const r = await j(U("/api/wa/auth/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: s.code })
      });
      expect(r.status).toBeLessThan(500);
      expect((r as any).json?.ok).toBe(true);
    }

    // If dry-run, we expect WA logs with interactive body. We'll poll a bit.
    if (!dry) return; // Real sends require TEST_WA_E164 and mapping which is out of scope here

    let foundInteractive = false;
    for (let i = 0; i < 8 && !foundInteractive; i++) {
      await wait(1500);
      const logs = await j(U(`/api/wa/logs?limit=100`));
      const rows = (logs as any).json?.rows || [];
      for (const row of rows) {
        const payload = row?.payload || {};
        const body = payload?.request || payload?.body || {};
        if (body?.type === "interactive") { foundInteractive = true; break; }
      }
    }

    expect(foundInteractive).toBe(true);
  }, 60000);
});
