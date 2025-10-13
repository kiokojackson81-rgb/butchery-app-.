// src/app/api/supply/on-supply-posted/route.ts
import { NextResponse } from "next/server";
import { onSupplyPosted } from "@/lib/analytics/intervals.service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const j = await req.json().catch(() => ({}));
    const date = String(j?.date || "").slice(0, 10);
    const outlet = String(j?.outlet || j?.outletName || "").trim();
    const productKey = String(j?.productKey || j?.product || "").trim();
    const supplyId = String(j?.supplyId || j?.id || "").trim();
    const suppliedQty = Number(j?.qty || j?.suppliedQty || 0);
    if (!date || !outlet || !productKey || !supplyId) return NextResponse.json({ ok: false, error: "Missing fields" }, { status: 400 });
    await onSupplyPosted(date, outlet, productKey, supplyId, suppliedQty);
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: String(e?.message || e) }, { status: 500 });
  }
}
