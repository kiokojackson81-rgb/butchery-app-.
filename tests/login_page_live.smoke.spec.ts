import { describe, it, expect } from "vitest";

// Use live origin unless BASE_URL is provided
const ORIGIN = (() => {
  const b = process.env.BASE_URL || "https://barakafresh.com";
  if (/^https?:\/\//.test(b)) return b.replace(/\/$/, "");
  return "https://barakafresh.com";
})();
const U = (p: string) => `${ORIGIN}${p.startsWith("/") ? "" : "/"}${p}`;

function ymd() { return new Date().toISOString().slice(0,10); }

async function j(url: string, init?: RequestInit) {
  const r = await fetch(url, init);
  const t = await r.text();
  try { return { status: r.status, json: JSON.parse(t) }; } catch { return { status: r.status, text: t }; }
}

describe("Live login page API flow", () => {
  // Use a known valid attendant code by default; allow CI to override via SMOKE_ATTENDANT_CODE
  const code = process.env.SMOKE_ATTENDANT_CODE || "MutiaA";
  const outlet = `VT_${Math.random().toString(36).slice(2,7)}`;
  const date = ymd();

  it("provisions assignment and returns WhatsApp deep link for login", async () => {
    // Provision an assignment for the code → outlet (idempotent on server)
    const a1 = await j(U("/api/attendant/assignments"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code, outlet, productKeys: ["beef"] }),
    });
    expect(a1.status).toBeLessThan(500);
    expect((a1 as any).json?.ok).toBe(true);

    // Request login link as the login page does
    const ll = await j(U("/api/flow/login-link"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(ll.status).toBe(200);
    expect((ll as any).json?.ok).toBe(true);
    const links = (ll as any).json?.links || {};
    expect(typeof links.waMe === "string").toBe(true);

    // Validate-code should classify role/outlet
    const v = await j(U("/api/auth/validate-code"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code }),
    });
    expect(v.status).toBeLessThan(500);
    if ((v as any).json?.ok) {
      expect(["attendant", "supervisor", "supplier"]).toContain((v as any).json.role);
    }
  }, 45000);
});
