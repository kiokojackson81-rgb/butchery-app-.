import fetch from "node-fetch";
import { describe, it, expect } from "vitest";

const base = process.env.TEST_BASE || "http://localhost:3000";

describe("ensureNoDigitCollision", () => {
  it("rejects different codes with same digit core", async () => {
    // Use a random 6-digit number to avoid colliding with existing data
    const suffix = Math.floor(100000 + Math.random() * 900000);
    const first = { people: [{ role: "attendant", code: `AB-${suffix}` }] };
    const r1 = await fetch(base + "/api/admin/attendants/upsert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(first),
    });
  const j1 = await r1.json() as { ok: boolean; [key: string]: any };
  expect(r1.status).toBe(200);
  expect(j1.ok).toBe(true);

  // small delay to ensure first upsert is fully committed in dev
  await new Promise((r) => setTimeout(r, 200));
  const second = { people: [{ role: "attendant", code: `XY ${suffix}` }] };
    const r2 = await fetch(base + "/api/admin/attendants/upsert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(second),
    });
    const text = await r2.text();
    let j2: any; try { j2 = JSON.parse(text); } catch { j2 = { raw: text }; }
    expect(r2.status).toBeGreaterThanOrEqual(400);
    expect(r2.status).toBeLessThan(500);
    expect(JSON.stringify(j2)).toMatch(/Digit-core collision/i);
  }, 15000);
});

