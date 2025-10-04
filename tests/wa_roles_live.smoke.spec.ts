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

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

describe("WA roles live send (opt-in)", () => {
  it("sends login/menu for attendant, supervisor, supplier to the same phone", async () => {
    if ((process.env.WA_DRY_RUN || "false").toLowerCase() === "true") {
      throw new Error("WA_DRY_RUN=true; set to false for live send");
    }
    // Single phone that is allowed to receive all roles
    const phone = requireEnv("TEST_WA_E164");

    const roles = [
      { role: "attendant", code: requireEnv("ATTENDANT_CODE") },
      { role: "supervisor", code: requireEnv("SUPERVISOR_CODE") },
      { role: "supplier", code: requireEnv("SUPPLIER_CODE") },
    ];

    for (const r of roles) {
      const res = await j(U("/api/wa/auth/start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code: r.code, wa: phone })
      });
      expect(res.status).toBeLessThan(500);
      expect((res as any).json?.ok).toBe(true);
    }
  }, 60000);
});
