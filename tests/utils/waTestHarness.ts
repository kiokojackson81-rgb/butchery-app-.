/* Test harness helpers for WA e2e in Playwright */
const BASE = process.env.BASE_URL || "http://localhost:3000";

function toDigits(phone: string): string {
  return String(phone || "").replace(/[^0-9+]/g, "").replace(/^\+/, "");
}

export async function drainOutbox(opts?: { to?: string; limit?: number }) {
  const to = opts?.to ? toDigits(opts.to) : "";
  const limit = opts?.limit ?? 50;
  const url = new URL(`${BASE}/api/wa/logs`);
  if (to) url.searchParams.set("to", to);
  url.searchParams.set("limit", String(limit));
  const res = await fetch(url.toString());
  const json = await res.json();
  const rows: any[] = Array.isArray(json?.rows) ? json.rows : [];
  // Derive a shallow text for convenience
  const mapped = rows.map((r) => {
    const p = r?.payload || {};
    const text = p?.text || p?.request?.text?.body || p?.body?.text || "";
    return { id: r.id, type: r.type, status: r.status, createdAt: r.createdAt, text, payload: p };
  });
  return mapped;
}

export async function linkSession(phoneE164: string, code: string) {
  const res = await fetch(`${BASE}/api/wa/auth/finalize`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneE164, code }),
  });
  return res.json();
}

export async function simulateInbound(phoneE164: string, text: string) {
  const res = await fetch(`${BASE}/api/wa/simulate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phoneE164, text }),
  });
  return res.json();
}
