import fetch from "node-fetch";
import { describe, it, expect } from "vitest";

const base = process.env.TEST_BASE || "http://localhost:3000";

describe("ensureNoDigitCollision", () => {
  it("rejects different codes with same digit core", async () => {
    const first = { people: [{ role: "attendant", code: "AB-123" }] };
    const r1 = await fetch(base + "/api/admin/attendants/upsert", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(first),
    });
    const j1 = await r1.json() as { ok: boolean; [key: string]: any };
    expect(r1.status).toBe(200);
    expect(j1.ok).toBe(true);

    const second = { people: [{ role: "attendant", code: "XY 123" }] };
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
  });
});

