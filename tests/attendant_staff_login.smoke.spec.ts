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

function canon(s: string) {
  return (s || "").toLowerCase().replace(/\s+/g, "");
}

type StaffItem = { code: string; outlet?: string; active?: boolean; };

describe("Attendant staff login (dynamic)", () => {
  it("fetches staff and logs in all active attendants with outlet", async () => {
    const staffRes = await j(U("/api/admin/staff"));
    expect(staffRes.status).toBe(200);
    const staff: StaffItem[] = (staffRes as any).json?.staff || [];
    const attendants = staff.filter((s) => s && s.active !== false && !!s.code && !!s.outlet);
    if (!attendants.length) {
      throw new Error("No active attendants with outlet found in /api/admin/staff");
    }

    for (const s of attendants) {
      const res = await j(U("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginCode: canon(s.code) })
      });
      if (res.status !== 200) {
        const err = (res as any).json?.error || (res as any).text || `status ${res.status}`;
        throw new Error(`${s.code} login failed: ${err}`);
      }
      expect((res as any).json?.ok, `${s.code} ok!=true`).toBe(true);
    }
  });
});
