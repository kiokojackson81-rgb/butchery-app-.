import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

function env(name: string) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function fetchAllTemplates(wabaId: string, token: string) {
  const base = `https://graph.facebook.com/v20.0/${encodeURIComponent(wabaId)}/message_templates`;
  const params = new URLSearchParams({ fields: "name,status,language,category", limit: "200" });
  let url = `${base}?${params.toString()}`;
  const out: any[] = [];
  for (let i = 0; i < 10; i++) { // safety bound
    const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` }, cache: "no-store" });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      return { ok: false, error: json?.error?.message || `Graph error ${res.status}` } as const;
    }
    const data = Array.isArray(json?.data) ? json.data : [];
    out.push(...data);
    const next = json?.paging?.next as string | undefined;
    if (!next) break;
    url = next;
  }
  return { ok: true, data: out } as const;
}

export async function GET() {
  try {
    const wabaId = process.env.WHATSAPP_BUSINESS_ACCOUNT_ID || process.env.WHATSAPP_WABA_ID;
    const token = process.env.WHATSAPP_TOKEN;
    if (!wabaId || !token) {
      return NextResponse.json({ ok: false, error: "Missing WHATSAPP_BUSINESS_ACCOUNT_ID/WHATSAPP_WABA_ID or WHATSAPP_TOKEN" }, { status: 200 });
    }
    const r = await fetchAllTemplates(wabaId, token);
    if (!r.ok) return NextResponse.json({ ok: false, error: r.error }, { status: 200 });
    const approved = r.data.filter((t: any) => String(t?.status).toUpperCase() === "APPROVED")
      .map((t: any) => ({ name: t?.name, language: t?.language, category: t?.category }));
    return NextResponse.json({ ok: true, total: approved.length, approved });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || String(e) }, { status: 200 });
  }
}
