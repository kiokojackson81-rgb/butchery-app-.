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

// Codes from admin UI screenshot; update as needed.
const CODES = [
  "iana",
  "jacksona",
  "jamesc",
  "kithitoa",
  "kyaloa",
  "musyokib",
  "rooneyc",
  "stephena",
];

describe("Attendant codes assignment and login", () => {
  it("assignments list returns outlet for codes", async () => {
    const res = await j(U("/api/admin/assignments/list"));
    expect(res.status).toBe(200);
    const map = (res as any).json?.scope || {};
    expect(typeof map).toBe("object");
    for (const code of CODES) {
      const k = canon(code);
      const entry = map[k];
      expect(entry, `missing assignment for ${k}`).toBeTruthy();
      expect(typeof entry.outlet, `no outlet for ${k}`).toBe("string");
      expect(entry.outlet.length, `empty outlet for ${k}`).toBeGreaterThan(0);
    }
  });

  it("each code can login without CODE_NOT_ASSIGNED", async () => {
    for (const code of CODES) {
      const res = await j(U("/api/auth/login"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ loginCode: code })
      });
      if (res.status !== 200) {
        const err = (res as any).json?.error || (res as any).text || `status ${res.status}`;
        throw new Error(`${code} login failed: ${err}`);
      }
      expect((res as any).json?.ok, `${code} ok!=true`).toBe(true);
      expect((res as any).json?.error, `${code} unexpected error`).toBeUndefined();
    }
  });
});
